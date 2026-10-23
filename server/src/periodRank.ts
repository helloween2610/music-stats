// Song rank within a calendar period (week Mon–Sun or month), matching Lark
// "Song R WW*" (Song PC WW data+) and "Song R MM*" (Song PC MM data+):
//   1. plays linked to a library track, counted per track in the period
//      (week: excluded plays don't count; month: all plays count, as in Lark)
//   2. one entry per song key = title + album artist (lowercase); the song's first play
//      in the period represents it (Lark "Record ID_Song WW/MM = 0")
//   3. order: plays DESC, duration DESC, first play in the period LATER first
//   4. a song whose representative play is excluded gets no rank; ties share a rank
// Exclusion is per play, as in Lark (it looks at the album name of the scrobble).
// Play order: Lark rows keep their Lark Record ID, Last.fm rows come after, by time.
import type { Env } from "./index";

/** Lark "EXCLUDE" of Song PC MM data+, per play `p` joined to its track `t`. */
export const EXCLUDED_PLAY_SQL = `(
       p.album LIKE '%Archive%'
    OR (t.album_artist = 'No Clear Mind' AND (p.album LIKE '%Mets%' OR p.album LIKE '%Dream%'))
    OR t.comments LIKE '%Stop rating%'
    OR lower(p.title) IN (SELECT lower(p2.title) FROM tracks t2 CROSS JOIN plays p2 ON p2.track_id = t2.id
                          WHERE t2.genre LIKE '%NHAC%' OR t2.genre LIKE '%PIANO%' OR t2.genre LIKE '%SOUNDTRACK%'))`;
// CROSS JOIN keeps SQLite from scanning every play: it reads the few NHAC / PIANO / SOUNDTRACK tracks
// first, then their plays through the plays_track index.

export const PLAY_SEQ_SQL = "COALESCE(p.lark_record, 1000000000 + p.played_at, 2000000000 + p.id)";

export type PeriodKind = "week" | "month";

export interface PeriodRankRow {
  rank: number;
  track_id: string;
  title: string;
  artist: string | null;
  plays: number;
}

/** SQL body shared with scripts/validate_period_rank.py ({PER} = period expression or a constant). */
export function periodRankSql(kind: PeriodKind, per: string, where: string) {
  const countWhere = kind === "week" ? "WHERE excl = 0" : "";
  return `
    WITH m AS (
      SELECT ${per} AS per, p.track_id, ${PLAY_SEQ_SQL} AS seq, t.duration_s AS dur,
             lower(t.title) AS kt, lower(COALESCE(t.album_artist, '')) AS ka,
             CASE WHEN ${EXCLUDED_PLAY_SQL} THEN 1 ELSE 0 END AS excl
      FROM plays p JOIN tracks t ON t.id = p.track_id
      ${where}),
    pc AS (SELECT per, track_id, COUNT(*) AS pc FROM m ${countWhere} GROUP BY per, track_id),
    reps AS (SELECT m.per, m.track_id, m.dur, m.seq, m.excl FROM m
             JOIN (SELECT per, kt, ka, MIN(seq) AS seq FROM m GROUP BY per, kt, ka) f
               ON f.per = m.per AND f.kt = m.kt AND f.ka = m.ka AND f.seq = m.seq)
    SELECT reps.per, reps.track_id, pc.pc AS plays, COALESCE(t.rank_weight_custom, t.rank_weight, 1) AS rank_weight,
           RANK() OVER (PARTITION BY reps.per ORDER BY pc.pc * COALESCE(t.rank_weight_custom, t.rank_weight, 1) DESC, reps.dur DESC, reps.seq DESC) AS rank
    FROM reps JOIN pc ON pc.per = reps.per AND pc.track_id = reps.track_id
    JOIN tracks t ON t.id = reps.track_id
    WHERE reps.excl = 0`;
}

export async function periodSongRank(env: Env, kind: PeriodKind, from: string, to: string, limit: number) {
  const { results } = await env.DB.prepare(
    `WITH r AS (${periodRankSql(kind, "'p'", "WHERE p.play_date BETWEEN ?1 AND ?2")})
     SELECT r.rank, t.id AS track_id, t.title, COALESCE(t.album_artist, t.artist) AS artist, r.plays
     FROM r JOIN tracks t ON t.id = r.track_id
     ORDER BY r.rank LIMIT ?3`,
  )
    .bind(from, to, limit)
    .all<PeriodRankRow>();
  return results;
}
