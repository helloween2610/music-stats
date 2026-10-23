// Artist charts, matching Lark "2. ARTIST" / "Artist Evolution":
//   at          hours = Σ duration × (Apple baseline + plays since LASTFM_FROM) over the artist's tracks
//   ft0424      hours of every logged play; for No Clear Mind / I Am No Hero only plays that aren't
//               excluded count; artists whose plays are all excluded get no rank (Lark "Artist R AT (fT04/24)*")
//   7d, 1m, 100d plays in the last N days, ties broken by hours
//   week, month hours in the calendar period (week: see the competitor rule in artistSql)
// tracks = songs played in the window (all-time: library songs with any play), shown as "n bài".
// Artist = the track's album artist (Lark groups by "Album Artist"). Ties share a rank.
import type { Env } from "./index";
import { EXCLUDED_PLAY_SQL, PLAY_SEQ_SQL } from "./periodRank";

export type ArtistWindow = "at" | "ft0424" | "7d" | "1m" | "100d" | "week" | "month";

export interface ArtistRow {
  rank: number;
  artist: string;
  plays: number;
  hours: number;
  tracks: number;
}

const ROLLING = { "7d": 7, "1m": 30, "100d": 100 } as const;

/** Binds: ?1 = asOf, ?2 = LASTFM_FROM, ?3 = period start (week/month), ?4 = limit. */
export function artistSql(window: ArtistWindow) {
  const who = "COALESCE(t.album_artist, t.artist)";
  if (window === "at") {
    return `
      WITH since AS (SELECT track_id, COUNT(*) AS n FROM plays
                     WHERE track_id IS NOT NULL AND play_date >= ?2 AND play_date <= ?1 GROUP BY track_id),
      a AS (SELECT ${who} AS artist,
                   SUM(t.plays_to_12_2024 + COALESCE(s.n, 0)) AS plays,
                   SUM(COALESCE(t.duration_s, 0) * (t.plays_to_12_2024 + COALESCE(s.n, 0))) / 3600.0 AS hours,
                   SUM(t.plays_to_12_2024 + COALESCE(s.n, 0) > 0) AS tracks
            FROM tracks t LEFT JOIN since s ON s.track_id = t.id
            WHERE ${who} IS NOT NULL AND ?3 IS NOT NULL GROUP BY 1)
      SELECT RANK() OVER (ORDER BY hours DESC) AS rank, artist, plays, ROUND(hours, 1) AS hours, tracks
      FROM a WHERE hours > 0 ORDER BY rank LIMIT ?4`;
  }
  if (window === "ft0424") {
    // Lark ranks an artist only if at least one of their plays isn't excluded (so TCS / NHAC and
    // Ludovico Einaudi / PIANO drop out); hours still count every play except for the two special artists.
    return `
      WITH x AS (
        SELECT ${who} AS artist, p.track_id, COALESCE(t.duration_s, 0) AS dur,
               COALESCE(${EXCLUDED_PLAY_SQL}, 0) AS excl,
               (${who} LIKE '%No Clear%' OR ${who} LIKE '%I Am No%') AS special
        FROM plays p JOIN tracks t ON t.id = p.track_id
        WHERE p.play_date <= ?1 AND ?2 IS NOT NULL AND ?3 IS NOT NULL),
      a AS (
        SELECT artist, SUM(CASE WHEN special AND excl THEN 0 ELSE 1 END) AS plays,
               SUM(CASE WHEN special AND excl THEN 0 ELSE dur END) / 3600.0 AS hours,
               COUNT(DISTINCT track_id) AS tracks
        FROM x WHERE artist IS NOT NULL GROUP BY artist HAVING SUM(excl = 0) > 0)
      SELECT RANK() OVER (ORDER BY hours DESC) AS rank, artist, plays, ROUND(hours, 1) AS hours, tracks
      FROM a ORDER BY rank LIMIT ?4`;
  }
  if (window === "week") {
    // Lark "Artist R WW*": rank by hours in the week, but an artist only counts as someone ahead
    // when their first play of the week isn't excluded (their hours cell is blank otherwise).
    return `
      WITH x AS (
        SELECT ${who} AS artist, p.track_id, COALESCE(t.duration_s, 0) AS dur, ${PLAY_SEQ_SQL} AS seq,
               COALESCE(${EXCLUDED_PLAY_SQL}, 0) AS excl
        FROM plays p JOIN tracks t ON t.id = p.track_id
        WHERE p.play_date BETWEEN ?3 AND ?1 AND ?2 IS NOT NULL),
      a AS (SELECT artist, COUNT(*) AS plays, SUM(dur) / 3600.0 AS hours, MIN(seq) AS first_seq,
                   COUNT(DISTINCT track_id) AS tracks
            FROM x WHERE artist IS NOT NULL GROUP BY artist),
      comp AS (SELECT a.hours FROM a JOIN x ON x.artist = a.artist AND x.seq = a.first_seq WHERE x.excl = 0)
      SELECT 1 + (SELECT COUNT(*) FROM comp WHERE comp.hours > a.hours + 1e-9) AS rank,
             artist, plays, ROUND(hours, 1) AS hours, tracks
      FROM a ORDER BY rank, hours DESC LIMIT ?4`;
  }
  let where: string;
  let order = "hours DESC";
  if (window in ROLLING) {
    where = `julianday(?1) - julianday(p.play_date) BETWEEN 0 AND ${ROLLING[window as keyof typeof ROLLING]}`;
    order = "plays DESC, hours DESC";
  } else {
    where = "p.play_date BETWEEN ?3 AND ?1";
  }
  return `
    WITH a AS (
      SELECT ${who} AS artist, COUNT(*) AS plays, SUM(COALESCE(t.duration_s, 0)) / 3600.0 AS hours,
             COUNT(DISTINCT p.track_id) AS tracks
      FROM plays p JOIN tracks t ON t.id = p.track_id
      WHERE ${where} AND ?2 IS NOT NULL AND ?3 IS NOT NULL
      GROUP BY 1)
    SELECT RANK() OVER (ORDER BY ${order}) AS rank, artist, plays, ROUND(hours, 1) AS hours, tracks
    FROM a WHERE artist IS NOT NULL ORDER BY rank LIMIT ?4`;
}

export async function artistChart(env: Env, window: ArtistWindow, asOf: string, periodFrom: string, limit: number) {
  const { results } = await env.DB.prepare(artistSql(window)).bind(asOf, env.LASTFM_FROM, periodFrom, limit).all<ArtistRow>();
  return results;
}
