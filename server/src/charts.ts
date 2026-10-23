// Song charts over rolling windows, matching Lark "1.2 SONG AT (fT4-24)":
//   R 7D   = by plays in the last 7 days, then song duration, then plays since 04/2024
//   R 1M   = by plays in the last 30 days, then duration
//   R 100D = by plays in the last 100 days, then duration
// A play counts when TODAY − play date ≤ N days (Lark "7 D" / "1 M" / "100 DAYS").
// Only plays linked to a library track count. Ties share a rank (1, 1, 3).
// The heavy lifting runs inside D1 so the Worker stays within the free 10 ms CPU budget.
import type { Env } from "./index";

// Values are inclusive day-age cutoffs. The new 15-day view spans today plus
// the preceding 14 dates; legacy windows retain their established semantics.
export const WINDOWS = { "7d": 7, "15d": 14, "1m": 30, "100d": 100 } as const;
export type Window = keyof typeof WINDOWS;

export interface ChartRow {
  rank: number;
  track_id: string;
  title: string;
  artist: string | null;
  plays: number;
  duration_s: number | null;
  rank_weight: number;
}

/** YYYY-MM-DD in Vietnam time. */
export function vnToday(now = Date.now()): string {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function songChart(env: Env, window: Window, asOf: string, limit: number): Promise<ChartRow[]> {
  const days = WINDOWS[window];
  // 7D adds a third tie-break: plays since April 2024 (all logged plays).
  const tieBreak = window === "7d" ? ", pc_all DESC" : "";
  const { results } = await env.DB.prepare(
    `WITH w AS (
       SELECT track_id,
              SUM(julianday(?1) - julianday(play_date) BETWEEN 0 AND ?2) AS pc,
              COUNT(*) AS pc_all
       FROM plays WHERE track_id IS NOT NULL AND play_date <= ?1
       GROUP BY track_id
     )
     SELECT RANK() OVER (ORDER BY w.pc * COALESCE(t.rank_weight_custom, t.rank_weight, 1) DESC, t.duration_s DESC${tieBreak}) AS rank,
            t.id AS track_id, t.title, COALESCE(t.album_artist, t.artist) AS artist,
            w.pc AS plays, t.duration_s, COALESCE(t.rank_weight_custom, t.rank_weight, 1) AS rank_weight
     FROM w JOIN tracks t ON t.id = w.track_id
     WHERE w.pc > 0
     ORDER BY rank LIMIT ?3`,
  )
    .bind(asOf, days, limit)
    .all<ChartRow>();
  return results;
}
