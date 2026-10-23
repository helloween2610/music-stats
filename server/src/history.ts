// Monthly all-time rank history (Lark "R AT Song data+", 1.3 R AT MM, 1.4 SONG R AT MM).
//
// History up to the last month imported from Lark stays as Lark recorded it: those snapshots show
// the library as it was then (comments, exclusions, durations), which today's data can't replay.
// From the month after, the server takes its own snapshot of the all-time chart (top 300) on the
// first sync after the month ends; like Lark's pasted list, every song gets its own position. Rise = rank in last month's snapshot − rank now (Lark
// "R AT Rise (Realtime)"); its arrow follows Lark's "R AT Rise (Realtime) Group".
import type { Env } from "./index";
import { allTimeSql } from "./alltime";
import { songsAt } from "./memos";

const SNAPSHOT_SIZE = 300;
const SOURCE_ORDER = "CASE source WHEN 'r_at_song' THEN 0 WHEN 'computed' THEN 1 ELSE 2 END";

/** "2026-09" ↔ "T09/26" (Lark's month label). */
export const toLabel = (ym: string) => `T${ym.slice(5, 7)}/${ym.slice(2, 4)}`;
export const fromLabel = (label: string) => `20${label.slice(4, 6)}-${label.slice(1, 3)}`;

const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const nextMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

/** Take any missing monthly song snapshots up to the month before `today`. Returns months added. */
export async function ensureSnapshots(env: Env, today: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT DISTINCT period FROM rank_snapshots WHERE kind = 'song'").all<{ period: string }>();
  if (!results.length) return [];
  const have = new Set(results.map((r) => fromLabel(r.period)));
  const lastClosed = new Date(Date.parse(today.slice(0, 7) + "-01T00:00:00Z") - 86400000).toISOString().slice(0, 7);
  const added: string[] = [];
  for (let ym = nextMonth([...have].sort().at(-1)!); ym <= lastClosed; ym = nextMonth(ym)) {
    if (have.has(ym)) continue;
    await env.DB.prepare(
      `INSERT OR REPLACE INTO rank_snapshots (kind, period, rank, entity_id, label, source)
       SELECT 'song', ?5, ROW_NUMBER() OVER (ORDER BY rank, track_id), track_id, title, 'computed'
       FROM (${allTimeSql("at")} ORDER BY rank LIMIT ?3)`,
    )
      .bind(monthEnd(ym), env.LASTFM_FROM, SNAPSHOT_SIZE, null, toLabel(ym))
      .run();
    added.push(toLabel(ym));
  }
  return added;
}

/** Lark "R AT Rise (Realtime) Group". */
export function riseArrow(rank: number, previous: number | null): string {
  if (previous === null) return rank < 101 ? "^^" : "";
  const rise = previous - rank;
  if (rise > 0 && rank <= 10) return "^^^";
  if (rise > 9) return "^^";
  if (rise > 0) return "^";
  if (rise >= -4) return "-";
  return "v";
}

export interface SongHistoryRow {
  rank: number;
  track_id: string;
  title: string;
  artist: string | null;
  level: number;
  plays: number;
  minutes: number;
  lastPlayedAt: number | null;
  previous: number | null;
  rise: number | null;
  arrow: string;
  lastMonth: { period: string; rise: number | null; arrow: string } | null;
  best: { rank: number; period: string } | null;
  monthsInTop100: number;
  history: { period: string; rank: number }[];
}

export interface ScopedSongHistoryRow {
  track_id: string;
  best: { rank: number; period: string } | null;
  history: { period: string; rank: number }[];
}

type SongRankPoint = { period: string; rank: number };

/**
 * Fill closed listening months that predate the first saved snapshot. Saved/imported snapshots
 * remain authoritative; replay is only a fallback for a month where this song was actually heard.
 */
export async function completeSongRankHistory(
  env: Env,
  trackId: string,
  asOf: string,
  playedMonths: { month: string; plays?: number }[],
  saved: SongRankPoint[],
): Promise<SongRankPoint[]> {
  const byMonth = new Map<string, SongRankPoint>();
  for (const point of saved) {
    const ym = /^T\d{2}\/\d{2}$/.test(point.period) ? fromLabel(point.period) : point.period.slice(0, 7);
    const previous = byMonth.get(ym);
    if (!previous || point.rank < previous.rank) byMonth.set(ym, { period: toLabel(ym), rank: point.rank });
  }

  const currentMonth = asOf.slice(0, 7);
  const missing = [...new Set(playedMonths
    .filter((row) => (row.plays ?? 0) > 0 && /^\d{4}-\d{2}$/.test(row.month))
    .map((row) => row.month)
    .filter((ym) => ym < currentMonth && monthEnd(ym) >= env.LASTFM_FROM && !byMonth.has(ym)))];

  await Promise.all(missing.map(async (ym) => {
    const row = (await songsAt(env, monthEnd(ym))).find((song) => song.track_id === trackId);
    if (row?.rank) byMonth.set(ym, { period: toLabel(ym), rank: row.rank });
  }));

  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, point]) => point);
}

