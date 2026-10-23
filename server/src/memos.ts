// Shared intermediate results, memoized per day in api_cache (see cache.ts), so the screens that
// need them don't each rescan every play. Each costs one full pass the first time in a day.
import type { Env } from "./index";
import { memo } from "./cache";
import { artistSql, type ArtistWindow } from "./artistRank";
import { allTimeSql, type AllTimeRow } from "./alltime";
import { RATING_SQL } from "./rating";

export type ArtistRankRow = { artist: string; rank: number; plays: number; hours: number };
const RANK_WINDOWS = ["at", "ft0424", "7d", "1m", "100d"] as const;
export type RankWindow = (typeof RANK_WINDOWS)[number];

/** All-time, since-04/2024 and rolling ranks of every artist. */
export async function artistRanks(env: Env, asOf: string): Promise<Record<RankWindow, Map<string, ArtistRankRow>>> {
  const lists = await memo(env, `artist-ranks|${asOf}`, async () => {
    const res = await env.DB.batch<ArtistRankRow>(
      RANK_WINDOWS.map((w) => env.DB.prepare(artistSql(w as ArtistWindow)).bind(asOf, env.LASTFM_FROM, asOf, 100000)),
    );
    return res.map((r) => r.results);
  });
  return Object.fromEntries(RANK_WINDOWS.map((w, i) => [w, new Map(lists[i].map((r) => [r.artist, r]))])) as Record<
    RankWindow, Map<string, ArtistRankRow>>;
}

/** The whole all-time song chart (Lark 1.1), rank order. */
export function songsAt(env: Env, asOf: string): Promise<AllTimeRow[]> {
  return memo(env, `songs-at|${asOf}`, async () =>
    (await env.DB.prepare(`${allTimeSql("at")} ORDER BY rank`).bind(asOf, env.LASTFM_FROM).all<AllTimeRow>()).results);
}

/** Song ratings 0–10 (Lark RA AT*) by track id. */
export async function ratingsByTrack(env: Env, asOf: string): Promise<Map<string, { rating: number | null; plays: number; hours: number; days_in_library: number | null }>> {
  const rows = await memo(env, `ratings|${asOf}`, async () =>
    (await env.DB.prepare(RATING_SQL).bind(asOf, env.LASTFM_FROM).all<any>()).results);
  return new Map(rows.map((r: any) => [r.track_id, r]));
}

/** Hours of all library-linked plays per month (the "Tổng" line on the artist page). */
export function monthTotals(env: Env, asOf: string): Promise<{ month: string; hours: number }[]> {
  return memo(env, `month-totals|${asOf}`, async () =>
    (await env.DB.prepare(
      `SELECT substr(p.play_date, 1, 7) AS month, ROUND(SUM(COALESCE(t.duration_s, 0)) / 3600.0, 2) AS hours
       FROM plays p JOIN tracks t ON t.id = p.track_id WHERE p.play_date <= ?1 GROUP BY 1 ORDER BY 1`,
    ).bind(asOf).all<{ month: string; hours: number }>()).results);
}
