// Đọc dữ liệu từ server. Kết quả lưu theo path, dùng chung cho mọi màn.
// Giữ bản thành công gần nhất trong máy; luôn thử tải mới khi mở lại app. Timeout 12 giây.
// Path lỗi được gọi lại sau 30 giây, khi màn được vẽ lại.
import { useEffect, useReducer } from "react";
import {ServerRefreshSchedule, serverRefreshWindow} from "./server-refresh-schedule";
import { API_BASE, API_TOKEN, FETCH_TIMEOUT_MS, DATA_SOURCE } from "@/config";
import { LastGoodStore, cacheScope, validResponse } from "./last-good";

let storage: Storage | undefined;
try { storage = window.localStorage; } catch {}
export const lastGood = new LastGoodStore(cacheScope(API_BASE, API_TOKEN), storage);

export type Entry = {
  path: string;
  st: "loading" | "ok" | "err";
  data: any;
  status: number | string | null;
  code: string; // trường "error" của response lỗi, vd. "d1_daily_limit"
  at: number;
  dataAt: number; // thời điểm tải thành công gần nhất
};

const RETRY_MS = 30000;
const CACHE = new Map<string, Entry>();
const SUBS = new Set<() => void>();
const notify = () => SUBS.forEach((f) => f());

export function fetchJson(path: string, cacheOnly = false): Entry {
  const old = CACHE.get(path);
  if (old && !(old.st === "err" && Date.now() - old.at > RETRY_MS)) return old;
  const saved = lastGood.get(path);
  const valid = saved && validResponse(path, saved.data) ? saved : undefined;
  if (cacheOnly && valid) {
    const e: Entry = { path, st: "ok", data: valid.data, dataAt: valid.at, status: null, code: "", at: Date.now() };
    CACHE.set(path, e);
    return e;
  }
  const e: Entry = { path, st: "loading", data: valid?.data ?? null, dataAt: valid?.at ?? 0, status: null, code: "", at: 0 };
  CACHE.set(path, e);
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const to = setTimeout(() => ctl?.abort(), FETCH_TIMEOUT_MS);
  fetch(API_BASE + path, {
    headers: { Authorization: "Bearer " + API_TOKEN },
    signal: ctl ? ctl.signal : undefined,
  })
    .then(async (r) => {
      e.status = r.status;
      let j: any = null;
      try { j = await r.json(); } catch {}
      if (!r.ok) {
        e.code = (j && j.error) || "";
        throw new Error("HTTP " + r.status);
      }
      if (!validResponse(path, j)) {
        e.code = "invalid_data";
        throw new Error("Invalid server response");
      }
      return j;
    })
    .then(
      (d) => {
        if (CACHE.get(path) !== e) return; // Ignore a response invalidated during the request.
        e.st = "ok"; e.data = d; e.dataAt = Date.now();
        lastGood.set(path, d, e.dataAt);
      },
      (err) => {
        e.st = "err";
        if (e.status == null) e.status = /abort/i.test(String(err)) ? "timeout" : "mạng";
      },
    )
    .finally(() => {
      e.at = Date.now();
      clearTimeout(to);
      notify();
    });
  return e;
}

// Chỉ xoá trạng thái request để tải mới; luôn giữ dữ liệu thành công gần nhất.
export function invalidate(test: (path: string) => boolean) {
  [...CACHE.keys()].forEach((k) => { if (test(k)) CACHE.delete(k); });
  notify();
}

export async function postJson(path: string, body?: unknown) {
  let status: number | string | null = null, data: any = null, code = "";
  try {
    const r = await fetch(API_BASE + path, {
      method: "POST",
      headers: { Authorization: "Bearer " + API_TOKEN, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    status = r.status;
    try { data = await r.json(); } catch {}
    if (!r.ok) code = (data && data.error) || "";
  } catch {
    status = "mạng";
  }
  return { status, data, code };
}

// GET không lưu bộ nhớ tạm (hỏi trạng thái).
export async function getFresh(path: string) {
  const r = await fetch(API_BASE + path, { headers: { Authorization: "Bearer " + API_TOKEN } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// Read-only refresh: discard request state, retain last-good data, and let mounted
// screens request their dependencies. Never call /sync or a Last.fm endpoint.
let refreshing: Promise<boolean> | null = null;
export function refreshServerData(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = new Promise<boolean>((resolve) => {
    const started = Date.now();
    invalidate(() => true);
    const check = () => {
      const entries = [...CACHE.values()];
      if (entries.some(e => e.st === 'loading') && Date.now() - started < 30000) {
        setTimeout(check, 100); return;
      }
      resolve(entries.length > 0 && entries.every(e => e.st === 'ok'));
    };
    setTimeout(check, 200);
  }).finally(() => { refreshing = null; });
  return refreshing;
}

// One timer for the next worker sync + five minutes, not an interval from app launch.
export function useServerUpdates() {
  useEffect(() => {
    if (DATA_SOURCE !== 'Server') return;
    const schedule = new ServerRefreshSchedule(Date.now());
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const now = Date.now();
      if (schedule.takeDue(now, !document.hidden && navigator.onLine !== false)) void refreshServerData();
      timer = setTimeout(check, Math.max(1, serverRefreshWindow(now).next - now));
    };
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
    };
  }, []);
}

// Vẽ lại component khi có request bất kỳ hoàn tất, và mỗi 31 giây nếu còn path lỗi.
export function useApiRefresh() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let raf = 0;
    const sub = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; bump(); });
    };
    SUBS.add(sub);
    const iv = setInterval(() => {
      if ([...CACHE.values()].some((e) => e.st === "err" && Date.now() - e.at > RETRY_MS)) bump();
    }, RETRY_MS + 1000);
    return () => {
      SUBS.delete(sub);
      clearInterval(iv);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}
