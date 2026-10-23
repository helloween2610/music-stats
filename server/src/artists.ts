// Artist screens: all-time list with flags, this week by weekday, rank history, artist detail.
// Flags follow Lark "2. ARTIST" field "!!":
//   "*"   hot: (100 days rank ≤ 12 and 1 month rank ≤ 8) or (7 days rank ≤ 4 and 1 month rank ≤ 8)
//   "!!!" forgotten favourite: top 10 since 04/2024 but not in the top 15 of 7 days, 1 month or 100 days
import type { Env } from "./index";
import { artistSql } from "./artistRank";
import { artistPoints } from "./points";
import { memo } from "./cache";
import { artistRanks, monthTotals, songsAt } from "./memos";

const WHO = "COALESCE(t.album_artist, t.artist)";
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const monthEnd = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const prevMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
const mondayOf = (day: string) => addDays(day, -((new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7));

/** Artist points, memoized per day (they need about 280k row reads). */
export const artistPointsMemo = (env: Env, asOf: string) => memo(env, `points|${asOf}`, () => artistPoints(env, asOf));

export function artistFlag(r: { ft?: number; d7?: number; m1?: number; d100?: number }) {
  const le = (v: number | undefined, n: number) => v !== undefined && v <= n;
  const out15 = (v: number | undefined) => v === undefined || v > 15;
  const hot = (le(r.d100, 12) && le(r.m1, 8)) || (le(r.d7, 4) && le(r.m1, 8));
  const forgotten = le(r.ft, 10) && out15(r.d7) && out15(r.m1) && out15(r.d100);
  return (hot ? "*" : "") + (forgotten ? "!!!" : "");
}

/** Lark "AT ARTISTS": every artist with all-time hours, sortable by hours, plays or points. */
export async function artistsAllTime(env: Env, asOf: string, sort: "hours" | "plays" | "points", limit: number) {
  const [r, pts, last] = await Promise.all([
    artistRanks(env, asOf),
    artistPointsMemo(env, asOf),
    env.DB.prepare(`SELECT ${WHO} AS artist, MAX(p.play_date) AS last FROM plays p JOIN tracks t ON t.id = p.track_id
                    WHERE p.play_date <= ?1 GROUP BY 1`).bind(asOf).all<{ artist: string; last: string }>(),
  ]);
  const lastPlayed = new Map(last.results.map((x) => [x.artist, x.last]));
  const points = new Map(pts.rows.map((p) => [p.artist, p]));
  const rows = [...r.at.values()].map((a) => {
    const ranks = {
      ft: r.ft0424.get(a.artist)?.rank, d7: r["7d"].get(a.artist)?.rank,
      m1: r["1m"].get(a.artist)?.rank, d100: r["100d"].get(a.artist)?.rank,
    };
    const p = points.get(a.artist);
    return {
      rank: a.rank, artist: a.artist, plays: a.plays, hours: a.hours,
      points: p ? Math.round(p.points * 100) / 100 : null, pointsRank: p?.rank ?? null,
      ranks: { at: a.rank, ft0424: ranks.ft ?? null, d7: ranks.d7 ?? null, m1: ranks.m1 ?? null, d100: ranks.d100 ?? null },
      flag: artistFlag(ranks),
      lastPlayed: lastPlayed.get(a.artist) ?? null,
    };
  });
  if (sort === "plays") rows.sort((a, b) => b.plays - a.plays || b.hours - a.hours);
  else if (sort === "points") rows.sort((a, b) => (a.pointsRank ?? 1e9) - (b.pointsRank ?? 1e9) || a.rank - b.rank);
  return { sort, asOf, rows: sort === "points" ? rows.filter((x) => x.points !== null) : rows.slice(0, limit) };
}

/** "Top nghệ sĩ tuần này": the week's top artists (Lark weekly rank) with plays per day Mon–Sun. */
export async function artistsThisWeek(env: Env, asOf: string, limit: number) {
  const monday = mondayOf(asOf);
  const sunday = addDays(monday, 6);
  const top = await env.DB.prepare(artistSql("week")).bind(sunday, env.LASTFM_FROM, monday, limit)
    .all<{ rank: number; artist: string; plays: number; hours: number }>();
  const { results } = await env.DB.prepare(
    `SELECT ${WHO} AS artist, p.play_date AS day, COUNT(*) AS n FROM plays p JOIN tracks t ON t.id = p.track_id
     WHERE p.play_date BETWEEN ?1 AND ?2 GROUP BY 1, 2`,
  ).bind(monday, sunday).all<{ artist: string; day: string; n: number }>();
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const cell = new Map(results.map((x) => [`${x.artist}|${x.day}`, x.n]));
  return {
    from: monday, to: sunday, days,
    rows: top.results.map((a) => ({
      ...a,
      byDay: days.map((d) => (d > asOf ? null : cell.get(`${a.artist}|${d}`) ?? 0)),
    })),
  };
}

/**
 * All-time artist rank at the end of each of the last `months` months (the current month as of
 * `asOf`), with the change from the month before (Lark "R AT Rise (MM)"). Months before LASTFM_FROM
 * use imported All time snapshots where available; never replay the aggregate baseline as monthly history.
 */
export async function artistHistory(env: Env, asOf: string, months: number, top: number) {
  const periods: string[] = [];
  for (let ym = asOf.slice(0, 7), i = 0; i <= months && ym >= env.LASTFM_FROM.slice(0, 7); ym = prevMonth(ym), i++) periods.unshift(ym);
  // One pass instead of one all-time query per month: Apple baseline hours per artist, then hours of
  // plays since LASTFM_FROM per artist and month, summed up month by month (same as artistSql "at").
  const [base, since, legacy] = await env.DB.batch<{ artist: string; month?: string; hours: number; plays?: number; rank?: number }>([
    env.DB.prepare(`SELECT ${WHO.replaceAll("t.", "")} AS artist, SUM(COALESCE(duration_s, 0) * plays_to_12_2024) / 3600.0 AS hours
                    FROM tracks GROUP BY 1`),
    env.DB.prepare(`SELECT ${WHO} AS artist, substr(p.play_date, 1, 7) AS month, SUM(COALESCE(t.duration_s, 0)) / 3600.0 AS hours, COUNT(*) AS plays
                    FROM plays p JOIN tracks t ON t.id = p.track_id WHERE p.play_date BETWEEN ?1 AND ?2 GROUP BY 1, 2`)
      .bind(env.LASTFM_FROM, asOf),
    env.DB.prepare(`SELECT label AS artist, period AS month, rank FROM rank_snapshots
      WHERE kind = 'artist' AND source = 'artists_rank_old_at' AND rank > 0 AND label IS NOT NULL`),
  ]);
  const hours = new Map<string, number>();
  for (const r of base.results) if (r.artist) hours.set(r.artist, r.hours ?? 0);
  const byMonth = new Map<string, { artist: string; hours: number; plays?: number }[]>();
  for (const r of since.results) if (r.artist) (byMonth.get(r.month!) ?? byMonth.set(r.month!, []).get(r.month!)!).push(r);
  // months before the first shown one only add up
  for (const [m, rows] of byMonth) if (m < periods[0]) for (const r of rows) hours.set(r.artist, (hours.get(r.artist) ?? 0) + r.hours);
  const snapshots = periods.map((ym) => {
    for (const r of byMonth.get(ym) ?? []) hours.set(r.artist, (hours.get(r.artist) ?? 0) + r.hours);
    const sorted = [...hours].filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1]);
    const ranks = new Map<string, { rank: number; hours: number }>();
    sorted.forEach(([artist, h], i) => {
      const rank = i > 0 && Math.abs(sorted[i - 1][1] - h) < 1e-9 ? ranks.get(sorted[i - 1][0])!.rank : i + 1;
      ranks.set(artist, { rank, hours: Math.round(h * 10) / 10 });
    });
    // the month itself: plays, hours and rank by hours in that month (Lark monthly artist rank)
    const month = new Map<string, { plays: number; hours: number; rank: number }>();
    const inMonth = [...(byMonth.get(ym) ?? [])].sort((a, b) => b.hours - a.hours);
    inMonth.forEach((r, i) => {
      const rank = i > 0 && Math.abs(inMonth[i - 1].hours - r.hours) < 1e-9 ? month.get(inMonth[i - 1].artist)!.rank : i + 1;
      month.set(r.artist, { plays: r.plays ?? 0, hours: Math.round(r.hours * 10) / 10, rank });
    });
    return { label: `T${ym.slice(5, 7)}/${ym.slice(2, 4)}`, ranks, sorted, month };
  });
  const now = snapshots.at(-1)!, prev = snapshots.at(-2);
  // "Nghệ sĩ đang lên": for each of the last two months, artists in the top `top` whose all-time
  // rank rose during that month, biggest rise first, with that month's plays / hours / rank.
  const rising = snapshots.slice(-2).map((cur, k, arr) => {
    const idx = snapshots.length - arr.length + k;
    const before = snapshots[idx - 1];
    const rows = cur.sorted.slice(0, top).flatMap(([artist]) => {
      const r = cur.ranks.get(artist)!, p = before?.ranks.get(artist)?.rank;
      if (p === undefined || p <= r.rank) return [];
      const m = cur.month.get(artist);
      return [{ artist, rank: r.rank, previous: p, rise: p - r.rank, monthPlays: m?.plays ?? 0, monthHours: m?.hours ?? 0, monthRank: m?.rank ?? null }];
    }).sort((a, b) => b.rise - a.rise || a.rank - b.rank);
    return { period: cur.label, rows };
  }).reverse();
  const toMonth=(label:string)=>`20${label.slice(4,6)}-${label.slice(1,3)}`;
  let start=asOf.slice(0,7);
  for(let i=1;i<months;i++)start=prevMonth(start);
  const shown=snapshots.filter(x=>toMonth(x.label)>=start);
  const historical=new Map<string,Map<string,number>>();
  for(const row of legacy.results){
    const ym=toMonth(row.month!);
    if(ym<start || ym>=env.LASTFM_FROM.slice(0,7) || ym>asOf.slice(0,7))continue;
    const ranks=historical.get(row.month!) || new Map<string,number>();
    ranks.set(row.artist,Math.min(ranks.get(row.artist)??Infinity,row.rank!));
    historical.set(row.month!,ranks);
  }
  const oldPeriods=[...historical.keys()].sort((a,b)=>toMonth(a).localeCompare(toMonth(b)));
  return {
    periods: [...oldPeriods,...shown.map(x=>x.label)],
    rising,
    rows: now.sorted.slice(0, top).map(([artist]) => {
      const cur = now.ranks.get(artist)!;
      const before = prev?.ranks.get(artist)?.rank ?? null;
      return {
        rank: cur.rank, artist, hours: cur.hours,
        previous: before, rise: before === null ? null : before - cur.rank,
        history: [...oldPeriods.map(period=>({period,rank:historical.get(period)!.get(artist)??null,monthPlays:null,monthHours:null,monthRank:null})), ...shown.map((x) => ({
          period: x.label, rank: x.ranks.get(artist)?.rank ?? null,
          monthPlays: x.month.get(artist)?.plays ?? 0, monthHours: x.month.get(artist)?.hours ?? 0, monthRank: x.month.get(artist)?.rank ?? null,
        }))],
      };
    }),
  };
}

