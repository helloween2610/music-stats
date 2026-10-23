// All-time album rank, following Lark "3. ALBUM" (R AT):
//   hours   = Σ duration × (Apple baseline + plays since LASTFM_FROM) over the album's tracks
//   level   lv3: 24 h or more · lv2: album of 45 min or more with 5–24 h ·
//           lv1: album of 15–45 min with 2–24 h, or album of 45 min or more under 5 h
//   rank    by level, then hours; albums under 15 min with under 24 h get no level
//   exclude album name with Archive / Sopor Aeternus Collect / Valkyrja / Gone - A Collection /
//           Walking Cloud / One Step More / Rays Of Darkness, or a track with genre NHAC / PIANO /
//           CLASSICAL INSTRU.
// Lark's table stopped updating after T07/25 (hours read 0, every album ranked 1), so its values
// can't be compared; this follows the formulas as written.
import type { Env } from "./index";

const EXCLUDED_ALBUM_WORDS = ["Archive", "Sopor Aeternus Collect", "Valkyrja", "Gone - A Collection", "Walking Cloud", "One Step More", "Rays Of Darkness"];
const EXCLUDED_ALBUM_GENRES = ["NHAC", "PIANO", "CLASSICAL INSTRU."];

/** Binds ?1 = asOf, ?2 = LASTFM_FROM. Columns: rank, album_artist, album, level, hours, tracks. */
export const ALBUM_AT_SQL = `
  WITH since AS (SELECT track_id, COUNT(*) AS n FROM plays
                 WHERE track_id IS NOT NULL AND play_date >= ?2 AND play_date <= ?1 GROUP BY track_id),
  a AS (
    SELECT t.album_artist, t.album, COUNT(*) AS tracks, SUM(COALESCE(t.duration_s, 0)) AS dur,
           SUM(COALESCE(t.duration_s, 0) * (t.plays_to_12_2024 + COALESCE(s.n, 0))) / 3600.0 AS hours,
           MAX(${[
             ...EXCLUDED_ALBUM_WORDS.map((w) => `t.album LIKE '%${w}%'`),
             ...EXCLUDED_ALBUM_GENRES.map((g) => `COALESCE(t.genre, '') LIKE '%${g}%'`),
           ].join(" OR ")}) AS excluded
    FROM tracks t LEFT JOIN since s ON s.track_id = t.id
    WHERE t.album_artist IS NOT NULL AND t.album IS NOT NULL
    GROUP BY t.album_artist, t.album),
  lv AS (
    SELECT *, CASE WHEN hours >= 24 THEN 3
                   WHEN dur >= 2700 AND hours >= 5 THEN 2
                   WHEN (dur > 900 AND dur < 2700 AND hours >= 2) OR (dur >= 2700 AND hours < 5) THEN 1 END AS level
    FROM a WHERE hours > 0 AND excluded = 0)
  SELECT RANK() OVER (ORDER BY level DESC, hours DESC) AS rank, album_artist, album, level,
         ROUND(hours, 1) AS hours, tracks
  FROM lv WHERE level IS NOT NULL`;

export async function albumChart(env: Env, asOf: string, limit: number) {
  const { results } = await env.DB.prepare(`${ALBUM_AT_SQL} ORDER BY rank LIMIT ?3`).bind(asOf, env.LASTFM_FROM, limit).all();
  return results;
}

const ALBUM_TRACK_BONUS_CAP = 12;
const normalize = (value: string) => value.normalize("NFC").trim().toLowerCase();
const canonicalAlbum = (artist: string, album: string) =>
  normalize(artist) === "in flames" && ["the jester race", "the jester race (black ash-inheritance version)"].includes(normalize(album))
    ? "The Jester Race"
    : album;
const albumKey = (artist: string, album: string) => `${artist}\u001f${canonicalAlbum(artist, album)}`;
const excludedAlbum = (album: string, genre = "") =>
  EXCLUDED_ALBUM_WORDS.some((word) => album.toLowerCase().includes(word.toLowerCase()))
  || EXCLUDED_ALBUM_GENRES.some((word) => genre.toLowerCase().includes(word.toLowerCase()));

type AlbumHistoryTrack = {
  id: string;
  artist: string;
  album: string;
  duration_s: number;
  plays_to_12_2024: number;
  genre: string;
};
type AlbumHistoryPlay = { track_id: string; month: string; plays: number };

const nextMonth = (ym: string) => {
  const [year, month] = ym.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
};

