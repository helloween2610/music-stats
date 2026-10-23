import type { Env } from "./index";
import { overviewRange } from "./overview";
import { allTimeSql } from "./alltime";
import { periodRankSql } from "./periodRank";

// Cumulative rank checkpoints within the selected period, using the same ranking rules as its list.
export function rankCheckpoints(scope: string, asOf: string) {
  const range = overviewRange(scope, asOf);
  const end = range.to < asOf ? range.to : asOf;
  const daily = /^\d{4}-\d{2}$/.test(scope) || scope === "week";
  const dates: string[] = [];
  if (daily) {
    for (let date = range.from; date <= end; date = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10)) dates.push(date);
  } else {
    const start = /^\d{4}$/.test(scope) ? range.from.slice(0, 7) : new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 12, 1)).toISOString().slice(0, 7);
    for (let ym = start; ym <= end.slice(0, 7);) {
      const [y, m] = ym.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      dates.push(last < end ? last : end);
      ym = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    }
  }
  return { from: range.from, to: end, daily, dates };
}

export async function periodRankHistory(env: Env, scope: string, asOf: string, kind: string, sort: string, limit = 5000) {
  const count = Math.max(1, Math.min(5000, Math.floor(limit) || 5000));
  const { from, to, daily, dates } = rankCheckpoints(scope, asOf);
  if (!dates.length) return { dates, daily, rows: [], to };
  const artist = kind === "artists";
  const statements = dates.map(date => {
    if (kind === "monthSongs") return env.DB.prepare(
      `WITH r AS (${periodRankSql("month", "'p'", "WHERE p.play_date BETWEEN ?1 AND ?2")})
       SELECT r.rank, r.track_id AS id, t.title AS name FROM r JOIN tracks t ON t.id=r.track_id ORDER BY r.rank LIMIT ${count}`,
    ).bind(from, date);
    if (!artist && scope === "ft0424") return env.DB.prepare(
      `SELECT rank, track_id AS id, title AS name FROM (${allTimeSql("ft0424")}) ORDER BY rank LIMIT ${count}`,
    ).bind(date, env.LASTFM_FROM);
    const order = artist
      ? `${sort === "plays" ? "SUM(pc) DESC," : ""} SUM(COALESCE(duration_s,0)*pc) DESC, COALESCE(t.album_artist,t.artist)`
      : "pc * COALESCE(t.rank_weight_custom,t.rank_weight,1) DESC, duration_s DESC, id";
    return env.DB.prepare(
      `WITH counts AS (SELECT track_id, COUNT(*) AS pc FROM plays WHERE track_id IS NOT NULL AND play_date BETWEEN ?1 AND ?2 GROUP BY track_id),
       ranked AS (SELECT ${artist ? "COALESCE(t.album_artist,t.artist)" : "t.id"} AS id,
          ${artist ? "COALESCE(t.album_artist,t.artist)" : "t.title"} AS name,
          ROW_NUMBER() OVER (ORDER BY ${order}) AS rank
        FROM counts c JOIN tracks t ON t.id=c.track_id
        ${artist ? "WHERE COALESCE(t.album_artist,t.artist) IS NOT NULL AND COALESCE(t.album_artist,t.artist) NOT IN ('','0') GROUP BY COALESCE(t.album_artist,t.artist)" : ""})
       SELECT id,name,rank FROM ranked ORDER BY rank LIMIT ${count}`,
    ).bind(from, date);
  });
  const results = await env.DB.batch<{id: string; name: string; rank: number}>(statements);
  const current = results.at(-1)!.results;
  const snapshots = results.map(result => new Map(result.results.map(row => [row.id, row.rank])));
  return { dates, daily, to, rows: current.map(row => ({ ...row,
    ranks: snapshots.map(snapshot => snapshot.get(row.id) ?? null),
  })) };
}