/** Chi tiết nghệ sĩ. */
export async function artistDetail(env: Env, artist: string, asOf: string) {
  const monday = mondayOf(asOf);
  const monthFrom = asOf.slice(0, 8) + "01";
  const [ranks, week, month, pts, totals, songs] = await Promise.all([
    artistRanks(env, asOf),
    env.DB.prepare(artistSql("week")).bind(addDays(monday, 6), env.LASTFM_FROM, monday, 100000).all<{ artist: string; rank: number }>(),
    env.DB.prepare(artistSql("month")).bind(monthEnd(asOf.slice(0, 7)), env.LASTFM_FROM, monthFrom, 100000).all<{ artist: string; rank: number }>(),
    artistPointsMemo(env, asOf),
    monthTotals(env, asOf),
    songsAt(env, asOf),
  ]);
  const at = ranks.at.get(artist);
  // Start from the artist's tracks (CROSS JOIN keeps that order) and reach their plays by index.
  const own = `FROM tracks t CROSS JOIN plays p ON p.track_id = t.id WHERE ${WHO} = ?1`;
  const db = env.DB;
  const res = await db.batch<any>([
    db.prepare(
      `SELECT COUNT(*) AS plays, MIN(p.play_date) AS first, MAX(p.play_date) AS last, COUNT(DISTINCT p.play_date) AS days
       ${own} AND p.play_date <= ?2`,
    ).bind(artist, asOf),
    db.prepare(
      `SELECT substr(p.play_date, 1, 7) AS month, COUNT(*) AS plays,
              ROUND(SUM(COALESCE(t.duration_s, 0)) / 3600.0, 2) AS hours
       ${own} AND p.play_date <= ?2 GROUP BY 1 ORDER BY 1`,
    ).bind(artist, asOf),
    db.prepare(
      `SELECT date(p.play_date, '-' || ((CAST(strftime('%w', p.play_date) AS INTEGER) + 6) % 7) || ' days') AS week,
              COUNT(*) AS plays
       ${own} AND p.play_date BETWEEN ?2 AND ?3 GROUP BY 1 ORDER BY 1`,
    ).bind(artist, addDays(monday, -7 * 25), asOf),
    db.prepare(
      `SELECT COUNT(*) AS tracks, COUNT(DISTINCT album) AS albums, MIN(date_added) AS first_added, GROUP_CONCAT(DISTINCT genre) AS genres
       FROM tracks WHERE COALESCE(album_artist, artist) = ?1`,
    ).bind(artist),
  ]);
  const life = res[0].results[0];
  if (!at && !life?.plays) return null;
  const p = pts.rows.find((x) => x.artist === artist) ?? null;
  const r = {
    ft: ranks.ft0424.get(artist)?.rank, d7: ranks["7d"].get(artist)?.rank,
    m1: ranks["1m"].get(artist)?.rank, d100: ranks["100d"].get(artist)?.rank,
  };
  return {
    artist, asOf,
    ranks: {
      week: week.results.find((x) => x.artist === artist)?.rank ?? null,
      month: month.results.find((x) => x.artist === artist)?.rank ?? null,
      at: at?.rank ?? null, ft0424: r.ft ?? null, d7: r.d7 ?? null, m1: r.m1 ?? null, d100: r.d100 ?? null,
    },
    flag: artistFlag(r),
    allTime: at ? { plays: at.plays, hours: at.hours } : null,
    logged: life,
    // average days between listening days in the play log
    avgGapDays: life?.days > 1 ? Math.round(((Date.parse(life.last) - Date.parse(life.first)) / 86400000 / (life.days - 1)) * 10) / 10 : null,
    library: res[3].results[0],
    points: p,
    months: (() => {
      const mine = new Map(res[1].results.map((m: any) => [m.month, m]));
      return totals.map((t) => ({ month: t.month, plays: mine.get(t.month)?.plays ?? 0, hours: mine.get(t.month)?.hours ?? 0, totalHours: t.hours }));
    })(),
    weeks: res[2].results,
    topSongs: songs.filter((x) => x.artist === artist).slice(0, 10),
  };
}
