// Headline numbers for the "Hôm nay" and "Tổng quan" screens.
//
// Totals follow Lark's AT dashboard:
//   plays   = Apple baseline "Plays to 12/2024" + plays linked to a track since LASTFM_FROM
//   songs   = library tracks with a date added
//   artists = artists whose first track (lowest Track ID) has a date added
//   albums  = albums with ≥ 5 tracks whose first track has a date added
//   genres  = genres whose first track has a date added
// Fixed vs Lark: Lark only counted additions in years present in its calendar table
// ("Date data+", which has no 2026 row), so tracks added this year were left out.
// Week / month / year cards (Lark MUSIC CHARTS): plays, distinct tracks and distinct artists among
// plays linked to a library track; weeks run Monday–Sunday. "vs previous" compares the period so far
// with the whole previous period, as Lark does (Weekly 31 vs 109 → −71.56%). The progress
// comparison uses the same weekday/day-of-month in the previous period.
// Fixed vs Lark: Monthly cards showed 0 after T05/26 (calendar table stopped), and the Yearly Tracks /
// Artists cards were stuck on year 2025 (1,082 / 198) while Yearly Plays showed 2026.
import type { Env } from "./index";

const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

function periods(asOf: string) {
  const d = new Date(asOf + "T00:00:00Z");
  const monday = addDays(asOf, -((d.getUTCDay() + 6) % 7));
  const monthStart = asOf.slice(0, 8) + "01";
  const prevMonthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const prevMonthEnd = addDays(monthStart, -1);
  const monthDayOffset = Number(asOf.slice(8, 10)) - 1;
  const prevMonthProgress = addDays(prevMonthStart, monthDayOffset);
  const year = d.getUTCFullYear();
  return {
    week: { from: monday, to: asOf, prevFrom: addDays(monday, -7), prevTo: addDays(monday, -1), progressPrevTo: addDays(asOf, -7) },
    month: { from: monthStart, to: asOf, prevFrom: prevMonthStart, prevTo: prevMonthEnd, progressPrevTo: prevMonthProgress > prevMonthEnd ? prevMonthEnd : prevMonthProgress },
    year: { from: `${year}-01-01`, to: asOf, prevFrom: `${year - 1}-01-01`, prevTo: `${year - 1}-12-31` },
  };
}

async function periodStats(env: Env, p: { from: string; to: string; prevFrom: string; prevTo: string; progressPrevTo?: string }) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS plays, COUNT(DISTINCT p.track_id) AS tracks,
            COUNT(DISTINCT COALESCE(t.album_artist, t.artist)) AS artists,
            (SELECT COUNT(*) FROM plays WHERE track_id IS NOT NULL AND play_date BETWEEN ?3 AND ?4) AS prev_plays,
            (SELECT COUNT(*) FROM plays WHERE track_id IS NOT NULL AND play_date BETWEEN ?3 AND ?5) AS progress_prev_plays
     FROM plays p JOIN tracks t ON t.id = p.track_id
     WHERE p.play_date BETWEEN ?1 AND ?2`,
  )
    .bind(p.from, p.to, p.prevFrom, p.prevTo, p.progressPrevTo ?? p.prevTo)
    .first<{ plays: number; tracks: number; artists: number; prev_plays: number; progress_prev_plays: number }>();
  const r = row!;
  return {
    from: p.from,
    to: p.to,
    plays: r.plays,
    tracks: r.tracks,
    artists: r.artists,
    previousPlays: r.prev_plays,
    change: r.prev_plays ? Math.round((r.plays / r.prev_plays - 1) * 10000) / 100 : null,
    progressPreviousPlays: r.progress_prev_plays,
    progressChange: r.progress_prev_plays ? Math.round((r.plays / r.progress_prev_plays - 1) * 10000) / 100 : null,
  };
}

export async function summary(env: Env, asOf: string) {
  const row = await env.DB.prepare(
    `WITH dated AS (SELECT id FROM tracks WHERE date_added IS NOT NULL AND date_added <= ?1 || 'T23:59'),
     first_artist AS (SELECT MIN(id) id FROM tracks WHERE artist_id IS NOT NULL GROUP BY artist_id),
     first_album AS (SELECT MIN(id) id, COUNT(*) items FROM tracks WHERE album_id IS NOT NULL GROUP BY album_id),
     first_genre AS (SELECT MIN(id) id FROM tracks WHERE genre_id IS NOT NULL GROUP BY genre_id)
     SELECT
       (SELECT SUM(plays_to_12_2024) FROM tracks)
         + (SELECT COUNT(*) FROM plays WHERE track_id IS NOT NULL AND play_date >= ?2 AND play_date <= ?1) AS plays,
       (SELECT COUNT(*) FROM dated) AS songs,
       (SELECT COUNT(*) FROM first_artist JOIN dated USING (id)) AS artists,
       (SELECT COUNT(*) FROM first_album JOIN dated USING (id) WHERE items >= 5) AS albums,
       (SELECT COUNT(*) FROM first_genre JOIN dated USING (id)) AS genres`,
  )
    .bind(asOf, env.LASTFM_FROM)
    .first<Record<string, number>>();
  const per = periods(asOf);
  const [week, month, yearStats] = await Promise.all([
    periodStats(env, per.week),
    periodStats(env, per.month),
    periodStats(env, per.year),
  ]);
  return {
    asOf,
    week,
    month,
    year: yearStats,
    total: { plays: row!.plays, songs: row!.songs, artists: row!.artists, albums: row!.albums, genres: row!.genres },
  };
}
