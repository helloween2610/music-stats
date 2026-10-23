import {readViews, type SavedViews} from '@/lib/view-preferences';
import {readPeriodListSize, type PeriodListSize} from "@/lib/list-preferences";
// Trạng thái giao diện (kỳ đang chọn, chip, ô tìm kiếm…). Giữ khi chuyển màn,
// Thống kê giữ kỳ đã chọn khi quay lại; lần đầu mặc định tháng hiện tại. Điều hướng do router đảm nhận.
import { atom } from "jotai";
import type { PageParents } from "@/lib/navigation";

export type Screen =
  | "recent" | "periodTop" | "today" | "top100" | "artistsAll" | "trend" | "overview"
  | "playlists" | "playlist" | "topPlaylists" | "releases" | "settings" | "library" | "unmatched" | "rules" | "rising" | "song" | "artist" | "album"
  | "notifications" | "releaseYears" | "overviewLastMonth" | "overviewThisMonth" | "overviewThisYear" | "overviewAllTime"
  | "player" | "widgetPreview";

export const WEB_OVERVIEW_SCOPES: Partial<Record<Screen,string>> = {
  overviewLastMonth: "Tháng trước", overviewThisMonth: "Tháng",
  overviewThisYear: "Năm", overviewAllTime: "All time",
};

// Tab Thống kê mở trực tiếp Tổng quan.
export const TABS: Screen[] = ["today", "trend", "overview", "releases", "playlists", "settings"];
export const TAB_LABELS = ["Hôm nay", "Diễn biến", "Tổng quan", "Sắp ra mắt", "Playlist", "Cài đặt"];
export const tabOf = (s: Screen) => TABS.indexOf(s);
export const TAB_ICONS = ["zi-calendar", "zi-poll", "zi-more-grid", "zi-gallery", "zi-favorite-list", "zi-setting"] as const;
export const TITLE: Record<Screen, string> = {
  album: "Album", recent: "Vừa nghe", playlists: "Danh sách playlist", playlist: "Playlist", topPlaylists: "Top Playlists",
  periodTop: "Top theo kỳ", today: "Hôm nay", top100: "Top 100 All time", artistsAll: "Nghệ sĩ All time",
  trend: "Diễn biến", overview: "Tổng quan", releases: "Sắp ra mắt", settings: "Cài đặt", library: "Cài đặt", unmatched: "Bài chưa khớp", rules: "Quy tắc thay thế", rising: "Bài đang lên hạng", song: "Bài hát", artist: "Nghệ sĩ",
  notifications: "Thông báo", releaseYears: "Năm phát hành",
  player: "Đang phát",
  widgetPreview: "Widget iPhone",
  overviewLastMonth: "Last Month", overviewThisMonth: "This Month", overviewThisYear: "This Year", overviewAllTime: "All Time",
};

export const pathOf = (screen: Screen, id?: string | null) => {
  switch (screen) {
    case "periodTop": return "/period-top/" + encodeURIComponent(id || "");
    case "today": return "/";
    case "recent": return "/recent";
    case "trend": return "/trend";
    case "overview": return "/overview";
    case "releaseYears": return "/release-years";
    case "overviewLastMonth": return "/last-month";
    case "overviewThisMonth": return "/this-month";
    case "overviewThisYear": return "/this-year";
    case "overviewAllTime": return "/all-time";
    case "releases": return "/releases";
    case "playlists": return id ? "/playlists/" + encodeURIComponent(id) : "/playlists";
    case "playlist": return "/playlist/" + encodeURIComponent(id || "");
    case "topPlaylists": return "/top-playlists";
    case "settings": return "/settings";
    case "library": return "/settings";
    case "top100": return "/top100";
    case "artistsAll": return "/artists";
    case "unmatched": return "/unmatched";
    case "rules": return "/rules";
    case "rising": return "/rising";
    case "song": return "/song/" + encodeURIComponent(id || "");
    case "album": return "/album/" + encodeURIComponent(id || "");
    case "artist": return "/artist/" + encodeURIComponent(id || "");
    case "notifications": return "/notifications";
    case "player": return "/player";
    case "widgetPreview": return "/widget-preview";
  }
};

export type UI = {
  views: SavedViews;
  playlistSort: string;
  playlistListSort: string;
  playlistFolder: string;
  listLimit: number;
  releaseMode: string;
  trendMode: "rising" | "Tháng trước" | "Tháng" | "Năm";
  trendAsOf: string;
  rankFocus?: {key:string;kind:'song'|'artist';label:string;request:number};
  periodListSize: PeriodListSize;
  pageParents: PageParents;
  tab: number;
  filter: string;
  periodSort: "Giờ nghe" | "Điểm All time" | "Lượt" | "Lịch sử";
  periodFilter: string;
  artistFilter: string;
  artistRankAsOf: string;
  songRankAsOf: string;
  albumFilter: string;
  albumRankAsOf: string;
  albumSort: "Giờ nghe" | "Lượt" | "Lịch sử";
  songView: "Danh sách" | "Lịch sử";
  sort: "Giờ nghe" | "Điểm" | "Lượt" | "Lịch sử";
  scope: string;
  open: number;
  q: string;
  qd: string;
  pick: Record<number, number>;
  matched: Record<number, { plays: number; to: string }>;
  findK: number | null;
  fq: string;
  fqd: string;
  rmTouched: boolean;
  remaster: boolean;
  remerge: boolean;
  lfmBusy: boolean;
  libBusy: boolean;
  ptoast: string; // toast của nút đồng bộ
  // Lựa chọn biểu đồ được lưu theo màn; sheet / toast đóng khi chuyển màn.
  sel: Record<string, number>;
  sheet: boolean;
  toast: string;
};

export const BASE: UI = {
  views: readViews(), playlistSort: "Thứ tự gốc", playlistListSort: "Thứ tự gốc", playlistFolder: "Tất cả", listLimit: 50, releaseMode: "recent", trendMode: "rising", trendAsOf: "",
  periodListSize: readPeriodListSize(),
  pageParents: {},
  artistFilter: "Tất cả", artistRankAsOf: "", songRankAsOf: "", albumFilter: "Tất cả", albumRankAsOf: "", albumSort: "Giờ nghe",
  tab: 0, songView: "Danh sách", periodSort: "Giờ nghe", periodFilter: "Tất cả", filter: "Tất cả", sort: "Giờ nghe", scope: "Tháng",
  open: 0, q: "", qd: "", lfmBusy: false, libBusy: false, ptoast: "", pick: {}, matched: {},
  findK: null, fq: "", fqd: "", rmTouched: false, remaster: true, remerge: false, sel: {}, sheet: false, toast: "",
};

export const uiAtom = atom<UI>(BASE);
