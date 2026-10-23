import type { Env } from "./index";
import { overviewRange } from "./overview";

// Library date_added, not first scrobble or first appearance in a chart.
export async function newAdditions(env: Env, scope: string, asOf: string, limit = 5000) {
  const { from, to } = overviewRange(scope, asOf), end = to < asOf ? to : asOf;
  const base = `WITH pc AS (
    SELECT track_id, COUNT(*) AS plays FROM plays
    WHERE track_id IS NOT NULL AND play_date BETWEEN ?1 AND ?2 GROUP BY track_id
  ), x AS (
    SELECT t.*, COALESCE(t.album_artist, t.artist) AS name,
      COALESCE(pc.plays, 0) AS plays, COALESCE(t.duration_s, 0) * COALESCE(pc.plays, 0) / 3600.0 AS hours
    FROM tracks t LEFT JOIN pc ON pc.track_id = t.id
  )`;
  const results = await env.DB.batch([
    env.DB.prepare(`${base}, first_added AS (
      SELECT name, MIN(NULLIF(substr(date_added, 1, 10), '')) AS added FROM x
      WHERE name IS NOT NULL AND name NOT IN ('', '0') GROUP BY name
    ), current_artists AS (
      SELECT DISTINCT COALESCE(album_artist, artist) AS name FROM tracks
      WHERE in_library = 1
    ) SELECT x.name, a.added, SUM(x.plays) AS plays, ROUND(SUM(x.hours), 1) AS hours,
        SUM(CASE WHEN x.in_library = 1 THEN 1 ELSE 0 END) AS tracks
      FROM x JOIN first_added a ON a.name = x.name
      JOIN current_artists current ON current.name = x.name
      WHERE a.added BETWEEN ?1 AND ?2 AND (x.date_added IS NULL OR substr(x.date_added, 1, 10) <= ?2)
      GROUP BY x.name ORDER BY SUM(x.hours) DESC, x.name LIMIT ?3`).bind(from, end, limit),
    env.DB.prepare(`${base} SELECT id AS track_id, title, name AS artist, substr(date_added, 1, 10) AS added,
        plays, ROUND(hours, 1) AS hours
      FROM x WHERE in_library = 1 AND substr(date_added, 1, 10) BETWEEN ?1 AND ?2
      ORDER BY plays DESC, duration_s DESC, id LIMIT ?3`).bind(from, end, limit),
  ]);
  return { scope, from, to: end, artists: results[0].results, songs: results[1].results };
}