/** Rank snapshots for the handful of songs visible on a detail screen. */
export async function scopedSongHistory(env: Env, trackIds: string[], months: number): Promise<{ periods: string[]; rows: ScopedSongHistoryRow[] }> {
  const ids = [...new Set(trackIds.map((id) => id.trim()).filter(Boolean))].slice(0, 80);
  if (!ids.length) return { periods: [], rows: [] };
  const placeholders = ids.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await env.DB.prepare(
    `SELECT entity_id AS track_id, period, MIN(rank) AS rank
     FROM rank_snapshots
     WHERE kind = 'song' AND entity_id IN (${placeholders})
     GROUP BY entity_id, period`,
  ).bind(...ids).all<{ track_id: string; period: string; rank: number }>();
  const allPeriods = [...new Set(results.map((row) => row.period))]
    .sort((a, b) => fromLabel(a).localeCompare(fromLabel(b)));
  const periods = allPeriods.slice(-months);
  const included = new Set(periods);
  const byTrack = new Map<string, { period: string; rank: number }[]>();
  for (const row of results) {
    const points = byTrack.get(row.track_id) ?? [];
    points.push({ period: row.period, rank: row.rank });
    byTrack.set(row.track_id, points);
  }
  for (const points of byTrack.values()) points.sort((a, b) => fromLabel(a.period).localeCompare(fromLabel(b.period)));
  return {
    periods,
    rows: ids.map((track_id) => {
      const points = byTrack.get(track_id) ?? [];
      const best = points.reduce<{ rank: number; period: string } | null>((value, point) =>
        !value || point.rank < value.rank || (point.rank === value.rank && fromLabel(point.period) < fromLabel(value.period)) ? point : value, null);
      return { track_id, best, history: points.filter((point) => included.has(point.period)) };
    }),
  };
}

/** Current all-time top `top`, each with its monthly ranks over the last `months` snapshots. */
export async function songHistory(env: Env, asOf: string, top: number, months: number): Promise<{ periods: string[]; rows: SongHistoryRow[] }> {
  const current = await env.DB.prepare(`SELECT chart.*,
      (SELECT MAX(COALESCE(p.played_at, CAST(strftime('%s', p.play_date || ' ' || printf('%02d:%02d:00', COALESCE(p.hour,0), COALESCE(p.minute,0)), '-7 hours') AS INTEGER)))
       FROM plays p WHERE p.track_id = chart.track_id AND p.play_date <= ?1) AS lastPlayedAt
      FROM (${allTimeSql("at")} ORDER BY rank LIMIT ?3) chart ORDER BY chart.rank`)
    .bind(asOf, env.LASTFM_FROM, top)
    .all<{ rank: number; track_id: string; title: string; artist: string | null; level: number; plays: number; minutes: number; lastPlayedAt: number | null }>();
  if (!current.results.length) return { periods: [], rows: [] };

  // One snapshot per month: Lark's "r_at_song" wins over older Sync tables, computed ones come after.
  // The current chart is joined in SQL (D1 allows at most 100 bound parameters, so no IN list).
  const { results: snaps } = await env.DB.prepare(
    `WITH cur AS (${allTimeSql("at")} ORDER BY rank LIMIT ?3),
     pref AS (SELECT period, MIN(${SOURCE_ORDER}) AS pr FROM rank_snapshots WHERE kind = 'song' GROUP BY period)
     SELECT s.period, s.rank, s.entity_id FROM cur
     JOIN rank_snapshots s ON s.kind = 'song' AND s.entity_id = cur.track_id
     JOIN pref ON pref.period = s.period AND pref.pr = ${SOURCE_ORDER.replaceAll("source", "s.source")}`,
  )
    .bind(asOf, env.LASTFM_FROM, top)
    .all<{ period: string; rank: number; entity_id: string }>();

  const allPeriods = [...new Set(snaps.map((s) => s.period))].sort((a, b) => fromLabel(a).localeCompare(fromLabel(b)));
  const periods = allPeriods.slice(-months);
  const lastPeriod = allPeriods.at(-1) ?? null;
  const prevPeriod = allPeriods.at(-2) ?? null;
  const byTrack = new Map<string, Map<string, number>>();
  for (const s of snaps) {
    if (!byTrack.has(s.entity_id)) byTrack.set(s.entity_id, new Map());
    const m = byTrack.get(s.entity_id)!;
    m.set(s.period, Math.min(m.get(s.period) ?? Infinity, s.rank));
  }

  const rows = current.results.map((r) => {
    const h = byTrack.get(r.track_id) ?? new Map<string, number>();
    const previous = lastPeriod ? h.get(lastPeriod) ?? null : null;
    const beforeLast = prevPeriod ? h.get(prevPeriod) ?? null : null;
    let best: SongHistoryRow["best"] = null;
    for (const [period, rank] of h) {
      if (!best || rank < best.rank || (rank === best.rank && fromLabel(period) < fromLabel(best.period))) best = { rank, period };
    }
    return {
      ...r,
      previous,
      rise: previous === null ? null : previous - r.rank,
      arrow: riseArrow(r.rank, previous),
      // the last finished month: snapshot before it → its snapshot
      lastMonth: previous === null ? null : {
        period: lastPeriod!,
        rise: beforeLast === null ? null : beforeLast - previous,
        arrow: riseArrow(previous, beforeLast),
      },
      best,
      monthsInTop100: [...h.values()].filter((v) => v <= 100).length,
      history: periods.filter((p) => h.has(p)).map((p) => ({ period: p, rank: h.get(p)! })),
    };
  });
  return { periods, rows };
}
