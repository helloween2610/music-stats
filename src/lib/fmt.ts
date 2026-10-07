// Hàm định dạng số, ngày và chuỗi dùng chung.

export const vn = (n: number) => Math.round(n).toLocaleString("vi-VN");
export const d1 = (n: number) =>
  n.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// Thời lượng nghe: "Nd Nh Nm", bỏ phần bằng 0 (1.061 phút → "17h 41m", 272,8 giờ → "11d 8h 48m").
export const fmtMin = (min: number) => {
  const m = Math.round(Math.max(0, min || 0));
  if (!m) return "0m";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return [d ? d + "d" : "", h ? h + "h" : "", mm ? mm + "m" : ""].filter(Boolean).join(" ");
};
export const fmtH = (hours: number) => fmtMin((hours || 0) * 60);

export const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
export const slug = (s: string) =>
  fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const ini = (s?: string | null) => {
  if (!s) return "♪";
  const w = s.replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean);
  if (!w.length) return "♪";
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
};

export const pad = (n: number) => String(n).padStart(2, "0");
export const hm = (min: number) => fmtMin(min);

export const DOWF = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
export const DOWS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const vnWeekdayIndex = (now = Date.now()) => (new Date(now + 7 * 3600e3).getUTCDay() + 6) % 7;
export const vnHour = (now = Date.now()) => new Date(now + 7 * 3600e3).getUTCHours();
export const ymd = (s: string) => {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return { y, m, d };
};
export const dm = (s?: string | null) => {
  if (!s) return "–";
  const t = ymd(s);
  return pad(t.d) + "/" + pad(t.m);
};
export const dmy = (s?: string | null) => {
  if (!s) return "–";
  const t = ymd(s);
  return pad(t.d) + "/" + pad(t.m) + "/" + t.y;
};
export const addDays = (s: string, n: number) => {
  const t = ymd(s);
  return new Date(Date.UTC(t.y, t.m - 1, t.d + n)).toISOString().slice(0, 10);
};
export const dow = (s: string) => {
  const t = ymd(s);
  return new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay();
};
export const toMs = (v: any) => {
  if (v == null || v === "") return NaN;
  if (typeof v === "number" || /^\d+$/.test(String(v))) return Number(v) * 1000;
  const s = String(v);
  if (s.length <= 10) return Date.parse(s + "T00:00:00+07:00");
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(" ", "T") : s.replace(" ", "T") + "Z");
};
const vnParts = (ms: number) => {
  const x = new Date(ms + 7 * 3600e3);
  return { d: x.getUTCDate(), m: x.getUTCMonth() + 1, y: x.getUTCFullYear(), H: x.getUTCHours(), M: x.getUTCMinutes() };
};
export const fmtWhen = (v: any) => {
  const ms = toMs(v);
  if (isNaN(ms)) return "–";
  const t = vnParts(ms),
    hasTime = typeof v === "number" || String(v).length > 10;
  return `${pad(t.d)}/${pad(t.m)}/${t.y}` + (hasTime ? `, ${pad(t.H)}:${pad(t.M)}` : "");
};
export const weekdayDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return '–';
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow(date)] + ' ' + dm(date);
};
export const shortDate = (v: any) => {
  const ms = toMs(v);
  if (isNaN(ms)) return "–";
  const t = vnParts(ms);
  return `${pad(t.d)}/${pad(t.m)}`;
};
export const ago = (v: any) => {
  const ms = toMs(v);
  if (isNaN(ms)) return "–";
  const mn = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return mn < 1
    ? "vừa xong"
    : mn < 60
      ? mn + " phút trước"
      : mn < 1440
        ? Math.round(mn / 60) + " giờ trước"
        : Math.round(mn / 1440) + " ngày trước";
};
// "2026-09" → "T09/26"
export const per = (s: any) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s ?? ""));
  return m ? `T${m[2]}/${m[1].slice(2)}` : String(s ?? "");
};
// "2026-09" → "09/26"
export const mlab = (s: any) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(s ?? ""));
  return m ? `${m[2]}/${m[1].slice(2)}` : String(s ?? "").replace(/^T(?=\d\d\/\d\d$)/, "");
};
// Tháng trước của một ngày "YYYY-MM-DD" → "YYYY-MM".
export const prevYm = (a: string) => {
  const t = ymd(a);
  return new Date(Date.UTC(t.y, t.m - 2, 1)).toISOString().slice(0, 7);
};
// "2026-10-01T22:36" (giờ máy) → "01/10/2026 22:36"
export const fmtLocal = (v: any) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(v || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : v ? dmy(v) : "–";
};
export const hhmm = (v: any) => {
  const ms = toMs(v);
  if (isNaN(ms)) return "–";
  const t = vnParts(ms);
  return pad(t.H) + ":" + pad(t.M);
};
export const hhmmdm = (v: any) => {
  const ms = toMs(v);
  if (isNaN(ms)) return "–";
  const t = vnParts(ms);
  return `${pad(t.H)}:${pad(t.M)} ${pad(t.d)}/${pad(t.m)}`;
};
export const cap1 = (s: any) =>
  s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase() : "";
const pctNum = (c: number) => (Number.isInteger(c) ? vn(c) : d1(c));
export const pctTxt = (c: number | null | undefined, word: string) =>
  c == null
    ? { t: `chưa có ${word} để so`, col: "var(--text3)" }
    : {
        t: `${c < 0 ? "▼" : c > 0 ? "▲" : "•"} ${pctNum(Math.abs(c))}% so với ${word}`,
        col: c < 0 ? "var(--down)" : c > 0 ? "var(--up)" : "var(--text3)",
      };
export const monthsBack = (endYm: string, n: number) => {
  const [y, m] = endYm.split("-").map(Number);
  return Array.from({ length: n }, (_, k) =>
    new Date(Date.UTC(y, m - 1 - (n - 1 - k), 1)).toISOString().slice(0, 7),
  );
};
