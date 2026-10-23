// "Tổng quan" screen (Lark dashboard AT / AT fT04-24 / MM (NEW)).
// scope: all     everything; artists/songs/genres/albums weighted by Apple baseline + plays since LASTFM_FROM
//        ft0424  every logged play (the log starts April 2024)
//        week    Monday through asOf, including day / weekday / hour series
//        YYYY    plays in that year;  YYYY-MM  plays in that month (adds by day / weekday / hour)
// Monthly series = plays linked to a library track (Lark "Plays" on dashboard AT, 22/22 months match).
// For "all" the series starts with plays before tracking = Apple baseline − plays logged before
// LASTFM_FROM (8,323 today; Lark showed a hand-typed 7,236 that no longer adds up to the total).
import type { Env } from "./index";
import { allTimeSql } from "./alltime";

export type Scope = "all" | "ft0424" | string;

export function overviewRange(scope: Scope, asOf: string) {
  if (scope === "15d") {
    const end = new Date(`${asOf}T00:00:00Z`);
    return { from: new Date(end.getTime() - 14 * 86400000).toISOString().slice(0, 10), to: asOf };
  }
  if (scope === "1m") {
    const end = new Date(`${asOf}T00:00:00Z`);
    return { from: new Date(end.getTime() - 29 * 86400000).toISOString().slice(0, 10), to: asOf };
  }
  if (scope === "week") {
    const d = new Date(asOf + "T00:00:00Z");
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
    return { from: monday.toISOString().slice(0, 10), to: asOf };
  }
  if (/^\d{4}-\d{2}$/.test(scope)) {
    const [y, m] = scope.split("-").map(Number);
    return { from: `${scope}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
  }
  if (/^\d{4}$/.test(scope)) return { from: `${scope}-01-01`, to: `${scope}-12-31` };
  return { from: "0000-01-01", to: asOf };
}


export async function overview(env: Env, scope: Scope, asOf: string, limit = 25) {
  const { from, to } = overviewRange(scope, asOf);
  const end = to < asOf ? to : asOf;
  const all = scope === "all";
  // Per-track weight: plays in scope ("all" adds the Apple baseline and only counts plays since LASTFM_FROM).
  const weighted = all
    ? `SELECT t.id, t.plays_to_12_2024 + COALESCE(c.n, 0) AS pc FROM tracks t
       LEFT JOIN (SELECT track_id, COUNT(*) AS n FROM plays WHERE track_id IS NOT NULL
                  AND play_date >= ?3 AND play_date <= ?2 AND ?1 IS NOT NULL GROUP BY track_id) c ON c.track_id = t.id`
    : `SELECT track_id AS id, COUNT(*) AS pc FROM plays WHERE track_id IS NOT NULL
       AND play_date BETWEEN ?1 AND ?2 AND ?3 IS NOT NULL GROUP BY track_id`;
  const w = `WITH w AS (${weighted}), x AS (
      SELECT t.*, w.pc, COALESCE(t.duration_s, 0) * w.pc / 3600.0 AS hours
      FROM w JOIN tracks t ON t.id = w.id WHERE w.pc > 0)`;
  const top = (key: string, limit: number) =>
    env.DB.prepare(
      `${w} SELECT ${key} AS name, SUM(pc) AS plays, ROUND(SUM(hours), 1) AS hours, COUNT(*) AS tracks
       FROM x WHERE ${key} IS NOT NULL AND ${key} NOT IN ('', '0') GROUP BY 1 ORDER BY SUM(hours) DESC, name LIMIT ${limit}`,
    ).bind(from, end, env.LASTFM_FROM);

  // Hours per artist per month for the same month range as the overview chart.
  // All time / fT04-24 use the full play log, matching the monthly chart.
  const sparkFrom = all || scope === "ft0424" ? "0000-01-01" : from;
  const statements = [
    env.DB.prepare(
      `${w} SELECT SUM(pc) AS plays, COUNT(*) AS songs, ROUND(SUM(hours), 1) AS hours,
              COUNT(DISTINCT COALESCE(album_artist, artist)) AS artists,
              COUNT(DISTINCT album_id) AS albums,
              COUNT(DISTINCT CASE WHEN genre NOT IN ('', '0') THEN genre END) AS genres FROM x`,
    ).bind(from, end, env.LASTFM_FROM),
    env.DB.prepare(
      `SELECT substr(p.play_date, 1, 7) AS month, COUNT(*) AS plays,
              ROUND(SUM(COALESCE(t.duration_s, 0)) / 3600.0, 1) AS hours
       FROM plays p JOIN tracks t ON t.id = p.track_id
       WHERE p.play_date BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 1`,
    ).bind(all || scope === "ft0424" ? "0000-01-01" : from, end),
    top("COALESCE(album_artist, artist)", limit),
    // Songs: the all-time charts (level system) for "all" / "ft0424", plain plays for a year or month.
    all || scope === "ft0424"
      ? env.DB.prepare(`${allTimeSql(all ? "at" : "ft0424")} ORDER BY rank LIMIT ?3`).bind(end, env.LASTFM_FROM, limit)
      : env.DB.prepare(
          `${w} SELECT id AS track_id, title, COALESCE(album_artist, artist) AS artist, pc AS plays,
                  ROUND(hours, 1) AS hours, COALESCE(rank_weight_custom,rank_weight,1) AS rank_weight
           FROM x ORDER BY pc * COALESCE(rank_weight_custom,rank_weight,1) DESC, duration_s DESC, id LIMIT ${limit}`,
        ).bind(from, end, env.LASTFM_FROM),
    top("genre", 10),
    // Albums by album id (two artists' albums can share a title).
    env.DB.prepare(
      `${w} SELECT album_id, MIN(album) AS name, MIN(COALESCE(album_artist, artist)) AS artist,
              SUM(pc) AS plays, ROUND(SUM(hours), 1) AS hours, COUNT(*) AS tracks
       FROM x WHERE album_id IS NOT NULL GROUP BY album_id ORDER BY SUM(hours) DESC LIMIT 10`,
    ).bind(from, end, env.LASTFM_FROM),
  ];
  if (all) {
    statements.push(
      env.DB.prepare(
        `SELECT SUM(t.plays_to_12_2024) - (SELECT COUNT(*) FROM plays WHERE track_id IS NOT NULL AND play_date < ?1) AS plays,
                ROUND((SUM(COALESCE(t.duration_s, 0) * t.plays_to_12_2024)
                  - (SELECT COALESCE(SUM(COALESCE(t2.duration_s, 0)), 0) FROM plays p2 JOIN tracks t2 ON t2.id = p2.track_id
                     WHERE p2.play_date < ?1)) / 3600.0, 1) AS hours
         FROM tracks t`,
      ).bind(env.LASTFM_FROM),
    );
  }
  const dayScope = scope === "week" || /^\d{4}-\d{2}$/.test(scope);
  if (dayScope) {
    const series = (expr: string) =>
      env.DB.prepare(
        `SELECT ${expr} AS k, COUNT(*) AS plays FROM plays WHERE track_id IS NOT NULL
         AND play_date BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 1`,
      ).bind(from, end);
    statements.push(series("play_date"), series("CAST(strftime('%w', play_date) AS INTEGER)"), series("hour"));
  }

  statements.push(
    env.DB.prepare(
      `SELECT COALESCE(t.album_artist, t.artist) AS artist, substr(p.play_date, 1, 7) AS month,
              ROUND(SUM(COALESCE(t.duration_s, 0)) / 3600.0, 2) AS hours
       FROM plays p JOIN tracks t ON t.id = p.track_id WHERE p.play_date BETWEEN ?1 AND ?2 GROUP BY 1, 2`,
    ).bind(sparkFrom, end),
    env.DB.prepare(
      `WITH monthly AS (
         SELECT substr(p.play_date, 1, 7) AS month, COALESCE(t.album_artist, t.artist) AS artist,
                COUNT(*) AS plays, ROUND(SUM(COALESCE(t.duration_s, 0)) / 3600.0, 2) AS hours
         FROM plays p JOIN tracks t ON t.id = p.track_id
         WHERE p.track_id IS NOT NULL AND p.play_date BETWEEN ?1 AND ?2
               AND COALESCE(t.album_artist, t.artist) IS NOT NULL
               AND COALESCE(t.album_artist, t.artist) NOT IN ('', '0')
         GROUP BY 1, 2
       ), ranked AS (
         SELECT month, artist, plays, hours,
                ROW_NUMBER() OVER (PARTITION BY month ORDER BY hours DESC, plays DESC, artist) AS rn
         FROM monthly
       )
       SELECT month, artist, plays, hours FROM ranked WHERE rn <= 10 ORDER BY month, rn`,
    ).bind(sparkFrom, end),
  );
  const res = await env.DB.batch(statements);
  const sparkMonths = (res[1].results as { month: string }[]).map((r) => r.month);
  const sparkRows = res.at(-2)!.results as { artist: string; month: string; hours: number }[];
  const monthArtists = res.at(-1)!.results as { month: string; artist: string; plays: number; hours: number }[];
  const spark = new Map<string, Map<string, number>>();
  for (const r of sparkRows) (spark.get(r.artist) ?? spark.set(r.artist, new Map()).get(r.artist)!).set(r.month, r.hours);
  const out: Record<string, unknown> = {
    scope,
    from: all || scope === "ft0424" ? null : from,
    to: end,
    totals: res[0].results[0],
    months: res[1].results,
    // spark: hours in each of sparkMonths, aligned with the overview month chart.
    artists: res[2].results.map((a: any) => ({ ...a, spark: sparkMonths.map((m) => spark.get(a.name)?.get(m) ?? 0) })),
    sparkMonths,
    monthArtists,
    songs: res[3].results,
    genres: res[4].results,
    albums: res[5].results,
  };
  let i = 6;
  if (all) out.beforeTracking = res[i++].results[0];
  if (dayScope) {
    out.byDay = res[i++].results;
    out.byWeekday = res[i++].results; // k: 0 = Sunday … 6 = Saturday
    out.byHour = res[i++].results.filter((r: any) => r.k !== null);
  }
  return out;
}

/** Library tracks by release year and genre (Lark "Songs added by Release Year"): top 8 genres, rest = "Khác". */
export async function releaseYears(env: Env) {
  const { results } = await env.DB.prepare(
    `WITH g AS (SELECT genre FROM tracks WHERE genre IS NOT NULL AND genre NOT IN ('', '0') AND genre NOT LIKE '%NHAC%'
                GROUP BY genre ORDER BY COUNT(*) DESC LIMIT 8)
     SELECT year, CASE WHEN genre IN (SELECT genre FROM g) THEN genre ELSE 'Khác' END AS genre, COUNT(*) AS songs
     FROM tracks WHERE year IS NOT NULL AND year > 1900 GROUP BY 1, 2 ORDER BY 1, 2`,
  ).all();
  return results;
}
