// Kết nối server thống kê (Cloudflare Worker).
// Token mặc định là token chỉ đọc (như bản thiết kế). Bản build riêng của chủ app đặt
// VITE_API_TOKEN = USER_TOKEN trong file .env (không đưa lên git): đọc mọi thứ, hai nút đồng bộ,
// ghép bài chưa khớp và công tắc gộp remaster. Ghi đè thêm được VITE_API_BASE / VITE_DATA_SOURCE.
const env = (import.meta as any).env || {};
export const BROWSER_PREVIEW = import.meta.env.VITE_BROWSER_PREVIEW === "true";
export const DESKTOP_WEB = BROWSER_PREVIEW && (window.location.pathname.endsWith("/web.html") || new URLSearchParams(window.location.search).has("desktop"));

export const API_BASE: string = String(
  env.VITE_API_BASE || "https://stats.helloween2610.workers.dev",
).replace(/\/$/, "");

export const API_TOKEN: string = String(
  env.VITE_API_TOKEN || "read_4bME54OBq-6uTgVOi81e9c6WHZNcM1rN",
);

// "Server": gọi server, lỗi thì giữ dữ liệu thành công gần nhất. "Mẫu": chế độ demo thủ công.
export const DATA_SOURCE: "Server" | "Mẫu" =
  !BROWSER_PREVIEW && env.VITE_DATA_SOURCE === "Mẫu" ? "Mẫu" : "Server";

export const FETCH_TIMEOUT_MS = 12000;

// Token chỉ đọc không ghép bài / đổi quy tắc được: khi đó hai việc này chỉ mô phỏng trên máy.
export const CAN_WRITE = !BROWSER_PREVIEW && !API_TOKEN.startsWith("read_");
