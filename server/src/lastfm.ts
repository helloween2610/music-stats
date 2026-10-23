// Incremental Last.fm sync. Runs from the cron trigger, so each run stays small:
// free Workers allow ~50 subrequests and 10 ms CPU per invocation.
import type { Env } from "./index";

const API = "https://ws.audioscrobbler.com/2.0/";
const PAGE_SIZE = 200;
const MAX_PAGES_PER_RUN = 5; // free plan: ~10 ms CPU per run
// Each run re-reads yesterday and today (Vietnam time): scrobbles submitted late (offline listening)
// keep their original timestamp, and scrobbles deleted or edited on Last.fm in that window are
// removed here too (an edit arrives as a new title; the old row goes). If the last stored scrobble
// is older than that (server stopped for days), the run starts from it so nothing is skipped.
const VN_OFFSET = 7 * 3600;

/** 00:00 Vietnam time of yesterday, as Unix seconds. */
function startOfYesterdayVN() {
  const vnNow = Date.now() / 1000 + VN_OFFSET;
  return Math.floor(vnNow / 86400) * 86400 - 86400 - VN_OFFSET;
}

interface Scrobble {
  uts: number;
  artist: string;
  title: string;
  album: string;
}

async function fetchPage(env: Env, from: number, page: number) {
  const qs = new URLSearchParams({
    method: "user.getrecenttracks",
    user: env.LASTFM_USER,
    api_key: env.LASTFM_API_KEY,
    format: "json",
    limit: String(PAGE_SIZE),
    from: String(from),
    page: String(page),
  });
  const res = await fetch(`${API}?${qs}`);
  if (!res.ok) throw new Error(`Last.fm HTTP ${res.status}`);
  const body: any = await res.json();
  if (body.error) throw new Error(`Last.fm error ${body.error}: ${body.message}`);
  const list = body.recenttracks?.track ?? [];
  const tracks: Scrobble[] = (Array.isArray(list) ? list : [list])
    .filter((t: any) => t.date?.uts) // skip "now playing"
    .map((t: any) => ({
      uts: Number(t.date.uts),
      artist: t.artist["#text"],
      title: t.name,
      album: t.album?.["#text"] ?? "",
    }));
  return { tracks, totalPages: Number(body.recenttracks?.["@attr"]?.totalPages ?? 1) || 1 };
}

function vnParts(uts: number) {
  const d = new Date((uts + VN_OFFSET) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

export async function syncLastfm(env: Env): Promise<{ fetched: number; inserted: number; deleted: number; complete: boolean }> {
  const floor = Date.parse(`${env.LASTFM_FROM}T00:00:00+07:00`) / 1000;
  const last = await env.DB.prepare("SELECT MAX(lastfm_uts) AS uts FROM plays WHERE source = 'lastfm'").first<{ uts: number | null }>();
  const from = Math.max(floor, Math.min(startOfYesterdayVN(), last?.uts ?? floor));

  // Last.fm returns newest first, so walk from the last page (oldest) upward:
  // if a run stops early, the next run resumes from what was stored.
  const first = await fetchPage(env, from, 1);
  const pages = Math.min(first.totalPages, MAX_PAGES_PER_RUN);
  const scrobbles: Scrobble[] = [];
  for (let p = first.totalPages; p > first.totalPages - pages; p--) {
    scrobbles.push(...(p === 1 ? first.tracks : (await fetchPage(env, from, p)).tracks));
  }

  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO plays (source, played_at, play_date, hour, minute, title, artist, album, lastfm_uts)
     VALUES ('lastfm', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?1)`,
  );
  let inserted = 0;
  for (let i = 0; i < scrobbles.length; i += 100) {
    const batch = scrobbles.slice(i, i + 100).map((s) => {
      const v = vnParts(s.uts);
      return insert.bind(s.uts, v.date, v.hour, v.minute, s.title, s.artist, s.album || null);
    });
    const results = await env.DB.batch(batch);
    inserted += results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }

  // Deleted / edited scrobbles: only when this run saw the whole window, and never when Last.fm
  // suddenly returns nothing or less than half of what is stored (an API hiccup, not deletions).
  const complete = pages === first.totalPages;
  let deleted = 0;
  if (complete && scrobbles.length) {
    const { results: stored } = await env.DB.prepare(
      "SELECT id, lastfm_uts AS uts, artist, title FROM plays WHERE source = 'lastfm' AND lastfm_uts > ?1",
    ).bind(from).all<{ id: number; uts: number; artist: string; title: string }>();
    const seen = new Set(scrobbles.map((s) => `${s.uts}|${s.artist}|${s.title}`));
    const gone = stored.filter((r) => !seen.has(`${r.uts}|${r.artist}|${r.title}`));
    if (gone.length && gone.length * 2 <= stored.length) {
      const del = env.DB.prepare("DELETE FROM plays WHERE id = ?1");
      for (let i = 0; i < gone.length; i += 100) {
        const res = await env.DB.batch(gone.slice(i, i + 100).map((r) => del.bind(r.id)));
        deleted += res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
      }
    }
  }

  await env.DB.prepare(
    "INSERT INTO sync_state (key, value, updated_at) VALUES ('lastfm', ?1, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = datetime('now')",
  )
    .bind(JSON.stringify({ fetched: scrobbles.length, inserted, deleted, at: Date.now() }))
    .run();

  return { fetched: scrobbles.length, inserted, deleted, complete };
}
