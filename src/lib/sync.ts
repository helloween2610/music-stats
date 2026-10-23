// Hai luồng đồng bộ có quyền ghi: nút thủ công trong Thư viện và riêng iOS app
// có thêm kiểm tra foreground để bắt kịp thư viện Apple Music khi dữ liệu đã cũ.
import { API_BASE, API_TOKEN, BROWSER_PREVIEW, DATA_SOURCE, IOS_APP } from "@/config";
import { getFresh, invalidate, postJson } from "./api";
import { vn } from "./fmt";
import { invalidateAppleLinks } from './discovery';
import { invalidatePlaylistSnapshot } from './playlists';
import { syncLibraryInNativeApp } from './ios-bridge';

type Set = (patch: Record<string, any>) => void;
type Toast = (msg: string) => void;

export async function syncLastfm(busy: boolean, set: Set, toast: Toast) {
  if (busy) return;
  if (DATA_SOURCE !== "Server") return toast("Chế độ Mẫu: không gọi server");
  set({ lfmBusy: true });
  const r = await postJson("/sync"), d = r.data || {};
  set({ lfmBusy: false });
  if (r.code === "d1_daily_limit") return toast("Server tạm nghỉ đến 7:00");
  if (d.skipped) return toast("Vừa đồng bộ xong, thử lại sau 1 phút");
  if (r.status === 200 && d.sync) {
    const n = d.sync.inserted || 0;
    toast(n ? `Đã cập nhật · +${vn(n)} lượt mới` : "Không có lượt mới");
    invalidate((p) => /^\/(summary|daily|recent|artists\/week)/.test(p) || /^\/charts\/.*window=(week|7d|month|1m)\b/.test(p) || p === "/library" || /^\/overview\?scope=week(?:&|$)/.test(p));
    return;
  }
  toast("Không đồng bộ được, thử lại sau");
}

// Trạng thái yêu cầu đồng bộ thư viện, dùng chung cả app.
export type LibReq = { status: string; requested_at?: string; done_at?: string; summary?: any; phase?: string; error?: string; mode?: string };
export const LIBREQ: { st: LibReq | null; poll: ReturnType<typeof setInterval> | null; seenDone: string | null; screenOpen: boolean; toast: Toast | null } = {
  st: null, poll: null, seenDone: null, screenOpen: false, toast: null,
};
const POLL_MS = 20000, STALE_MS = 600000;
const AUTO_LIBRARY_SYNC_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const AUTO_LIBRARY_SYNC_MIN_INTERVAL_MS = 30 * 60 * 1000;
const AUTO_LIBRARY_SYNC_LAST_RUN_KEY = "music-stats:auto-library-sync:last-run";
const AUTO_LIBRARY_SYNC_CLOCK_SKEW_MS = 60000;
let autoLibraryBusy = false;
const age = (iso?: string) => Date.now() - Date.parse(iso || "");
export const libStale = (r: LibReq) => r.status === "pending" && age(r.requested_at) > STALE_MS;

type SyncRow = { key: string; value?: string; updated_at?: string };

function dateMs(value?: string | null) {
  if (!value) return 0;
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const n = Date.parse(normalized);
  return Number.isFinite(n) ? n : 0;
}

