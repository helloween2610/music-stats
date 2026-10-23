// "Thư viện" screen and song detail: library status, unmatched scrobbles, manual matching, search,
// calculation rules, and one song's numbers.
import type { Env } from "./index";
import { matchKey, stripRemaster } from "./match";
import { ratingsByTrack, songsAt } from "./memos";
import { memo } from "./cache";
import { completeSongRankHistory } from "./history";

export async function librarySummary(env: Env) {
  const res = await env.DB.batch<any>([
    env.DB.prepare("SELECT SUM(in_library) AS tracks, MAX(date_added) AS last_added, MAX(updated_at) AS updated_at FROM tracks"),
    env.DB.prepare("SELECT key, value, updated_at FROM sync_state"),
    env.DB.prepare(
      `SELECT COUNT(*) AS plays, COUNT(DISTINCT lower(artist) || '|' || lower(title)) AS songs
       FROM plays WHERE track_id IS NULL AND source = 'lastfm'`,
    ),
  ]);
  return { library: res[0].results[0], sync: res[1].results, unmatched: res[2].results[0], rules: await getRules(env) };
}

/** Unmatched Last.fm scrobbles grouped by artist + title, most played first, with up to 3 suggestions. */
export async function unmatched(env: Env, limit: number, offset: number) {
  const { results: groups } = await env.DB.prepare(
    `SELECT artist, title, MIN(album) AS album, COUNT(*) AS plays, MAX(play_date) AS last
     FROM plays WHERE track_id IS NULL AND source = 'lastfm'
     GROUP BY lower(artist), lower(title) ORDER BY plays DESC, last DESC LIMIT ?1 OFFSET ?2`,
  ).bind(limit, offset).all<{ artist: string; title: string; album: string | null; plays: number; last: string }>();
  if (!groups.length) return [];
  // Suggestions: same title (any artist), the title without a remaster suffix, or same artist with a
  // title starting the same way. Matched in memory against the memoized library keys (one row read)
  // instead of one table scan per row.
  const lib = await memo<[string, string, string, string | null, string, string, string][]>(env, "library-keys", async () =>
    (await env.DB.prepare(
      `SELECT id, title, COALESCE(album_artist, artist, '') AS artist, album, COALESCE(key_title, ''),
              COALESCE(key_artist, ''), COALESCE(key_album_artist, '') FROM tracks`,
    ).raw<[string, string, string, string | null, string, string, string]>()));
  return groups.map((g) => {
    const t = matchKey(g.title), bare = stripRemaster(t), a = matchKey(g.artist), prefix = t.slice(0, 8);
    const scored: { score: number; s: { id: string; title: string; artist: string; album: string | null } }[] = [];
    for (const [id, title, artist, album, kt, ka, kaa] of lib) {
      const sameArtist = ka === a || kaa === a;
      const hit = kt === t || kt === bare || (sameArtist && kt.startsWith(prefix));
      if (hit) scored.push({ score: (sameArtist ? 2 : 0) + (kt === t ? 1 : 0), s: { id, title, artist, album } });
    }
    return { ...g, suggestions: scored.sort((x, y) => y.score - x.score).slice(0, 3).map((x) => x.s) };
  });
}

/** Link every unmatched play of artist + title to a track and remember it as an alias. */
export async function matchManually(env: Env, body: { artist?: string; title?: string; album?: string | null; track_id?: string }) {
  if (!body.artist || !body.title || !body.track_id) return { error: "artist, title and track_id are required" };
  const track = await env.DB.prepare("SELECT id FROM tracks WHERE id = ?1").bind(body.track_id).first();
  if (!track) return { error: "unknown track_id" };
  const ka = matchKey(body.artist), kt = matchKey(body.title);
  const res = await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO aliases (key_artist, key_title, key_album, track_id, origin) VALUES (?1, ?2, ?3, ?4, 'manual')")
      .bind(ka, kt, matchKey(body.album), body.track_id),
    // SQLite can't collapse inner spaces, so compare the trimmed lowercase text (the alias catches the rest on the next sync).
    env.DB.prepare(
      `UPDATE plays SET track_id = ?3, match_tried = 1
       WHERE track_id IS NULL AND source = 'lastfm' AND lower(trim(artist)) = ?1 AND lower(trim(title)) = ?2`,
    ).bind(ka, kt, body.track_id),
  ]);
  return { matched: res[1].meta.changes ?? 0 };
}

