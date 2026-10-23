// Response cache in D1, so the free plan's 5M rows-read/day isn't spent recomputing the same charts.
//
// Every GET response (except the cheap or debug ones) is stored under its URL + today's date, tagged
// with the data version (settings "data_version"). Two speeds:
//   fast  today / recent / rolling and calendar-period charts: stale as soon as the version changes
//   slow  all-time, points, history, details: also served for up to 2 hours after a new version,
//         since recomputing them costs hundreds of thousands of row reads
// New plays from the cron make a soft bump (fast entries go); a manual match or rule change makes a
// hard bump (everything goes). A hit costs two row reads.
// memo() keeps shared intermediate results (artist points, artist ranks) in the same table.
//
// meter() wraps the database to count rows read, reported in the x-rows-read response header.
import type { Env } from "./index";

const MAX_BODY = 1_500_000; // D1 rows top out around 2 MB

const SLOW_HOURS = 2; // paid plan (2026-10-02): recomputing is cheap, keep all screens within ~2 h of each other
const VERSION = "COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'data_version'), 0)";
const inflight = new Map<string, Promise<unknown>>();

/** Coalesce concurrent cold requests for the same cache key inside a Worker isolate. */
async function singleFlight<T>(key: string, compute: () => Promise<T>): Promise<{ value: T; shared: boolean }> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return { value: await running, shared: true };
  const task = compute();
  inflight.set(key, task);
  try { return { value: await task, shared: false }; }
  finally { if (inflight.get(key) === task) inflight.delete(key); }
}

/** Current statistics generation, exposed for refresh/debug verification during the Free-tier rollout. */
export async function currentDataGeneration(env: Env) {
  const row = await env.DB.prepare(`SELECT ${VERSION} AS generation`).first<{ generation: number }>().catch(() => null);
  return Number(row?.generation ?? 0);
}

async function read(env: Env, key: string): Promise<string | null> {
  // The cache is optional: if the table is missing or D1 refuses (daily limit), just compute.
  const hit = await env.DB.prepare(
    `SELECT body FROM api_cache WHERE key = ?1
       AND (version = ${VERSION} OR (slow = 1 AND created_at >= datetime('now', '-${SLOW_HOURS} hours')))`,
  ).bind(key).first<{ body: string }>().catch(() => null);
  return hit?.body ?? null;
}

async function write(env: Env, key: string, body: string, slow: boolean) {
  if (body.length > MAX_BODY) return;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO api_cache (key, version, slow, body, created_at) VALUES (?1, ${VERSION}, ?2, ?3, datetime('now'))`,
  ).bind(key, slow ? 1 : 0, body).run().catch(() => undefined);
}

export async function cached(env: Env, key: string, slow: boolean, compute: () => Promise<Response>): Promise<Response> {
  const hit = await read(env, key);
  if (hit !== null) return new Response(hit, { headers: { "content-type": "application/json; charset=utf-8", "x-cache": "hit" } });
  const { value, shared } = await singleFlight("response:" + key, async () => {
    const res = await compute();
    const body = await res.text();
    if (res.status === 200) await write(env, key, body, slow);
    return { body, status: res.status, headers: Object.fromEntries(res.headers) };
  });
  return new Response(value.body, { status: value.status, headers: { ...value.headers, "x-cache": shared ? "coalesced" : "miss" } });
}

/** A shared intermediate result, kept like a slow response. `key` should include the date it depends on. */
export async function memo<T>(env: Env, key: string, compute: () => Promise<T>): Promise<T> {
  const cacheKey = "memo:" + key;
  const hit = await read(env, cacheKey);
  if (hit !== null) return JSON.parse(hit) as T;
  const { value } = await singleFlight(cacheKey, async () => {
    const result = await compute();
    await write(env, cacheKey, JSON.stringify(result), true);
    return result;
  });
  return value;
}

/**
 * Mark cached responses stale after anything that changes the numbers. Soft (new plays): fast
 * entries go, slow ones live out their 2 hours. Hard (manual match, rules): everything goes.
 */
export async function bumpVersion(env: Env, reason: string, hard = false) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES ('data_version', '1')
       ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
    ),
    env.DB.prepare(hard ? "DELETE FROM api_cache"
      : `DELETE FROM api_cache WHERE slow = 0 OR created_at < datetime('now', '-${SLOW_HOURS} hours')`),
    env.DB.prepare(
      `INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('data_version_reason', ?1, datetime('now'))`,
    ).bind(reason),
  ]);
}

/**
 * Cron: record one global version change at most every MIN_GAP_MINUTES. New listens immediately
 * discard fast/current responses; expensive history and All-time responses live out their bounded
 * two-hour window instead of being recomputed after every sync slot.
 */
const MIN_GAP_MINUTES = 120;
export async function bumpThrottled(env: Env, change: string | null) {
  const state = await env.DB.prepare(
    `SELECT (SELECT value FROM sync_state WHERE key = 'pending_changes') AS pending,
            (SELECT updated_at FROM sync_state WHERE key = 'data_version_reason') AS last`,
  ).first<{ pending: string | null; last: string | null }>();
  const pending = [state?.pending, change].filter(Boolean).join("; ");
  if (!pending) return false;
  const due = !state?.last || Date.parse(state.last.replace(" ", "T") + "Z") <= Date.now() - MIN_GAP_MINUTES * 60000;
  if (due) {
    await bumpVersion(env, pending.slice(0, 500), false);
    await env.DB.prepare("DELETE FROM sync_state WHERE key = 'pending_changes'").run();
  } else if (change) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM api_cache WHERE slow = 0 OR created_at < datetime('now', '-${SLOW_HOURS} hours')`),
      env.DB.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('pending_changes', ?1, datetime('now'))")
        .bind(pending.slice(0, 500)),
    ]);
  }
  return due;
}

/** Wrap a D1 database so every statement adds its meta.rows_read to a counter. */
export function meter(db: D1Database): { db: D1Database; rowsRead: () => number; rowsWritten: () => number } {
  let rows = 0, written = 0;
  const add = (meta: any) => { rows += Number(meta?.rows_read ?? 0); written += Number(meta?.rows_written ?? 0); };
  const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") return (...args: unknown[]) => wrapStmt(target.bind(...args));
        if (prop === "all") return async () => { const r = await target.all(); add(r.meta); return r; };
        if (prop === "run") return async () => { const r = await target.run(); add(r.meta); return r; };
        // raw() has no meta; count it through all() and return the rows as arrays
        if (prop === "raw") return async () => {
          const r = await target.all(); add(r.meta);
          return r.results.map((row) => Object.values(row as Record<string, unknown>));
        };
        if (prop === "first") return async (col?: string) => {
          const r = await target.all(); add(r.meta);
          const row = r.results[0] as Record<string, unknown> | undefined;
          return row === undefined ? null : col ? row[col] : row;
        };
        if (prop === "__raw") return target;
        const v = (target as any)[prop];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  const wrapped = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrapStmt(target.prepare(sql));
      if (prop === "batch") return async (stmts: D1PreparedStatement[]) => {
        const res = await target.batch(stmts.map((s: any) => s.__raw ?? s));
        res.forEach((r) => add(r.meta));
        return res;
      };
      const v = (target as any)[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { db: wrapped, rowsRead: () => rows, rowsWritten: () => written };
}
