// Data for the "Hôm nay" screen: recent scrobbles and plays per day of the current week.
import type { Env } from "./index";

export async function recentPlays(env: Env, limit: number) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.played_at, p.play_date, p.hour, p.minute, p.title, p.artist, p.album,
            p.track_id, t.title AS track_title, COALESCE(t.album_artist, t.artist) AS track_artist
     FROM plays p LEFT JOIN tracks t ON t.id = p.track_id
     ORDER BY p.played_at DESC, p.id DESC -- uses plays_played_at; rows without a time sort last
     LIMIT ?1`,
  )
    .bind(limit)
    .all();
  return results;
}

const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Mon–Sun compared with last week and the historical weekday average.
 * Average includes zero-play days from 2024-06-01 through the previous Sunday.
 * Keep the legacy record field for older deployed clients.
 */
export async function dailyThisWeek(env: Env, asOf: string) {
  const d = new Date(asOf + "T00:00:00Z");
  const monday = addDays(asOf, -((d.getUTCDay() + 6) % 7));
  const lastMonday = addDays(monday, -7);
  const sunday = addDays(monday, 6);
  const { results } = await env.DB.prepare(
    `WITH per_day AS (
       SELECT play_date, CAST(strftime('%w', play_date) AS INTEGER) AS wd, COUNT(*) AS n
       FROM plays WHERE track_id IS NOT NULL AND play_date >= '2024-06-01' GROUP BY play_date
     )
     SELECT wd, MAX(n) AS record,
            SUM(CASE WHEN play_date < ?1 THEN n ELSE 0 END) AS historical_plays,
            SUM(CASE WHEN play_date BETWEEN ?1 AND ?2 THEN n ELSE 0 END) AS plays,
            SUM(CASE WHEN play_date BETWEEN ?3 AND ?4 THEN n ELSE 0 END) AS last_week
     FROM per_day WHERE play_date <= ?5 GROUP BY wd`,
  )
    .bind(monday, sunday, lastMonday, addDays(lastMonday, 6), asOf)
    .all<{ wd: number; record: number; historical_plays: number; plays: number; last_week: number }>();
  const byWd = new Map(results.map((r) => [r.wd, r]));
  const historyStart = "2024-06-01";
  const historyDays = Math.max(0, Math.round((Date.parse(monday) - Date.parse(historyStart)) / 86400000));
  const firstWeekday = new Date(historyStart + "T00:00:00Z").getUTCDay();
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const wd = (i + 1) % 7;
    const r = byWd.get(wd);
    const offset = (wd - firstWeekday + 7) % 7;
    const occurrences = offset < historyDays ? Math.floor((historyDays - 1 - offset) / 7) + 1 : 0;
    return {
      date,
      future: date > asOf,
      plays: date > asOf ? null : r?.plays ?? 0,
      lastWeek: r?.last_week ?? 0,
      record: r?.record ?? 0,
      average: occurrences ? (r?.historical_plays ?? 0) / occurrences : 0,
    };
  });
}

/** Hour distribution for one Vietnam calendar day, linked library plays only. */
export async function hourlyToday(env: Env, asOf: string) {
  const { results } = await env.DB.prepare(
    `SELECT hour AS k, COUNT(*) AS plays FROM plays
     WHERE track_id IS NOT NULL AND play_date = ?1 AND hour IS NOT NULL
     GROUP BY hour ORDER BY hour`,
  ).bind(asOf).all();
  return results;
}
