// All-time song ranks, matching Lark "1.1 SONG AT" (R AT) and "1.2 SONG AT (fT4-24)" (R AT).
//
// plays:   at     = Apple baseline "Plays to 12/2024" + plays since LASTFM_FROM
//          ft0424 = every logged play (the log starts in April 2024)
// level:   songs under 6 min by plays (lv1 = 1–9, one level per 10 plays up to lv10 = 90–99),
//          songs of 6 min or more by minutes listened (one level per 60 min up to lv10 = 540–599);
//          then lv12 = 100–119 plays / 600–719 min, lv15 = 120–149 / 720–899, lv20 = 150+ / 900+
// contextual songs use their selected weight for level and rank; displayed totals stay raw
// score:   level × 10000 + 1 + number of songs in the same level with fewer weighted minutes
//          (excluded songs still count here, as in Lark)
// rank:    by score; "at" breaks ties by minutes since April 2024; ties share a rank
// exclude: MONO under 450 min, No Clear Mind or album "Nights of Wonder" under 600 min,
//          comments "Stop rating" / "Archive", genre NHAC / PIANO (ft0424: 150 / 200 / 200 min)
// Verified against Lark's exported values: 1.1 3173/3173, 1.2 1231/1231 (scripts/validate_alltime.py).
// Difference: Lark ranked only songs someone had added to 1.1/1.2 by hand; this ranks every library track.
import type { Env } from "./index";

export type AllTimeMode = "at" | "ft0424";

const LIMITS = { at: { mono: 450, other: 600 }, ft0424: { mono: 150, other: 200 } };

export function allTimeSql(mode: AllTimeMode) {
  const lim = LIMITS[mode];
  const pc = mode === "at" ? "pc_at" : "pc_log";
  const tieBreak = mode === "at" ? ", rank_ts_log DESC" : "";
  return `
    WITH counts AS (
      SELECT track_id, COUNT(*) AS pc_log, SUM(play_date >= ?2) AS pc_since
      FROM plays WHERE track_id IS NOT NULL AND play_date <= ?1 GROUP BY track_id
    ),
    base AS (
      SELECT t.id, t.title, COALESCE(t.album_artist, t.artist) AS artist,
             -- '' instead of NULL so the exclusion test is never NULL
             COALESCE(t.album_artist, '') AS album_artist, COALESCE(t.album, '') AS album,
             COALESCE(t.comments, '') AS comments, COALESCE(t.genre, '') AS genre, COALESCE(t.duration_s, 0) AS dur,
             COALESCE(c.pc_log, 0) AS pc_log,
             COALESCE(t.rank_weight_custom, t.rank_weight, 1) AS rank_weight,
             t.plays_to_12_2024 + COALESCE(c.pc_since, 0) AS pc_at
      FROM tracks t LEFT JOIN counts c ON c.track_id = t.id
    ),
    m AS (
      SELECT *, ${pc} AS pc, ${pc} * rank_weight AS rank_pc,
             dur * ${pc} / 60.0 AS ts, dur * ${pc} * rank_weight / 60.0 AS rank_ts,
             dur * pc_log / 60.0 AS ts_log, dur * pc_log * rank_weight / 60.0 AS rank_ts_log FROM base
    ),
    lv AS (
      SELECT *,
        CASE WHEN dur < 360 THEN
          CASE WHEN rank_pc >= 150 THEN 20 WHEN rank_pc >= 120 THEN 15 WHEN rank_pc >= 100 THEN 12
               WHEN rank_pc > 0 THEN CAST(rank_pc / 10 AS INTEGER) + 1 END
        ELSE
          CASE WHEN rank_ts >= 900 THEN 20 WHEN rank_ts >= 720 THEN 15 WHEN rank_ts >= 600 THEN 12
               WHEN rank_ts > 0 THEN CAST(rank_ts / 60 AS INTEGER) + 1 END
        END AS lv,
        (    (album_artist = 'MONO' AND ts < ${lim.mono})
          OR (album_artist LIKE '%No Clear Mind%' AND ts < ${lim.other})
          OR (album LIKE '%Nights of Wonder%' AND ts < ${lim.other})
          OR comments LIKE '%Stop rating%' OR comments LIKE '%Archive%'
          OR genre LIKE '%NHAC%' OR genre LIKE '%PIANO%') AS excluded
      FROM m
    ),
    scored AS (
      SELECT *, lv * 10000 + RANK() OVER (PARTITION BY lv ORDER BY rank_ts) AS score
      FROM lv WHERE lv IS NOT NULL
    )
    SELECT RANK() OVER (ORDER BY score DESC${tieBreak}) AS rank,
           id AS track_id, title, artist, lv AS level, pc AS plays, ROUND(ts) AS minutes, rank_weight
    FROM scored WHERE excluded = 0`;
}

export interface AllTimeRow {
  rank: number;
  track_id: string;
  title: string;
  artist: string | null;
  level: number;
  plays: number;
  minutes: number;
  rank_weight: number;
}

export async function allTimeChart(env: Env, mode: AllTimeMode, asOf: string, limit: number) {
  const { results } = await env.DB.prepare(`${allTimeSql(mode)} ORDER BY rank LIMIT ?3`)
    .bind(asOf, env.LASTFM_FROM, limit)
    .all<AllTimeRow>();
  return results;
}
