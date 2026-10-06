// Hai nút đồng bộ: hai POST duy nhất app gửi bằng token chỉ đọc,
// chỉ khi người dùng bấm Đồng bộ trong Thư viện, không gọi từ cử chỉ kéo trang.
import { DATA_SOURCE } from "@/config";
import { getFresh, invalidate, postJson } from "./api";
import { vn } from "./fmt";
import { invalidateAppleLinks } from './discovery';

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
const age = (iso?: string) => Date.now() - Date.parse(iso || "");
export const libStale = (r: LibReq) => r.status === "pending" && age(r.requested_at) > STALE_MS;

function libDone(j: LibReq) {
  if (LIBREQ.seenDone === j.done_at) return;
  LIBREQ.seenDone = j.done_at || null;
  stopPoll();
  const sm = j.summary || {};
  if(sm.catalog_changed)invalidateAppleLinks();
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
  const r = await postJson("/library/sync-request"), d = r.data || {};
  set({ libBusy: false });
  if (r.code === "d1_daily_limit") return toast("Server tạm nghỉ đến 7:00");
  if (r.status !== 200) return toast("Không gửi được yêu cầu, thử lại sau");
  LIBREQ.st = { ...d, status: d.status || "pending", requested_at: d.requested_at || new Date().toISOString() };
  LIBREQ.toast = toast;
  startLibPoll();
  invalidate(() => false);
}