function storedLastAutoSync() {
  try {
    const raw = window.localStorage.getItem(AUTO_LIBRARY_SYNC_LAST_RUN_KEY);
    const n = Number(raw || 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function markAutoSyncAttempt() {
  try { window.localStorage.setItem(AUTO_LIBRARY_SYNC_LAST_RUN_KEY, String(Date.now())); } catch {}
}

function latestLibrarySyncMs(library: any) {
  const rows: SyncRow[] = Array.isArray(library?.sync) ? library.sync : [];
  const state = rows.find((x) => x.key === "library");
  const req: LibReq | null = library?.libraryRequest || LIBREQ.st || null;
  return Math.max(dateMs(state?.updated_at), dateMs(req?.done_at), dateMs(req?.requested_at));
}

function latestLastfmSyncMs(library: any) {
  const rows: SyncRow[] = Array.isArray(library?.sync) ? library.sync : [];
  return dateMs(rows.find((x) => x.key === "lastfm")?.updated_at);
}

function hasActiveLibraryRequest(library: any) {
  const req: LibReq | null = library?.libraryRequest || LIBREQ.st || null;
  return !!req && req.status === "pending" && !libStale(req);
}

export function shouldAutoSyncLibrary(library: any, now = Date.now()) {
  if (hasActiveLibraryRequest(library)) return false;
  const libraryAt = latestLibrarySyncMs(library);
  if (!libraryAt || now - libraryAt > AUTO_LIBRARY_SYNC_MAX_AGE_MS) return true;
  const lastfmAt = latestLastfmSyncMs(library);
  return !!lastfmAt && lastfmAt > libraryAt + AUTO_LIBRARY_SYNC_CLOCK_SKEW_MS;
}

export async function maybeAutoSyncLibrary(busy: boolean, set: Set, toast: Toast) {
  if (busy || autoLibraryBusy || DATA_SOURCE !== "Server" || !IOS_APP || BROWSER_PREVIEW) return false;
  if (typeof document !== "undefined" && document.hidden) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (LIBREQ.st?.status === "pending" && !libStale(LIBREQ.st)) return false;
  if (Date.now() - storedLastAutoSync() < AUTO_LIBRARY_SYNC_MIN_INTERVAL_MS) return false;
  autoLibraryBusy = true;
  try {
    const library = await getFresh("/library");
    if (!shouldAutoSyncLibrary(library)) return false;
    markAutoSyncAttempt();
    await syncLibrary(false, set, toast);
    return true;
  } catch {
    return false;
  } finally {
    autoLibraryBusy = false;
  }
}

export function libDone(j: LibReq) {
  if (LIBREQ.seenDone === j.done_at) return;
  LIBREQ.seenDone = j.done_at || null;
  stopPoll();
  const sm = j.summary || {};
  if(sm.catalog_changed)invalidateAppleLinks();
  if(sm.playlists!=null)invalidatePlaylistSnapshot();
  LIBREQ.toast?.(sm.catalog_changed ? "Đã đồng bộ thư viện và ID Apple Music" : !sm.added && !sm.missing && !sm.changed && !sm.metadata_changed ? "Thư viện đã khớp, không có gì mới" : "Đã đồng bộ thư viện");
  invalidate(() => true);
}
function stopPoll() {
  if (LIBREQ.poll) clearInterval(LIBREQ.poll);
  LIBREQ.poll = null;
}

// Màn Thư viện đang mở thì hỏi lại mỗi 20 giây, tối đa 10 phút.
export function startLibPoll() {
  if (LIBREQ.poll) return;
  LIBREQ.poll = setInterval(async () => {
    const st = LIBREQ.st;
    if (!st || st.status !== "pending" || libStale(st)) { stopPoll(); invalidate(() => false); return; }
    if (!LIBREQ.screenOpen) return;
    try {
      const j = await getFresh("/library/sync-request");
      LIBREQ.st = j;
      if (j.status === "done") libDone(j);
      if (j.status === "failed") { stopPoll(); LIBREQ.toast?.(j.error || "Đồng bộ chưa thành công"); }
    } catch {}
    invalidate(() => false);
  }, POLL_MS);
}

export async function syncLibrary(busy: boolean, set: Set, toast: Toast) {
  if (busy) return;
  if (DATA_SOURCE !== "Server") return toast("Chế độ Mẫu: không gọi server");
  set({ libBusy: true });
  try {
    const native = await syncLibraryInNativeApp(API_BASE, API_TOKEN);
    if (native?.summary) {
      const done = { status: "done", done_at: new Date().toISOString(), summary: native.summary, mode: "ios" };
      LIBREQ.st = done;
      LIBREQ.toast = toast;
      set({ libBusy: false });
      libDone(done);
      return;
    }
  } catch (error) {
    set({ libBusy: false });
    toast(error instanceof Error ? error.message : "Không đọc được thư viện Apple Music trên iPhone.");
    return;
  }
  const r = await postJson("/library/sync-request"), d = r.data || {};
  set({ libBusy: false });
  if (r.code === "d1_daily_limit") return toast("Server tạm nghỉ đến 7:00");
  if (r.status !== 200) return toast("Không gửi được yêu cầu, thử lại sau");
  LIBREQ.st = { ...d, status: d.status || "pending", requested_at: d.requested_at || new Date().toISOString() };
  LIBREQ.toast = toast;
  startLibPoll();
  invalidate(() => false);
}