/** Lowercase without accents ("Nhật Ký" → "nhat ky", "Đen" → "den"), for search. */
export function fold(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();
}

// [id, title, artist, album, year, plays, folded title, folded artist, folded album], most played first
type SearchRow = [string, string, string, string | null, number | null, number, string, string, string];

/**
 * Search songs, artists and albums (Thư viện), ignoring case and accents like the design does.
 * The library is small (~3k tracks), so it is kept as one memoized list and filtered here:
 * one row read per search instead of three table scans.
 */
export async function searchLibrary(env: Env, q: string, limit: number) {
  const rows = await memo<SearchRow[]>(env, "search-index", async () =>
    (await env.DB.prepare(
      `WITH c AS (SELECT track_id, COUNT(*) AS n FROM plays WHERE track_id IS NOT NULL AND play_date >= ?1 GROUP BY track_id)
       SELECT t.id, t.title, COALESCE(t.album_artist, t.artist, '') AS artist, t.album, t.year,
              t.plays_to_12_2024 + COALESCE(c.n, 0) AS plays
       FROM tracks t LEFT JOIN c ON c.track_id = t.id`,
    ).bind(env.LASTFM_FROM).raw<[string, string, string, string | null, number | null, number]>())
      .sort((a, b) => b[5] - a[5])
      .map((r): SearchRow => [...r, fold(r[1]), fold(r[2]), fold(r[3])]));
  const f = fold(q);
  const songs: object[] = [];
  const artists = new Map<string, { artist: string; tracks: number; plays: number }>();
  const albums = new Map<string, { album: string; artist: string; tracks: number; year: number | null }>();
  for (const [id, title, artist, album, year, plays, ft, fa, fal] of rows) {
    if (ft.includes(f)) songs.push({ track_id: id, title, artist, album, year, plays });
    if (artist && fa.includes(f)) {
      const a = artists.get(artist) ?? { artist, tracks: 0, plays: 0 };
      a.tracks++; a.plays += plays;
      artists.set(artist, a);
    }
    if (album && fal.includes(f)) {
      const k = artist + "\x1f" + album;
      const al = albums.get(k) ?? { album, artist, tracks: 0, year };
      al.tracks++;
      albums.set(k, al);
    }
  }
  return {
    artists: [...artists.values()].sort((a, b) => b.plays - a.plays).slice(0, limit),
    songs: songs.slice(0, limit),
    albums: [...albums.values()].sort((a, b) => b.tracks - a.tracks).slice(0, limit),
  };
}

// Title replacement rules ("quy tắc thay thế"): Last.fm sends a title, the user really played a
// different library track, e.g. "Time" → "Time 2.1" (Wintersun). Stored as aliases with
// origin 'rule', limited to the target track's artist, so "Time" by Helloween stays Helloween's.
// Rules win over every other alias. Adding a rule also relinks plays already matched elsewhere.
export interface TitleRule { from: string; to?: string; artist?: string; track_id?: string }

