// Top 1–3 per week / month / year (Lark "R ALL data+ (Hàng tuần)"), the input of the artist points.
//   artist  week: Lark "Artist R WW*" (artistSql week) · month: hours (artistSql month) ·
//           year: hours, competitor rule (an artist only counts as ahead when their first play of
//           the year isn't excluded) and only artists with a play that isn't excluded
//   song    week / month: periodRankSql (Lark "Song R WW*" / "Song R MM*") ·
//           year: plays then hours, same competitor rule
//   album   month / year: hours, same competitor rule · week: top 1 only, any album with a play that
//           isn't excluded counts as a competitor (Lark "Album R WW*")
//   pc50    month: artists with 50+ plays in the month and a play that isn't excluded
// Album = album artist + album, as Lark groups them. Ties share a position (Lark concatenates them).
// Periods up to Lark's last one keep Lark's board; later finished periods are computed once.
import type { Env } from "./index";
import { artistSql } from "./artistRank";
import { EXCLUDED_PLAY_SQL, PLAY_SEQ_SQL, periodRankSql } from "./periodRank";

export type BoardKind = "ww" | "mm" | "yy";
export const ALBUM_SEP = "\x1f";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => iso(new Date(Date.parse(date + "T00:00:00Z") + n * 86400000));

/** ISO week number of a Monday-based week (Lark labels weeks by it). */
function isoWeek(monday: string) {
  const thursday = new Date(Date.parse(monday + "T00:00:00Z") + 3 * 86400000);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - jan1) / 86400000 / 7) + 1;
}

/** Lark labels: "WW 22 25-31/5/26", "T05/26", "2025". */
export function boardLabel(kind: BoardKind, from: string, to: string) {
  if (kind === "yy") return from.slice(0, 4);
  if (kind === "mm") return `T${from.slice(5, 7)}/${from.slice(2, 4)}`;
  const d = (s: string) => String(Number(s.slice(8, 10)));
  return `WW ${String(isoWeek(from)).padStart(2, "0")} ${d(from)}-${d(to)}/${Number(to.slice(5, 7))}/${to.slice(2, 4)}`;
}

/**
 * Rank by `order` among keys with a play that isn't excluded; a key counts as ahead only when it is a
 * competitor: its first play in the period isn't excluded ("rep") or it has any such play ("any").
 * Binds ?1 = from, ?2 = to. Returns key, rank (rank ≤ 3 only).
 */
function competitorTopSql(keyExpr: string, order: [string, string?], competitor: "rep" | "any") {
  const [v1, v2 = "0"] = order;
  const better = `(c.v1 > g.v1 + 1e-9 OR (abs(c.v1 - g.v1) <= 1e-9 AND c.v2 > g.v2 + 1e-9))`;
  const comp = competitor === "rep"
    ? "SELECT g.* FROM g JOIN x ON x.k = g.k AND x.seq = g.first_seq WHERE x.excl = 0"
    : "SELECT * FROM g WHERE ok";
  return `
    WITH x AS (
      SELECT ${keyExpr} AS k, ${PLAY_SEQ_SQL} AS seq, COALESCE(t.duration_s, 0) AS dur,
             COALESCE(${EXCLUDED_PLAY_SQL}, 0) AS excl
      FROM plays p JOIN tracks t ON t.id = p.track_id
      WHERE p.play_date BETWEEN ?1 AND ?2),
    g AS (SELECT k, ${v1} AS v1, ${v2} AS v2, MIN(seq) AS first_seq, MAX(excl = 0) AS ok
          FROM x WHERE k IS NOT NULL GROUP BY k),
    comp AS (${comp}),
    r AS (SELECT k, 1 + (SELECT COUNT(*) FROM comp c WHERE ${better}) AS rank FROM g WHERE ok)
    SELECT k, rank FROM r WHERE rank <= 3`;
}

const ALBUM_KEY = `t.album_artist || char(31) || t.album`;
const ARTIST_KEY = "COALESCE(t.album_artist, t.artist)";

