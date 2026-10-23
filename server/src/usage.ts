// D1 usage watch. Since 2026-10-02 the account is on Workers Paid: no daily cut-off; each month
// includes 25 billion rows read and 50 million rows written, beyond that D1 bills per million rows.
// The Worker counts what its own requests and cron runs use (meter() in cache.ts) per UTC day;
// /usage adds up the month and reports a level against the included amounts.
// Not counted: wrangler commands run by hand (Cloudflare's GraphQL analytics has the full numbers).
import type { Env } from "./index";

export const LIMITS = { rowsReadPerMonth: 25_000_000_000, rowsWrittenPerMonth: 50_000_000 };
const WARN = 0.6, CRITICAL = 0.8;

const utcDay = () => new Date().toISOString().slice(0, 10);

export type UsageCacheState = "hit" | "miss" | "bypass" | "error";
export interface RequestUsageDetail {
  routeKey: string;
  cacheState: UsageCacheState;
  status: number;
}

const vnToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

function limitBucket(raw: string | null) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "default";
  for (const max of [5, 25, 100, 500, 1000, 5000]) if (n <= max) return `<=${max}`;
  return ">5000";
}

function scopeBucket(raw: string | null) {
  if (!raw) return "default";
  if (["all", "ft0424", "week"].includes(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return "month";
  if (/^\d{4}$/.test(raw)) return "year";
  return "other";
}

function asOfBucket(raw: string | null) {
  if (!raw) return "default";
  const day = raw.slice(0, 10), today = vnToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "other";
  return day === today ? "today" : day < today ? "past" : "future";
}

/** Privacy-safe route class for billing attribution; never include free-form query values. */
export function routeUsageKey(url: URL, method = "GET") {
  const p = url.pathname, q = url.searchParams, dims: string[] = [];
  if (q.has("scope")) dims.push(`scope=${scopeBucket(q.get("scope"))}`);
  if (q.has("window")) {
    const value = q.get("window") ?? "";
    dims.push(`window=${["7d", "1m", "100d", "month", "at", "ft0424"].includes(value) ? value : "other"}`);
  }
  if (q.has("asOf")) dims.push(`asOf=${asOfBucket(q.get("asOf"))}`);
  if (q.has("limit")) dims.push(`limit=${limitBucket(q.get("limit"))}`);
  if (q.has("offset")) dims.push(`offset=${Number(q.get("offset")) > 0 ? "next" : "first"}`);
  for (const name of ["kind", "sort", "mode"]) {
    if (!q.has(name)) continue;
    const value = q.get(name) ?? "";
    dims.push(`${name}=${/^[a-z0-9_-]{1,20}$/i.test(value) ? value.toLowerCase() : "other"}`);
  }
  return `${method.toUpperCase()} ${p}${dims.length ? " " + dims.join(" ") : ""}`.slice(0, 240);
}

/** Add one request's (or cron run's) usage to today's row. */
export async function recordUsage(
  db: D1Database,
  read: number,
  written: number,
  kind: "request" | "cron" | "library",
  detail?: RequestUsageDetail,
) {
  const statements = [db.prepare(
    `INSERT INTO usage_daily (day, rows_read, rows_written, requests, cron_runs) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (day) DO UPDATE SET rows_read = rows_read + ?2, rows_written = rows_written + ?3,
       requests = requests + ?4, cron_runs = cron_runs + ?5`,
  ).bind(utcDay(), read, written + (detail ? 2 : 1), kind === "request" ? 1 : 0, kind === "cron" ? 1 : 0)];
  if (kind === "request" && detail) statements.push(db.prepare(
    `INSERT INTO usage_route_daily
       (day, route_key, cache_state, requests, rows_read, rows_written, max_rows_read, errors)
     VALUES (?1, ?2, ?3, 1, ?4, ?5, ?4, ?6)
     ON CONFLICT (day, route_key, cache_state) DO UPDATE SET
       requests = requests + 1,
       rows_read = rows_read + ?4,
       rows_written = rows_written + ?5,
       max_rows_read = MAX(max_rows_read, ?4),
       errors = errors + ?6`,
  ).bind(utcDay(), detail.routeKey, detail.cacheState, read, written, detail.status >= 400 ? 1 : 0));
  await db.batch(statements).catch(() => undefined);
}

export async function usage(env: Env) {
  const { results } = await env.DB.prepare("SELECT * FROM usage_daily ORDER BY day DESC LIMIT 8")
    .all<{ day: string; rows_read: number; rows_written: number; requests: number; cron_runs: number }>()
    .catch(() => ({ results: [] as any[] }));
  const today = results.find((r) => r.day === utcDay()) ?? { day: utcDay(), rows_read: 0, rows_written: 0, requests: 0, cron_runs: 0 };
  const month = await env.DB.prepare(
    "SELECT COALESCE(SUM(rows_read), 0) AS rows_read, COALESCE(SUM(rows_written), 0) AS rows_written FROM usage_daily WHERE day >= ?1",
  ).bind(utcDay().slice(0, 8) + "01").first<{ rows_read: number; rows_written: number }>().catch(() => null) ?? { rows_read: 0, rows_written: 0 };
  const routes = await env.DB.prepare(
    `SELECT route_key, cache_state, requests, rows_read, rows_written, max_rows_read, errors
     FROM usage_route_daily WHERE day = ?1 ORDER BY rows_read DESC, requests DESC LIMIT 40`,
  ).bind(utcDay()).all().then((r) => r.results).catch(() => []);
  const readPct = month.rows_read / LIMITS.rowsReadPerMonth, writePct = month.rows_written / LIMITS.rowsWrittenPerMonth;
  const worst = Math.max(readPct, writePct);
  const level = worst >= CRITICAL ? "critical" : worst >= WARN ? "warn" : "ok";
  return {
    level, // ok | warn (≥60% of the month's included rows) | critical (≥80%)
    today,
    month: { ...month, readPct: Math.round(readPct * 10000) / 100, writePct: Math.round(writePct * 10000) / 100 },
    limits: LIMITS,
    message: level === "ok" ? null
      : `Tháng này server đã dùng ${Math.round(worst * 100)}% số dòng D1 có sẵn trong gói (đọc ${month.rows_read.toLocaleString("vi-VN")} / ghi ${month.rows_written.toLocaleString("vi-VN")}); phần vượt sẽ tính thêm tiền.`,
    days: results,
    routesToday: routes,
  };
}