/** Build one album's monthly listening hours and cumulative All-time rank in one pass. */
export function albumHistoryFromRows(
  tracks: AlbumHistoryTrack[],
  plays: AlbumHistoryPlay[],
  artist: string,
  album: string,
  fromMonth: string,
  toMonth: string,
  months = 36,
) {
  const albums = new Map<string, {
    artist: string; album: string; tracks: number; duration: number; seconds: number; excluded: boolean;
  }>();
  const trackAlbums = new Map<string, string>();
  const trackDurations = new Map<string, number>();
  for (const track of tracks) {
    const key = albumKey(track.artist, track.album);
    const row = albums.get(key) || {
      artist: track.artist,
      album: canonicalAlbum(track.artist, track.album),
      tracks: 0,
      duration: 0,
      seconds: 0,
      excluded: false,
    };
    const duration = Number(track.duration_s) || 0;
    row.tracks += 1;
    row.duration += duration;
    row.seconds += duration * (Number(track.plays_to_12_2024) || 0);
    row.excluded ||= excludedAlbum(track.album, track.genre || "");
    albums.set(key, row);
    trackAlbums.set(track.id, key);
    trackDurations.set(track.id, duration);
  }
  const byMonth = new Map<string, AlbumHistoryPlay[]>();
  for (const play of plays) {
    const rows = byMonth.get(play.month) || [];
    rows.push(play);
    byMonth.set(play.month, rows);
  }
  const targetKey = albumKey(artist, album);
  if (!albums.has(targetKey)) return { rows: [], currentRank: null };
  const history: { period: string; hours: number; rank: number | null }[] = [];
  for (let period = fromMonth; period <= toMonth; period = nextMonth(period)) {
    let monthSeconds = 0;
    for (const play of byMonth.get(period) || []) {
      const key = trackAlbums.get(play.track_id);
      const row = key ? albums.get(key) : undefined;
      const duration = trackDurations.get(play.track_id);
      if (!row || duration == null) continue;
      const seconds = duration * (Number(play.plays) || 0);
      row.seconds += seconds;
      if (key === targetKey) monthSeconds += seconds;
    }
    const ranked = [...albums.entries()].flatMap(([key, row]) => {
      const hours = row.seconds / 3600;
      const level = row.seconds >= 86400 ? 3
        : row.duration >= 2700 && row.seconds >= 18000 ? 2
        : (row.duration > 900 && row.duration < 2700 && row.seconds >= 7200) || (row.duration >= 2700 && row.seconds < 18000) ? 1 : 0;
      if (!(row.seconds > 0) || row.excluded || !level) return [];
      const trackFactor = Math.sqrt(Math.min(row.tracks, ALBUM_TRACK_BONUS_CAP) / ALBUM_TRACK_BONUS_CAP);
      return [{ key, ...row, hours, level, score: hours * trackFactor }];
    }).sort((a, b) => b.score - a.score || b.seconds - a.seconds || a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
    let rank = 0;
    let targetRank: number | null = null;
    ranked.forEach((row, index) => {
      if (!index || row.score !== ranked[index - 1].score || row.seconds !== ranked[index - 1].seconds) rank = index + 1;
      if (row.key === targetKey) targetRank = rank;
    });
    history.push({ period, hours: Math.round(monthSeconds / 36) / 100, rank: targetRank });
  }
  const rows = history.slice(-Math.max(1, months));
  return { rows, currentRank: rows.at(-1)?.rank ?? null };
}

export async function albumHistory(env: Env, asOf: string, artist: string, album: string, months: number) {
  const [trackResult, playResult] = await env.DB.batch<any>([
    env.DB.prepare(`SELECT id, COALESCE(album_artist, artist) AS artist, album,
      COALESCE(duration_s, 0) AS duration_s, COALESCE(plays_to_12_2024, 0) AS plays_to_12_2024,
      COALESCE(genre, '') AS genre FROM tracks WHERE album IS NOT NULL AND COALESCE(album_artist, artist) IS NOT NULL`),
    env.DB.prepare(`SELECT track_id, substr(play_date, 1, 7) AS month, COUNT(*) AS plays
      FROM plays WHERE track_id IS NOT NULL AND play_date BETWEEN ?1 AND ?2 GROUP BY track_id, month`)
      .bind(env.LASTFM_FROM, asOf),
  ]);
  return albumHistoryFromRows(trackResult.results, playResult.results, artist, album, env.LASTFM_FROM.slice(0, 7), asOf.slice(0, 7), months);
}
