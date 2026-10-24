// Đọc dữ liệu từ server. Kết quả lưu theo path, dùng chung cho mọi màn.
// Giữ bản thành công gần nhất trong máy; luôn thử tải mới khi mở lại app. Timeout 12 giây.
// Path lỗi được gọi lại sau 30 giây, khi màn được vẽ lại.
import { useEffect, useReducer, useRef } from "react";
import {affectsApiReads,collectApiReads,recordApiRead} from './api-read-scope';
import {ServerRefreshSchedule, serverRefreshWindow} from "./server-refresh-schedule";
import { API_BASE, API_TOKEN, FETCH_TIMEOUT_MS, DATA_SOURCE } from "@/config";
import { LastGoodStore, cacheScope, validResponse } from "./last-good";

let storage: Storage | undefined;
try { storage = window.localStorage; } catch {}
export const lastGood = new LastGoodStore(cacheScope(API_BASE, API_TOKEN), storage);

export const artworkStore = new LastGoodStore(cacheScope(API_BASE, API_TOKEN) + ':artwork', storage);
const legacyArtwork = lastGood.get('/artwork');
if (!artworkStore.get('/artwork') && legacyArtwork && validResponse('/artwork', legacyArtwork.data)) {
  lastGood.removeWhere(path => path === '/artwork');
  artworkStore.set('/artwork', legacyArtwork.data, legacyArtwork.at, legacyArtwork.generation);
}

const libraryMetadataStore = new LastGoodStore(cacheScope(API_BASE, API_TOKEN) + ':library-metadata', storage);

export type Entry = {
  path: string;
  st: "loading" | "ok" | "err";
  data: any;
  status: number | string | null;
  code: string; // trường "error" của response lỗi, vd. "d1_daily_limit"
  at: number;
  dataAt: number; // thời điểm tải thành công gần nhất
  generation?: string;
};

const RETRY_MS = 30000;
export const CLIENT_CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const CACHE = new Map<string, Entry>();
const FORCE_REFRESH = new Set<string>();
const SUBS = new Set<(path?:string) => void>();
const notify = (path?:string) => SUBS.forEach((f) => f(path));

export function fetchJson(path: string, cacheOnly = false): Entry {
  recordApiRead(path);
  const old = CACHE.get(path);
  if (old && (old.st === "loading" || old.st === "err" && Date.now() - old.at <= RETRY_MS
    || old.st === "ok" && Date.now() - old.dataAt < CLIENT_CACHE_MAX_AGE_MS)) return old;
  if (old) CACHE.delete(path);
  const metadata = path.startsWith('/library/metadata?');
  const persistentStore = path === '/artwork' ? artworkStore : metadata ? libraryMetadataStore : lastGood;
  const saved = persistentStore.get(path);
  if (path === '/artwork') cacheOnly = true;
  const valid = saved && validResponse(path, saved.data) ? saved : undefined;
  if (cacheOnly && valid) {
    FORCE_REFRESH.delete(path);
    const e: Entry = { path, st: "ok", data: valid.data, dataAt: valid.at, generation: valid.generation, status: null, code: "", at: Date.now() };
    CACHE.set(path, e);
    return e;
  }
  const force = FORCE_REFRESH.delete(path);
  if (valid && !force && Date.now() - valid.at < CLIENT_CACHE_MAX_AGE_MS) {
    const e: Entry = { path, st: "ok", data: valid.data, dataAt: valid.at, generation: valid.generation, status: null, code: "", at: Date.now() };
    CACHE.set(path, e);
    return e;
  }
  const e: Entry = { path, st: "loading", data: valid?.data ?? null, dataAt: valid?.at ?? 0, generation: valid?.generation, status: null, code: "", at: 0 };
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
      e.generation = r.headers.get("x-data-generation") || e.generation;
      return j;
    })
    .then(
      (d) => {
        if (CACHE.get(path) !== e) return; // Ignore a response invalidated during the request.
        e.st = "ok"; e.data = d; e.dataAt = Date.now();
        persistentStore.set(path, d, e.dataAt, e.generation);
      },
      (err) => {
        e.st = "err";
        if (metadata && e.code === "library_changed") CACHE.delete("/library/generation");
        if (e.status == null) e.status = /abort/i.test(String(err)) ? "timeout" : "mạng";
      },
    )
    .finally(() => {
      e.at = Date.now();
      clearTimeout(to);
      notify(path);
    });
  return e;
}

// Chỉ xoá trạng thái request để tải mới; luôn giữ dữ liệu thành công gần nhất.
export function invalidate(test: (path: string) => boolean) {
  [...CACHE.keys()].forEach((k) => { if (test(k)) { FORCE_REFRESH.add(k); CACHE.delete(k); } });
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

// Scheduled slots are checks, not unconditional invalidations. Saved payloads stay
// visible while the lightweight revision request runs, including after reopening.
let checkingRevision: Promise<boolean> | null = null;
export function checkServerChanges(): Promise<boolean> {
  if (checkingRevision) return checkingRevision;
  checkingRevision = (async () => {
    try {
      const state = await getFresh('/data-version');
      if (typeof state?.revision !== 'string' || typeof state?.day !== 'string') return false;
      const previous = lastGood.get('server-revision')?.data;
      lastGood.set('server-revision', state);
      if (previous?.revision === state.revision && previous?.day === state.day) return false;
      invalidate(path => path !== '/artwork' && !path.startsWith('/library/metadata?'));
      return true;
    } catch { return false; } // retain the saved screen offline
  })().finally(() => { checkingRevision = null; });
  return checkingRevision;
}

// One timer for the next worker sync + five minutes, not an interval from app launch.
export function useServerUpdates() {
  useEffect(() => {
    if (DATA_SOURCE !== 'Server') return;
    const schedule = new ServerRefreshSchedule(Date.now());
    void checkServerChanges();
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const now = Date.now();
      if (schedule.takeDue(now, !document.hidden && navigator.onLine !== false)) void checkServerChanges();
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
  const [revision, bump] = useReducer((x: number) => x + 1, 0);
  const paths=useRef<Set<string>>();
  useEffect(() => {
    let raf = 0;
    const redraw = () => {
      // Preserve the moving frame; apply the latest response once the transition settles.
      if(document.querySelector('.zaui-routes-forward-enter-active,.zaui-routes-backward-enter-active,.zaui-routes-no-animation-enter-active,.shortcut-backdrop:not([data-entered]),.shortcut-backdrop[data-closing],.shortcut-sheet[data-dragging]')){
        raf=requestAnimationFrame(redraw);return;
      }
      raf=0;bump();
    };
    const sub = (path?:string) => {
      if(!affectsApiReads(paths.current,path))return;
      if (!raf) raf = requestAnimationFrame(redraw);
    };
    SUBS.add(sub);
    const iv = setInterval(() => {
      if ([...CACHE.values()].some((e) => affectsApiReads(paths.current,e.path) && e.st === "err" && Date.now() - e.at > RETRY_MS)) sub();
    }, RETRY_MS + 1000);
    return () => {
      SUBS.delete(sub);
      clearInterval(iv);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  const readView=<T,>(read:()=>T):T=>{
    const collected=collectApiReads(read);
    paths.current=collected.paths;
    return collected.value;
  };
  return Object.assign(readView,{revision});
}