/** Board entries for one period (positions 1–3, pc50 at 0). */
export async function computeBoard(env: Env, kind: BoardKind, from: string, to: string) {
  const db = env.DB;
  const top3 = (sql: string, binds: unknown[]) => db.prepare(sql).bind(...binds);
  const songKind = kind === "ww" ? "week" : "month";
  const statements = [
    // artist
    kind === "yy"
      ? top3(competitorTopSql(ARTIST_KEY, ["SUM(dur)"], "rep"), [from, to])
      : top3(`SELECT artist AS k, rank FROM (${artistSql(kind === "ww" ? "week" : "month")}) WHERE rank <= 3`,
          [to, env.LASTFM_FROM, from, 50]),
    // song
    kind === "yy"
      ? top3(competitorTopSql("p.track_id", ["COUNT(*)", "SUM(dur)"], "rep"), [from, to])
      : top3(`SELECT track_id AS k, rank FROM (${periodRankSql(songKind, "'p'", "WHERE p.play_date BETWEEN ?1 AND ?2")}) WHERE rank <= 3`,
          [from, to]),
    // album
    top3(competitorTopSql(ALBUM_KEY, ["SUM(dur)"], kind === "ww" ? "any" : "rep"), [from, to]),
  ];
  if (kind === "mm") {
    statements.push(
      top3(`SELECT ${ARTIST_KEY} AS k, 0 AS rank FROM plays p JOIN tracks t ON t.id = p.track_id
            WHERE p.play_date BETWEEN ?1 AND ?2 GROUP BY 1
            HAVING COUNT(*) >= 50 AND MAX(COALESCE(${EXCLUDED_PLAY_SQL}, 0) = 0)`, [from, to]),
    );
  }
  const res = await db.batch<{ k: string; rank: number }>(statements);
  const slots = ["artist", "song", "album", "pc50"] as const;
  const entries: { slot: string; pos: number; entity: string }[] = [];
  res.forEach((r, i) => {
    for (const row of r.results) {
      // Lark keeps only the album's top 1 for a week, and only the song's top 1 for a week.
      if (kind === "ww" && slots[i] !== "artist" && row.rank > 1) continue;
      if (row.k) entries.push({ slot: slots[i], pos: row.rank, entity: row.k });
    }
  });
  return entries;
}

/** Finished periods after the last stored one of each kind, oldest first. */
function missingPeriods(kind: BoardKind, lastTo: string, today: string) {
  const out: { from: string; to: string }[] = [];
  let from = addDays(lastTo, 1);
  for (;;) {
    let to: string;
    if (kind === "ww") to = addDays(from, 6);
    else if (kind === "mm") to = iso(new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)));
    else to = `${from.slice(0, 4)}-12-31`;
    if (to >= today) break;
    out.push({ from, to });
    from = addDays(to, 1);
  }
  return out;
}

/** Compute and store missing finished periods (at most `max` per call, to stay inside the CPU limit). */
export async function ensureBoard(env: Env, today: string, max = 6): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT kind, MAX(to_date) AS last FROM board_periods GROUP BY kind")
    .all<{ kind: BoardKind; last: string }>();
  const added: string[] = [];
  for (const { kind, last } of results) {
    for (const { from, to } of missingPeriods(kind, last, today)) {
      if (added.length >= max) return added;
      const label = boardLabel(kind, from, to);
      const entries = await computeBoard(env, kind, from, to);
      await env.DB.batch([
        env.DB.prepare("INSERT OR REPLACE INTO board_periods (period, kind, from_date, to_date, source) VALUES (?1, ?2, ?3, ?4, 'computed')")
          .bind(label, kind, from, to),
        env.DB.prepare("DELETE FROM board WHERE period = ?1").bind(label),
        ...entries.map((e) =>
          env.DB.prepare("INSERT OR IGNORE INTO board (period, slot, pos, entity) VALUES (?1, ?2, ?3, ?4)").bind(label, e.slot, e.pos, e.entity),
        ),
      ]);
      added.push(label);
    }
  }
  return added;
}

/** The stored board, newest first. */
export async function boardList(env: Env, kind: BoardKind | null, limit: number) {
  const { results } = await env.DB.prepare(
    `SELECT bp.period, bp.kind, bp.from_date, bp.to_date, bp.source, b.slot, b.pos, b.entity,
            t.title AS song_title, COALESCE(t.album_artist, t.artist) AS song_artist
     FROM (SELECT * FROM board_periods WHERE ?1 IS NULL OR kind = ?1 ORDER BY to_date DESC LIMIT ?2) bp
     JOIN board b ON b.period = bp.period LEFT JOIN tracks t ON b.slot = 'song' AND t.id = b.entity
     ORDER BY bp.to_date DESC, bp.kind, b.slot, b.pos`,
  ).bind(kind, limit).all<Record<string, any>>();
  const out = new Map<string, any>();
  for (const r of results) {
    let p = out.get(r.period);
    if (!p) out.set(r.period, (p = { period: r.period, kind: r.kind, from: r.from_date, to: r.to_date, source: r.source, artist: [], song: [], album: [], pc50: [] }));
    if (r.slot === "song") p.song.push({ pos: r.pos, track_id: r.entity, title: r.song_title, artist: r.song_artist });
    else if (r.slot === "album") {
      const [artist, album] = String(r.entity).split(ALBUM_SEP);
      p.album.push({ pos: r.pos, album, artist });
    } else if (r.slot === "artist") p.artist.push({ pos: r.pos, artist: r.entity });
    else p.pc50.push(r.entity);
  }
  return [...out.values()];
}
