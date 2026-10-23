// Cover art and artist pictures for the app.
//   album  Last.fm album.getInfo (300×300), else Deezer album search (cover_big)
//   artist Deezer artist search (picture_big); Last.fm stopped serving artist images
// The cron fills a few per run: recent library album covers first, then popular albums/artists.
// POST /artwork/fill does a bigger batch by hand. Misses are stored as '' and retried after 30 days.
import type { Env } from "./index";
import { fold } from "./library";

const RETRY_DAYS = 30;
const RECENT_DAYS = 7;
type ArtworkCandidate = { k: string; a: string; b: string | null };

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "user-agent": "music-stats (personal)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function lastfmAlbum(env: Env, artist: string, album: string): Promise<string> {
  const qs = new URLSearchParams({ method: "album.getinfo", artist, album, api_key: env.LASTFM_API_KEY, format: "json", autocorrect: "1" });
  const body = await getJson(`https://ws.audioscrobbler.com/2.0/?${qs}`);
  const images: { size: string; "#text": string }[] = body.album?.image ?? [];
  const url = images.find((i) => i.size === "extralarge")?.["#text"] || images.at(-1)?.["#text"] || "";
  // Last.fm's grey star placeholder means "no image"
  return url.includes("2a96cbd8b46e442fc41c2b86b821562f") ? "" : url;
}

async function deezerAlbum(artist: string, album: string): Promise<string> {
  const q = encodeURIComponent(`artist:"${artist}" album:"${album}"`);
  const body = await getJson(`https://api.deezer.com/search/album?q=${q}&limit=5`);
  const hit = (body.data ?? []).find((d: any) => fold(d.title) === fold(album) || fold(d.title).startsWith(fold(album)));
  return hit?.cover_big ?? "";
}

async function deezerArtist(name: string): Promise<string> {
  const body = await getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`);
  const hit = (body.data ?? []).find((d: any) => fold(d.name) === fold(name));
  const url: string = hit?.picture_big ?? "";
  // Deezer's default silhouette has an empty hash segment
  return url.includes("/artist//") ? "" : url;
}

/** Fill recent library covers first; use any remaining slots for popular albums/artists. */
export async function fillArtwork(env: Env, max: number) {
  const retry = `datetime('now', '-${RETRY_DAYS} days')`;
  // Check recent plays even after today's queue was exhausted: a new sync may add a new album.
  const recent = await env.DB.prepare(
    `SELECT t.album_artist || char(31) || t.album AS k, t.album_artist AS a, t.album AS b
     FROM plays p JOIN tracks t ON t.id = p.track_id
     WHERE p.played_at >= ?1 AND t.in_library = 1
       AND t.album_artist IS NOT NULL AND t.album_artist <> '' AND t.album IS NOT NULL AND t.album <> ''
       AND NOT EXISTS (SELECT 1 FROM artwork a WHERE a.kind = 'album'
         AND a.key = t.album_artist || char(31) || t.album
         AND (a.url <> '' OR a.fetched_at > ${retry}))
     GROUP BY t.album_artist, t.album ORDER BY MAX(p.played_at) DESC, k LIMIT ?2`,
  ).bind(Math.floor(Date.now() / 1000) - RECENT_DAYS * 86400, max).all<ArtworkCandidate>();
  const todo: (ArtworkCandidate & { kind: 'album' | 'artist' })[] = recent.results.map(t => ({ kind: 'album', ...t }));
  const priorityKeys = new Set(recent.results.map(t => t.k));
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const done = await env.DB.prepare("SELECT value FROM sync_state WHERE key = 'artwork_done'").first<{ value: string }>();
  if (!todo.length && done?.value === today) return { looked: 0, found: 0, failed: 0 };
  if (todo.length < max && done?.value !== today) {
    const [albums, artists] = await env.DB.batch<ArtworkCandidate>([
      env.DB.prepare(
        `SELECT album_artist || char(31) || album AS k, album_artist AS a, album AS b FROM tracks
         WHERE album_artist IS NOT NULL AND album IS NOT NULL AND album <> ''
           AND album_artist || char(31) || album NOT IN
               (SELECT key FROM artwork WHERE kind = 'album' AND (url <> '' OR fetched_at > ${retry}))
         GROUP BY 1 ORDER BY SUM(plays_to_12_2024 + apple_plays) DESC LIMIT ?1`,
      ).bind(max),
      env.DB.prepare(
        `SELECT COALESCE(album_artist, artist) AS k, COALESCE(album_artist, artist) AS a, NULL AS b FROM tracks
         WHERE COALESCE(album_artist, artist) IS NOT NULL
           AND COALESCE(album_artist, artist) NOT IN
               (SELECT key FROM artwork WHERE kind = 'artist' AND (url <> '' OR fetched_at > ${retry}))
         GROUP BY 1 ORDER BY SUM(plays_to_12_2024 + apple_plays) DESC LIMIT ?1`,
      ).bind(max),
    ]);
    const remainingAlbums = albums.results.filter(t => !priorityKeys.has(t.k));
    for (let i = 0; todo.length < max && (i < remainingAlbums.length || i < artists.results.length); i++) {
      if (remainingAlbums[i]) todo.push({ kind: "album", ...remainingAlbums[i] });
      if (artists.results[i] && todo.length < max) todo.push({ kind: "artist", ...artists.results[i] });
    }
  }
  if (!todo.length) {
    await env.DB.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('artwork_done', ?1, datetime('now'))")
      .bind(today).run();
    return { looked: 0, found: 0, failed: 0 };
  }
  const save = env.DB.prepare(
    "INSERT OR REPLACE INTO artwork (kind, key, url, source, fetched_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))",
  );
  const stmts: D1PreparedStatement[] = [];
  let found = 0, failed = 0;
  for (const t of todo) {
    try {
      let url = "", source = "";
      if (t.kind === "album") {
        url = await lastfmAlbum(env, t.a, t.b!);
        source = url ? "lastfm" : "";
        if (!url) { url = await deezerAlbum(t.a, t.b!); source = url ? "deezer" : ""; }
      } else {
        url = await deezerArtist(t.a);
        source = url ? "deezer" : "";
      }
      if (url) found++;
      stmts.push(save.bind(t.kind, t.k, url, source || null));
    } catch {
      failed++; // network / rate limit: try again next run
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { looked: stmts.length, found, failed };
}

/**
 * Picture map for the app: artists by name, songs by track id (their album's cover). One call per
 * app session; look up `artists[name]` and `tracks[track_id]`.
 */
export async function artworkMap(env: Env) {
  const [artists, tracks, albums] = await env.DB.batch<any>([
    env.DB.prepare("SELECT key, url FROM artwork WHERE kind = 'artist' AND url <> ''"),
    env.DB.prepare(
      `SELECT t.id, a.url FROM tracks t JOIN artwork a ON a.kind = 'album' AND a.key = t.album_artist || char(31) || t.album
       WHERE a.url <> ''`,
    ),
    env.DB.prepare("SELECT key, url FROM artwork WHERE kind = 'album' AND url <> ''"),
  ]);
  return {
    artists: Object.fromEntries(artists.results.map((r: any) => [r.key, r.url])),
    tracks: Object.fromEntries(tracks.results.map((r: any) => [r.id, r.url])),
    // albums keyed "album artist" + "\u001f" + "album", as in /charts/albums and /board
    albums: Object.fromEntries(albums.results.map((r: any) => [r.key, r.url])),
  };
}
