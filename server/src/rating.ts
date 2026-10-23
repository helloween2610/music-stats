// Song rating 0–10, matching Lark "Song data" RA AT* (via RA AT_):
//   comments "Archive"      → 0
//   comments "Stop rating"  → the Apple rating instead (0–100 / 20, i.e. 0–5 stars)
//   under 6 min: by plays (Apple baseline + plays since LASTFM_FROM), thresholds by days in library
//     > 90 days: 240/220/200/180/150/100/70/50/30/10 → 10..1
//     > 30 days: 150/100/80/60/40/20/10 → 7..1
//     > 0 days:  50/30/20/10 → 4..1
//   6 min or more: by hours listened, same structure
//     > 90 days: 24/22/20/18/15/10/7/5/3/1 → 10..1;  > 30 days: 15/10/8/6/4/2/1 → 7..1;  > 0: 5/3/2/1 → 4..1
//   added today (0 days) → no rating, as in Lark.
// Lark also defines stricter scales for MONO / No Clear Mind / Wintersun, but its conditions make
// them unreachable (every short song takes the first branch, every long one the third), so they
// are left out here. Mixing 0–5 stars with the 0–10 scale is kept as in Lark.
import type { Env } from "./index";

const tiers = (v: string, steps: [number, number][]) =>
  `CASE ${steps.map(([min, score]) => `WHEN ${v} >= ${min} THEN ${score}`).join(" ")} ELSE 0 END`;

const SHORT = {
  old: tiers("pc", [[240, 10], [220, 9], [200, 8], [180, 7], [150, 6], [100, 5], [70, 4], [50, 3], [30, 2], [10, 1]]),
  mid: tiers("pc", [[150, 7], [100, 6], [80, 5], [60, 4], [40, 3], [20, 2], [10, 1]]),
  new: tiers("pc", [[50, 4], [30, 3], [20, 2], [10, 1]]),
};
const LONG = {
  old: tiers("h", [[24, 10], [22, 9], [20, 8], [18, 7], [15, 6], [10, 5], [7, 4], [5, 3], [3, 2], [1, 1]]),
  mid: tiers("h", [[15, 7], [10, 6], [8, 5], [6, 4], [4, 3], [2, 2], [1, 1]]),
  new: tiers("h", [[5, 4], [3, 3], [2, 2], [1, 1]]),
};

/** SELECT track_id, rating … ; binds ?1 = asOf, ?2 = LASTFM_FROM. */
export const RATING_SQL = `
  WITH c AS (SELECT track_id, COUNT(*) AS n FROM plays
             WHERE track_id IS NOT NULL AND play_date >= ?2 AND play_date <= ?1 GROUP BY track_id),
  r AS (
    SELECT t.id, COALESCE(t.comments, '') AS comments, t.my_rating, COALESCE(t.duration_s, 0) AS dur,
           t.plays_to_12_2024 + COALESCE(c.n, 0) AS pc,
           COALESCE(t.duration_s, 0) * (t.plays_to_12_2024 + COALESCE(c.n, 0)) / 3600.0 AS h,
           julianday(?1) - julianday(date(t.date_added)) AS age
    FROM tracks t LEFT JOIN c ON c.track_id = t.id)
  SELECT id AS track_id, pc AS plays, ROUND(h, 1) AS hours, CAST(age AS INTEGER) AS days_in_library,
    CASE
      WHEN comments LIKE '%Archive%' THEN 0
      WHEN comments LIKE '%Stop rating%' THEN COALESCE(my_rating, 0) / 20.0
      WHEN age IS NULL OR age <= 0 THEN NULL
      WHEN dur < 360 THEN CASE WHEN age > 90 THEN ${SHORT.old} WHEN age > 30 THEN ${SHORT.mid} ELSE ${SHORT.new} END
      ELSE CASE WHEN age > 90 THEN ${LONG.old} WHEN age > 30 THEN ${LONG.mid} ELSE ${LONG.new} END
    END AS rating
  FROM r`;

export async function ratings(env: Env, asOf: string) {
  const { results } = await env.DB.prepare(RATING_SQL).bind(asOf, env.LASTFM_FROM).all<{ track_id: string; rating: number | null }>();
  return results;
}