export async function listTitleRules(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT a.key_title AS from_key, MIN(a.key_artist) AS artist_key, a.track_id, t.title, COALESCE(t.album_artist, t.artist) AS artist
     FROM aliases a JOIN tracks t ON t.id = a.track_id WHERE a.origin = 'rule'
     GROUP BY a.key_title, a.track_id ORDER BY a.key_title`,
  ).all();
  return results;
}

export async function addTitleRules(env: Env, rules: TitleRule[]) {
  const out: { from: string; to: string; status: "ok" | "not_found" | "ambiguous"; track_id?: string; artist?: string; relinked?: number; candidates?: unknown[] }[] = [];
  for (const r of rules) {
    if (!r?.from || (!r?.to && !r?.track_id)) continue;
    const from = matchKey(r.from);
    const { results: hits } = r.track_id
      ? await env.DB.prepare(
        "SELECT id, title, key_artist, key_album_artist, COALESCE(album_artist, artist) AS artist FROM tracks WHERE id = ?1",
      ).bind(r.track_id).all<{ id: string; title: string; key_artist: string; key_album_artist: string; artist: string }>()
      : await env.DB.prepare(
        "SELECT id, title, key_artist, key_album_artist, COALESCE(album_artist, artist) AS artist FROM tracks WHERE key_title = ?1",
      ).bind(matchKey(r.to!)).all<{ id: string; title: string; key_artist: string; key_album_artist: string; artist: string }>();
    const wanted = r.artist ? matchKey(r.artist) : null;
    const pick = wanted ? hits.filter((h) => h.key_artist === wanted || h.key_album_artist === wanted) : hits;
    if (pick.length !== 1) {
      out.push({ from: r.from, to: r.to || r.track_id || "", status: pick.length ? "ambiguous" : "not_found", candidates: pick.map((h) => ({ id: h.id, artist: h.artist })) });
      continue;
    }
    const t = pick[0];
    const artists = [...new Set([t.key_artist, t.key_album_artist].filter(Boolean))];
    const res = await env.DB.batch([
      ...artists.map((a) => env.DB.prepare(
        "INSERT OR REPLACE INTO aliases (key_artist, key_title, key_album, track_id, origin) VALUES (?1, ?2, '', ?3, 'rule')",
      ).bind(a, from, t.id)),
      // relink plays with that exact title by that artist, including ones matched to another track
      env.DB.prepare(
        `UPDATE plays SET track_id = ?1, match_tried = 1
         WHERE source = 'lastfm' AND lower(trim(title)) = ?2 AND lower(trim(artist)) IN (?3, ?4) AND COALESCE(track_id, '') <> ?1`,
      ).bind(t.id, from, artists[0], artists[1] ?? artists[0]),
    ]);
    out.push({ from: r.from, to: t.title, status: "ok", track_id: t.id, artist: t.artist, relinked: res.at(-1)!.meta.changes ?? 0 });
  }
  return out;
}

export async function deleteTitleRule(env: Env, from: string) {
  const res = await env.DB.prepare("DELETE FROM aliases WHERE origin = 'rule' AND key_title = ?1").bind(matchKey(from)).run();
  return { deleted: res.meta.changes ?? 0 };
}

// Rules the user can switch. Only rules the server actually applies are listed; Last.fm decides
// what counts as a scrobble, and weeks start on Monday as in Lark.
export const RULES = {
  mergeRemaster: { label: "Gộp bản remaster vào bài gốc", default: true },
} as const;
export type RuleKey = keyof typeof RULES;

export async function getRules(env: Env): Promise<Record<RuleKey, boolean>> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'rules'").first<{ value: string }>();
  const saved = row ? JSON.parse(row.value) : {};
  return Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, typeof saved[k] === "boolean" ? saved[k] : r.default])) as Record<RuleKey, boolean>;
}

export async function setRules(env: Env, patch: Record<string, unknown>) {
  const rules = await getRules(env);
  for (const k of Object.keys(RULES) as RuleKey[]) if (typeof patch[k] === "boolean") rules[k] = patch[k] as boolean;
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('rules', ?1)").bind(JSON.stringify(rules)).run();
  return rules;
}

/** Chi tiết bài hát. */
export async function songDetail(env: Env, id: string, asOf: string) {
  const db = env.DB;
  const res = await db.batch<any>([
    db.prepare("SELECT * FROM tracks WHERE id = ?1").bind(id),
    db.prepare(
      `SELECT substr(play_date, 1, 7) AS month, COUNT(*) AS plays FROM plays
       WHERE track_id = ?1 AND play_date <= ?2 GROUP BY 1 ORDER BY 1`,
    ).bind(id, asOf),
    db.prepare(
      `SELECT period, MIN(rank) AS rank FROM rank_snapshots WHERE kind = 'song' AND entity_id = ?1
       GROUP BY period ORDER BY substr(period, 5, 2), substr(period, 2, 2)`,
    ).bind(id),
    db.prepare(
      `SELECT MIN(play_date) AS first, MAX(play_date) AS last, COUNT(*) AS logged,
              SUM(play_date >= ?3) AS since_cutover FROM plays WHERE track_id = ?1 AND play_date <= ?2`,
    ).bind(id, asOf, env.LASTFM_FROM),
  ]);
  const track = res[0].results[0];
  if (!track) return null;
  const [chart, ratings, rankHistory] = await Promise.all([
    songsAt(env, asOf),
    ratingsByTrack(env, asOf),
    completeSongRankHistory(env, id, asOf, res[1].results, res[2].results),
  ]);
  const at = chart.find((s) => s.track_id === id) ?? null;
  return {
    track,
    allTime: at ? { rank: at.rank, level: at.level, plays: at.plays, minutes: at.minutes } : null,
    rating: ratings.get(id) ?? null,
    plays: res[3].results[0],
    months: res[1].results,
    rankHistory,
  };
}
