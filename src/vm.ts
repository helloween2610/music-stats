import { canonicalAlbum, groupedAllTimeAlbumRanks, hasGroupedAlbums } from './lib/album-groups';
import { allTimeRiseWindow, allTimeRankChanges, songAllTimeChanges, songAllTimeComparisons } from './lib/period-alltime-rise';
import { songRankTimeline, ranksWithHistoricalGaps } from './lib/song-rank-history';
import { albumHistoryDates, albumPlayPaths, mergeAlbumPlayResponses, rankedAlbums, rankChange } from './lib/album-ranking';
import { listDisplayLimit } from './lib/list-preferences';
import { findReleaseAlbum } from './lib/discovery';
import { albumId, albumKey, albumView, catalogAlbumView, periodAlbumRanking, releaseAlbumView, parseAlbumId } from './lib/albums';
import { applyArtworkRanks } from './lib/artwork-ranks';
// View-model cho từng màn: dựng số mẫu trước, rồi ghi đè bằng dữ liệu server.
// Lỗi mạng / 401 / 5xx / timeout / sai dạng → giữ dữ liệu server đã lưu, không thay bằng số mẫu.
import { CAN_WRITE, DATA_SOURCE, DESKTOP_WEB } from "@/config";
import { fetchJson, invalidate, postJson, lastGood } from "@/lib/api";
import {sameResponseReferences} from '@/lib/last-good';
import {
  area, artistMapChart, bar, bump, chgEl, chgInline, chgTxt, grouped, lineChart, listeningCalendar, listeningClock, songHistoryChart, spark, sparkGap, tagStream, vbars, Chg,
} from "@/lib/charts";
import {
  addDays, ago, cap1, d1, dm, dmy, dow, DOWF, DOWS, fmtH, fmtMin, fmtLocal, fmtWhen, fold, hhmm, hhmmdm, ini, mlab,
  monthsBack, pad, weekdayDate, toMs, pctTxt, per, prevYm, shortDate, slug, vn, vnHour, vnToday, vnWeekdayIndex, ymd,
} from "@/lib/fmt";
import * as S from "@/lib/sample";
import { metadataIndex, trackMetadata, collectionMetadata, ratingTone, artistTone, dateLabel, releaseTone, durationLabel, durationTone } from "@/lib/metadata";
import exportMetadata from "@/data/export-metadata.json";
import { monthWeeks } from "@/lib/month-weeks";
import { LIBREQ, libStale, startLibPoll, syncLastfm, syncLibrary } from "@/lib/sync";
import { SCOPE_ORDER, scopeValue, periodLabel, topPeriod, periodTopTitle, comparisonPeriod } from "@/lib/period-top";
import { Screen, UI } from "@/state";

type Any = any;
const scopeFromPeriod=(value:string)=>{
      if(/^\d{4}-\d{2}$/.test(value)) return value;
      const match=/^T(\d{2})\/(\d{2})$/.exec(value);
      return match ? `20${match[2]}-${match[1]}` : '';
    };
export type Ctx = {
  p: UI;
  screen: Screen;
  id: string | null;
  set: (fn: (q: UI) => Partial<UI>) => void;
  go: (screen: Screen, id?: string | null, view?: Partial<UI>) => void;
  goTab: (screen: Screen) => void;
  back: () => void;
  later: (ms: number, fn: () => void) => void;
  ptoast: (msg: string) => void;
};

const CHIP_ERR = "Không kết nối được server · đang hiện dữ liệu đã lưu";
const CHIP_D1 = "Server tạm nghỉ đến 7:00 · đang hiện dữ liệu đã lưu";
const LFM_SCHED = "Tự đồng bộ: T2–T6 lúc 0h, 7h, 9h, 12h–14h, 18h, 20h–23h · T7, CN lúc 0h, 2h, 7h, 9h, 11h–23h · mỗi lần lấy lại hôm qua và hôm nay";
const APPLE_SUB = "Bấm Đồng bộ để đọc XML thư viện và các file ID Apple Music từ nguồn đã cấu hình. Không cần bật Mac.";
const US = String.fromCharCode(31); // khoá album trong /artwork: "nghệ sĩ\u001falbum"
const SAMPLE_RULES = [["a dream of wilderness", "A Dream Of Wilderness 1.1", "Aephanemer"], ["strider", "Strider 1.1", "Aephanemer"], ["inner storm", "Inner Storm 1.1", "Aephanemer"], ["gilgamesh", "Gilgamesh 1.1", "Aephanemer"], ["the way of the fire", "The Way of the Fire 2.3", "Wintersun"]];

const periodSelection = (c: Ctx) => {
  const t = topPeriod(c.id);
  const canNew = t.kind !== "albums" && /^\d{4}(-\d{2})?$/.test(t.scope);
  return { ...t, canNew, newOnly: canNew && c.p.periodFilter === "Mới thêm" };
};

const ASORT: Record<string, string> = { "Giờ nghe": "hours", "Điểm": "points", "Lượt": "plays" };
const PT_KEYS = ["ratingAT", "rAT", "rFT0424", "ptWW", "ptMM", "ptYY", "rAlbum", "rSong"];
const SL = ["lượt", "bài", "nghệ sĩ", "album", "thể loại"];
const NOFL = S.NOFL;
const currentRank = (r: Any) => Number.isFinite(r.rank) && r.rank > 0 ? r.rank : Infinity;
const byCurrentRank = (a: Any, b: Any) => currentRank(a) - currentRank(b);

const chgOf = (r: Any): Chg => (r.previous == null ? "new" : r.previous - r.rank);
const flOf = (f: Any) => ({ hot: !!f && String(f).includes("*"), cold: !!f && String(f).includes("!!!") });
const histVals = (hist: Any[], periods: string[]) =>
  periods.map((pp) => { const e = (hist || []).find((x: Any) => x.period === pp); return e ? e.rank : null; });
const partRows = (x: Any) => S.partVals(x).map((q: Any) => ({ label: q.label, v: q.v, bar: bar(q.pct, "var(--c2)", 0) }));
const ptRows = (parts: Any) =>
  S.PT_L.map((l: string, j: number) => {
    const v = Number((parts || {})[PT_KEYS[j]] ?? 0);
    return { label: l, v: d1(v), bar: bar(Math.min(100, (v / Math.max(S.PT_MAX[j], v || 1)) * 100), "var(--c2)", 0) };
  });
const arrOf = (src: Any, len: number, keyFn: (o: Any) => number) => {
  const out = Array(len).fill(0);
  if (!Array.isArray(src)) return out;
  if (typeof src[0] === "number") return src.slice(0, len).concat(Array(Math.max(0, len - src.length)).fill(0));
  src.forEach((o) => { const k = keyFn(o); if (k >= 0 && k < len) out[k] = o.plays ?? o.n ?? o.count ?? 0; });
  return out;
};
const trendTabs = (c: Ctx, asOf: string) => {
  const date = /^\d{4}-\d{2}/.test(asOf) ? asOf : vnToday();
  const curM = Number(date.slice(5, 7));
  const items = [
    ["rising", "Đang lên hạng"],
    ["Tháng", "Tháng " + curM],
    ["Năm", "Năm " + date.slice(0, 4)],
  ] as const;
  return items.map(([value, label]) => ({
    label,
    active: c.p.trendMode === value,
    onTap: () => c.set(() => ({ trendMode: value, trendAsOf: "", sel: {} })),
  }));
};
const chips = (opts: string[], cur: string, set: (v: string) => void) =>
  opts.map((o) => ({ label: o, active: o === cur, onTap: () => set(o) }));

const endOfMonth = (ym: string) => addDays(`${ym}-01`, 40).slice(0, 7) === ym ? addDays(`${ym}-01`, 40) : addDays(addDays(`${ym}-01`, 40).slice(0, 7) + "-01", -1);
const trendMonthPeriodChips = (c: Ctx, currentAsOf: string) => {
  const currentYm = currentAsOf.slice(0, 7);
  const selectedYm = c.p.trendAsOf
    ? c.p.trendAsOf.slice(0, 7)
    : c.p.trendMode === "Tháng trước" ? prevYm(currentAsOf) : currentYm;
  const months = monthsBack(currentYm, Math.max(1, (Number(currentYm.slice(0, 4)) - 2024) * 12 + Number(currentYm.slice(5, 7)) - 3));
  return months.map((ym) => ({
    label: per(ym),
    active: ym === selectedYm,
    onTap: () => c.set(() => ({ trendMode: "Tháng" as const, trendAsOf: ym === currentYm ? "" : endOfMonth(ym), sel: {} })),
  }));
};
const artistRankPeriodValue = (asOf: string, currentAsOf: string) => !asOf || asOf.slice(0, 7) === currentAsOf.slice(0, 7) ? "" : asOf;
const artistRankAsOf = (p: UI, currentAsOf: string) => {
  const v = artistRankPeriodValue(p.artistRankAsOf, currentAsOf);
  return v || currentAsOf;
};
const artistRankPeriodItems = (currentAsOf: string) => {
  const currentYm = currentAsOf.slice(0, 7), currentYear = Number(currentYm.slice(0, 4)), previousYear = currentYear - 1;
  const items: { label: string; value: string; activeDate: string }[] = [];
  for (let y = 2024; y <= currentYear; y++) {
    if (y < previousYear) {
      const end = `${y}-12-31`;
      items.push({ label: String(y), value: end, activeDate: end });
      continue;
    }
    const lastMonth = y === currentYear ? Number(currentYm.slice(5, 7)) : 12;
    for (let m = 1; m <= lastMonth; m++) {
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      const isCurrent = ym === currentYm;
      const end = isCurrent ? currentAsOf : endOfMonth(ym);
      items.push({ label: per(ym), value: isCurrent ? "" : end, activeDate: end });
    }
  }
  return items;
};
const artistRankPeriodChips = (p: UI, currentAsOf: string, set: (v: string) => void) => {
  const selected = artistRankPeriodValue(p.artistRankAsOf, currentAsOf) || currentAsOf;
  return artistRankPeriodItems(currentAsOf).map(item => ({ label: item.label, active: selected.slice(0, 7) === item.activeDate.slice(0, 7) && (!/^\d{4}$/.test(item.label) || selected.slice(0, 4) === item.activeDate.slice(0, 4)), onTap: () => set(item.value) }));
};
const WEB_ARTIST_ALL_TIME_LIMIT = 32;
const WEB_SONG_ALL_TIME_LIMIT = 100;
const albumAllTimeLimit = (preference:unknown) => DESKTOP_WEB ? ALBUM_ALL_TIME_LIMIT : listDisplayLimit(false,preference);
const artistAllTimeLimit = (preference:unknown) => DESKTOP_WEB ? WEB_ARTIST_ALL_TIME_LIMIT : listDisplayLimit(false,preference);
const songAllTimeLimit = (_preference:unknown) => WEB_SONG_ALL_TIME_LIMIT;
const artistRankPath = (sort: string, asOf = "", limit = WEB_ARTIST_ALL_TIME_LIMIT) => `/artists/alltime?sort=${ASORT[sort] || "hours"}&limit=${limit}${asOf ? `&asOf=${asOf}` : ""}`;
const songRankAsOf = (p: UI, currentAsOf: string) => artistRankPeriodValue(p.songRankAsOf, currentAsOf) || currentAsOf;
const songRankPeriodChips = (p: UI, currentAsOf: string, set: (v: string) => void) => {
  const selected = artistRankPeriodValue(p.songRankAsOf, currentAsOf) || currentAsOf;
  return artistRankPeriodItems(currentAsOf).map(item => ({ label: item.label, active: selected.slice(0, 7) === item.activeDate.slice(0, 7) && (!/^\d{4}$/.test(item.label) || selected.slice(0, 4) === item.activeDate.slice(0, 4)), onTap: () => set(item.value) }));
};
const ALBUM_ALL_TIME_LIMIT = 24;
const songRankPath = (asOf = "") => `/history/songs?top=5000&months=36${asOf ? `&asOf=${asOf}` : ""}`;
const albumRankAsOf = (p: UI, currentAsOf: string) => artistRankPeriodValue(p.albumRankAsOf, currentAsOf) || currentAsOf;
const albumRankPeriodChips = (p: UI, currentAsOf: string, set: (v: string) => void) => {
  const selected = artistRankPeriodValue(p.albumRankAsOf, currentAsOf) || currentAsOf;
  return artistRankPeriodItems(currentAsOf).map(item => ({ label: item.label, active: selected.slice(0, 7) === item.activeDate.slice(0, 7) && (!/^\d{4}$/.test(item.label) || selected.slice(0, 4) === item.activeDate.slice(0, 4)), onTap: () => set(item.value) }));
};
const albumRankPaths = (asOf: string) => albumPlayPaths('all', asOf);

// Ảnh thẻ chia sẻ.
const statChart = (vals: number[]) => spark(vals, { w: 312, h: 96, inv: false, color: "var(--accent)", full: true, sw: 2 });
const cardSong = (s: Any) => ({ isWeek: false, period: "All time · " + S.TODAY, title: s.t, sub: s.a || "Chưa rõ nghệ sĩ",
  stats: [[s.ranked ? "#" + s.rank : "–", s.ranked ? (s.chg != null ? "Hạng · " + chgTxt(s.chg) : "Hạng") : "Không xếp hạng"], [vn(s.total), "Lượt nghe"], [s.scoreV, s.scoreL]].map(([v, l]) => ({ v, l })),
  chartLabel: "Lượt nghe theo tháng", chart: statChart(s.months) });
const cardArtist = (a: Any) => ({ isWeek: false, period: "All time · " + S.TODAY, title: a.name, sub: a.nSongs + " bài trong thư viện",
  stats: [["#" + a.allRank, "All time"], [vn(a.plays), "Lượt nghe"], [fmtH(a.hrs), "Giờ nghe"]].map(([v, l]) => ({ v, l })),
  chartLabel: "Giờ nghe 14 tháng", chart: statChart(a.hours) });


const SAMPLE_CD = {
  weekHours: S.HOURV,
  week: { def: 1, days: S.WDL.map((l: string, k: number) => ({ l, full: S.WDF[k], v: S.WEEK[k] })) },
  ov: { before: S.PRE, months: S.M.map((m: string, k: number) => ({ l: m, plays: S.P[k], hours: S.HRS[k] })), cap: 1300, hmax: 120, dots: Object.keys(S.GIVEN_H).map(Number), day: S.DAYV, dayDef: 28, mm: "09", wd: S.WDV, hr: S.HOURV },
  area: { years: S.YEARS, series: S.AREA, tot: S.AREA_T, def: 39 },
};
let SAMPLE_BUMP: Any = null;
const sampleBump = () => SAMPLE_BUMP || (SAMPLE_BUMP = bump(S.BUMP, S.BL));

// Biểu đồ của màn + dòng giá trị phía trên biểu đồ.
export function charts(c: Ctx, song: Any, art: Any, cd: Any = SAMPLE_CD) {
  const p = c.p, scr = c.screen, sel = (k: string, d: number) => p.sel[k] ?? d;
  const on = (k: string) => (j: number) => c.set((q) => ({ sel: { ...q.sel, [k]: j } }));
  const ch: Any = {}, rd: Any = {}, periodOptions: Any = {};
  if (scr === "today" && cd.week) {
    const W = cd.week, j = Math.min(W.def, W.days.length - 1), d = W.days[j];
    ch.week = grouped(W.days.map((x: Any) => ({ l: x.l, v: x.v })), { sel: j, today: W.def });
    rd.week = d.v ? `${d.full}: trung bình ${d.v[0] == null ? "–" : d1(d.v[0])} · tuần trước ${d.v[1]} · tuần này ${d.v[2] ?? "chưa tới"}` : `${d.full}: chưa tới`;
  }
  if (scr === "today" && Array.isArray(cd.weekHours)) {
    const vals = cd.weekHours, j = Math.min(vnHour(), vals.length - 1);
    ch.weekHour = listeningClock(vals, { sel: j, compact: true });
    rd.weekHour = `${pad(j)}h–${pad((j + 1) % 24)}h · ${vals[j]} lượt`;
  }
  if (scr === "overview" && cd.ov && cd.ov.months.length) {
    const O = cd.ov, off = O.before != null ? 1 : 0, mv = (off ? [O.before] : []).concat(O.months.map((m: Any) => m.plays || 0));
    const wide = DESKTOP_WEB ? {w:1100,h:210} : {};
    const jm = Math.min(sel("month", mv.length - 1), mv.length - 1), jh = Math.min(sel("hours", O.months.length - 1), O.months.length - 1);
    const monthPalette = ["#4f7cff", "#38bdf8", "#14d6bf", "#65d24b", "#b8de29", "#ffd24a", "#fb923c", "#ff6b6b", "#ec4899", "#d35ee0", "#8b5cf6", "#6478ff"];
    const weeks = Array.isArray(O.weekPlays) ? O.weekPlays : [];
    if (DESKTOP_WEB && weeks.length) {
      const weekVals = weeks.map((w: Any) => w.plays || 0);
      const lastMonthIndex = weeks[weeks.length - 1]?.monthIndex ?? 0;
      const weekLabels = weeks.map((w: Any, k: number) => {
        const monthStart = k === 0 || weeks[k - 1]?.month !== w.month;
        if (!monthStart) return "";
        const mi = w.monthIndex || 0;
        return mi === 0 || mi === lastMonthIndex || mi % 4 === 0 ? (O.months[mi]?.l || "") : "";
      });
      const weekColors = weeks.map((w: Any) => monthPalette[(w.monthIndex || 0) % monthPalette.length]);
      ch.month = vbars(weekVals, weekLabels, { ...wide, fill: 0.34, colors: weekColors, exactMax: Math.max(1, ...weekVals), onSel: (i: number) => c.set((q) => ({ sel: { ...q.sel, month: (weeks[i]?.monthIndex ?? 0) + off } })) });
    } else {
      ch.month = vbars(mv, (off ? ["Trước"] : []).concat(O.months.map((m: Any, k: number) => (k % 4 === 0 && !(off && k === 0) ? m.l : ""))), { ...wide, cap: O.cap, colors: off ? ["var(--text3)"] : [], sel: jm, onSel: on("month") });
    }
    rd.month = off && jm === 0 ? `Trước khi theo dõi · ${vn(O.before)} lượt` : `T${O.months[jm - off].l} · ${vn(O.months[jm - off].plays || 0)} lượt`;
    const hourVals = O.months.map((m: Any) => m.hours || 0);
    const artistLines = Array.isArray(O.topArtistHours) ? O.topArtistHours : [];
    const colors = ["var(--c2)", "#2dd4bf", "var(--c4)", "#b8de29", "#ffd24a", "var(--c6)", "#ff6b6b", "#ec4899", "#d35ee0", "#8b5cf6"];
    const hourSeries: Any[] = [{ vals: hourVals, color: artistLines.length ? "var(--text3)" : "var(--accent)", area: true, areaOpacity: artistLines.length ? 0.08 : 0.14, w: artistLines.length ? 2.2 : 2, dots: O.dots || [] }];
    artistLines.forEach((a: Any, k: number) => hourSeries.push({ vals: a.vals, color: colors[k % colors.length], w: 2.1, opacity: 0.95, select: false }));
    ch.hours = lineChart(hourSeries, O.months.map((m: Any, k: number) => (k % 5 === 0 ? m.l : "")), { ...wide, h: DESKTOP_WEB ? 500 : wide.h, smooth: DESKTOP_WEB, gradient: DESKTOP_WEB, exactMax: Math.max(1, ...hourVals), tf: (v: number) => Math.round(v) + "h", sel: jh, onSel: on("hours") });
    const selectedMonth = O.months[jh].month;
    const chartMonthArtists = artistLines.map((a: Any, k: number) => ({
      name: a.name,
      color: colors[k % colors.length],
      value: Number(a.vals?.[jh] || 0),
      label: `${pad(k + 1)}. ${a.name}`,
    }));
    const monthlyTopArtists = (Array.isArray(O.monthArtistHours) ? O.monthArtistHours : [])
      .filter((a: Any) => a.month === selectedMonth && a.name)
      .map((a: Any) => ({ name: a.name, value: Number(a.hours) || 0 }));
    const monthArtistMap = new Map<string, Any>();
    chartMonthArtists.forEach((a: Any) => monthArtistMap.set(a.name, a));
    monthlyTopArtists.forEach((a: Any) => { if (!monthArtistMap.has(a.name)) monthArtistMap.set(a.name, { ...a, color: "var(--accent)", label: a.name }); });
    const monthArtistHours = [...monthArtistMap.values()].sort((a: Any, b: Any) => b.value - a.value).slice(0, 12)
      .map((a: Any, k: number) => ({ ...a, color: a.color === "var(--accent)" ? colors[(k + artistLines.length) % colors.length] : a.color, label: a.label.startsWith?.(`${pad(k + 1)}.`) ? a.label : `${pad(k + 1)}. ${a.name}` }));
    const monthTop = monthArtistHours[0];
    rd.hours = `T${O.months[jh].l}·${fmtH(O.months[jh].hours || 0)}${monthTop && monthTop.value > 0 ? `·#1 ${monthTop.name}` : ""}`;
    periodOptions.hours = O.months.map((month: Any, index: number) => ({ label: `T${month.l}`, period: month.month, index }));
    rd.hoursBreakdown = DESKTOP_WEB && monthArtistHours.length ? {
      month: `T${O.months[jh].l}`,
      items: [{ label: "00. Tất cả", color: "var(--text3)", value: hourVals[jh] || 0 }].concat(monthArtistHours),
    } : null;
    if ((p.scope === "Tháng" || p.scope === "Tháng trước") && O.day) {
      const jd = Math.min(sel("day", O.dayDef ?? O.day.length - 1), O.day.length - 1), jw = sel("wd", vnWeekdayIndex()), jr = sel("hr", vnHour());
      ch.day = vbars(O.day, O.dayTicks || O.day.map((_: Any, k: number) => ((k + 1) % 5 === 0 || k === 0 ? String(k + 1) : "")), { sel: jd, onSel: on("day") });
      rd.day = `${O.dayDates?.[jd] || `${pad(jd + 1)}/${O.mm}`} · ${O.day[jd] ? O.day[jd] + " lượt" : "chưa có lượt"}`;
      ch.wd = vbars(O.wd, S.WDL, { w: DESKTOP_WEB ? 342 : 156, h: 156, sel: jw, onSel: on("wd") });
      rd.wd = `${S.WDL[jw]} · ${O.wd[jw]} lượt`;
      ch.hr = listeningClock(O.hr, { sel: jr, onSel: on("hr"), compact: true });
      rd.hr = `${pad(jr)}h–${pad((jr + 1) % 24)}h · ${O.hr[jr]} lượt`;
    }
  }
  if ((scr === "releaseYears" || scr === "overview" && p.scope === "All time") && cd.area && cd.area.years.length) {
    const A = cd.area, ja = Math.min(sel("area", A.def), A.years.length - 1);
    ch.area = area(A.years, A.series, { ...(DESKTOP_WEB ? {w:1100,h:320} : {}), sel: ja, onSel: on("area") });
    rd.area = `${A.years[ja]} · ${A.tot[ja]} bài`;
  }
  if (scr === "song" && song && song.months) {
    const mL = song.mL || S.M14, rawRanks = song.rankMonths || song.ranks || [];
    const ranks = mL.map((_: string, i: number) => rawRanks[i] ?? null);
    const selected = Math.min(sel("sh", song.months.length - 1), song.months.length - 1);
    const rank = ranks[selected];
    ch.sh = songHistoryChart(song.months, ranks, mL, { ...(DESKTOP_WEB ? { w: 1100, h: 320 } : {}), currentRank: song.currentRank, sel: selected, onSel: on("sh") });
    rd.sh = `T${mL[selected]} · ${song.months[selected]} lượt · ${rank == null ? "chưa có hạng" : "hạng #" + rank}`;
    periodOptions.sh = mL.map((label: string, index: number) => ({ label: `T${label}`, period: `20${label.slice(3, 5)}-${label.slice(0, 2)}`, index }));
  }
  if (scr === "artist" && art && art.hours) {
    const mL = art.mL || S.M14, tot = art.tot || S.LH, wT = art.wT || S.AWL, wL = art.wL || S.AWLF;
    const a = Math.min(sel("ah", art.hours.length - 1), art.hours.length - 1), b = Math.min(sel("aw", art.weeks.length - 1), art.weeks.length - 1);
    const rank = art.rankHistory?.[a] ?? null;
    ch.ah = songHistoryChart(art.hours, art.rankHistory || [], mL, { ...(DESKTOP_WEB ? { w: 1100, h: 320 } : {}), secondaryValues: tot, primaryLabel: art.name, secondaryLabel: "Tổng", valueFormatter: (v: number) => `${Math.round(v)}h`, valueMax: 120, rankThreshold: 50, ariaLabel: `Giờ nghe và lịch sử hạng theo tháng của ${art.name}`, currentRank: art.currentRank, sel: a, onSel: on("ah") });
    rd.ah = `T${mL[a]} · ${fmtH(art.hours[a] || 0)} · ${rank == null ? "chưa có hạng" : "hạng #" + rank}`;
    periodOptions.ah = mL.map((label: string, index: number) => ({ label: `T${label}`, period: `20${label.slice(3, 5)}-${label.slice(0, 2)}`, index }));
    ch.aw = vbars(art.weeks, wT, { h: 120, sel: b, onSel: on("aw") });
    rd.aw = `${wL[b]} · ${art.weeks[b]} lượt`;
  }
  return { ch, rd, periodOptions };
}

function sampleSearch(c: Ctx, q: string) {
  const f = fold(q.trim());
  if (!f) return [];
  const out: Any[] = [];
  Object.values(S.ADB).forEach((a: Any) => { if (fold(a.name).includes(f)) out.push({ kind: "Nghệ sĩ", title: a.name, sub: vn(a.plays) + " lượt · " + a.nSongs + " bài", ini: ini(a.name), round: true, onTap: () => c.go("artist", a.id) }); });
  Object.values(S.SDB).forEach((s: Any) => { if (fold(s.t).includes(f)) out.push({ kind: "Bài hát", title: s.t, sub: s.a || "Chưa rõ nghệ sĩ", ini: ini(s.a || s.t), round: false, onTap: () => c.go("song", s.id) }); });
  S.ALB.forEach(([t, a]: Any) => { if (fold(t).includes(f)) out.push({ kind: "Album", title: t, sub: a, ini: ini(t), round: false, onTap: () => c.go("album", albumId(a,t)) }); });
  return out.slice(0, 15);
}

const artName = (id: string | null) => ((S.ADB as Any)[id || ""] ? (S.ADB as Any)[id || ""].name : id || "Aephanemer");

function sampleVM(c: Ctx) {
  const scr = c.screen, SDB = S.SDB as Any, ADB = S.ADB as Any;
  let p = c.p;
  if (!(S.SCOPE_DATA as Any)[p.scope]) p = { ...p, scope: "Tháng" }; // "Tháng trước" chỉ có ở chế độ Server
  const setP = (patch: Partial<UI>) => c.set(() => patch);
  const sampleRules = SAMPLE_RULES.map(([from, title, artist]) => ({ from, title, artist, onTap: () => {} }));
  const toSong = (id: string) => () => c.go("song", id), toArtist = (id: string) => () => c.go("artist", id), noop = () => {};
  const song = SDB[scr === "song" && c.id && SDB[c.id] ? c.id : "memento-mori-2-0"], art = ADB[scr === "artist" && c.id && ADB[c.id] ? c.id : "aephanemer"];
  const sd = (S.SCOPE_DATA as Any)[p.scope];
  const mVals = Object.values(p.matched), unP = 870 - mVals.reduce((a, m) => a + m.plays, 0), unS = 630 - mVals.length;
  const matchRow = (m: Any, k: number) => {
    const sel = p.pick[k] ?? 0, done = p.matched[k];
    return { t: m.t, a: m.a, plays: m.plays, canMerge: !done && m.sugg.length > 0, canFind: !done && m.sugg.length === 0, done: !!done, showSugg: !done && m.sugg.length > 0,
      doneLabel: done ? `Đã ghép ${done.plays} lượt` : "", doneTo: done ? "→ " + done.to : "",
      sugg: m.sugg.map(([t, a]: Any, j: number) => ({ label: t + " · " + a, on: j === sel, onTap: () => c.set((q) => ({ pick: { ...q.pick, [k]: j } })) })),
      onMerge: () => c.set((q) => ({ matched: { ...q.matched, [k]: { plays: m.plays, to: m.sugg[q.pick[k] ?? 0].join(" · ") } } })),
      onFind: () => c.set(() => ({ findK: k, fq: "", fqd: "" })) };
  };
  const fItem = p.findK != null ? S.UNMATCHED[p.findK] : null, fq = fold(p.fq.trim());
  const fRes = fItem ? Object.values(SDB).filter((s: Any) => (fq ? fold(s.t).includes(fq) || fold(s.a).includes(fq) : s.a === fItem.a)).slice(0, 12).map((s: Any) => ({ title: s.t, artist: s.a || "Chưa rõ nghệ sĩ", ini: ini(s.a || s.t),
    onTap: () => c.set((q) => ({ matched: { ...q.matched, [q.findK as number]: { plays: fItem.plays, to: s.t + " · " + (s.a || "Chưa rõ nghệ sĩ") } }, findK: null, fq: "", fqd: "" })) })) : [];
  const isSettings = scr === "library" || scr === "settings";
  const results = isSettings ? sampleSearch(c, p.q) : [];
  const searching = isSettings && p.q.trim().length > 0;
  const sortKey = p.sort;
  const aList = sortKey === "Điểm" ? S.POINTS.map((x: Any) => ADB[slug(x.name)]) : S.ART.slice().sort((a: Any, b: Any) => (sortKey === "Lượt" ? b.plays - a.plays : b.hrs - a.hrs)).map((a: Any) => ADB[slug(a.name)]);
  const rk = (pdn: string) => { if (art.id === "aephanemer") return (S.AE_R as Any)[pdn]; const k = (S.PERIOD_DATA as Any)[pdn].arts.findIndex((e: Any) => e.id === art.id); return k >= 0 ? k + 1 : null; };
  const rf = (v: Any) => (v ? "#" + v : "–");
  const pt = (S.PTS as Any)[art.name], sDays = song.days ?? S.toDays(song.added), hasHist = song.ranked && song.ranks.length > 1;
  const { ch, rd, periodOptions } = charts(c, song, art);
  return {
    periodNewOnly: false, periodIsAlbums: false, periodAllTime: false, albumIsHistory:false,
    artistFilterChips: chips(["Tất cả", "Đang lên"],p.artistFilter || "Tất cả",v=>c.set(()=>({artistFilter:v}))),
    artistFilterNote:"", songFilterNote:"",
    albumSortChips:chips(["Giờ nghe","Lượt","Lịch sử"],p.albumSort || "Giờ nghe",v=>c.set(()=>({albumSort:v as UI["albumSort"]}))),
    albumFilterChips:chips(["Tất cả","Đang lên","Mới vào"],p.albumFilter || "Tất cả",v=>c.set(()=>({albumFilter:v}))),
    artistsEmpty: "Chưa có nghệ sĩ trong giai đoạn này.", songsEmpty: "Chưa có bài hát trong giai đoạn này.",
    topPeriodTitle: "Top theo kỳ", periodRows: [] as Any[], periodIsArtists: false, periodIsHistory: p.periodSort === "Lịch sử",
    monthSummary: null as Any,
    rankHistoryLabels: [] as string[], rankHistoryTitle: "Lịch sử thứ hạng · Top 10", rankHistoryChart: null, rankHistoryNote: "Đang tải lịch sử thứ hạng…",
    periodNote: "", periodEmpty: "Chưa có dữ liệu trong giai đoạn này.",
    periodSortChips: chips(["Giờ nghe", "Lượt", "Lịch sử"], p.periodSort === "Điểm All time" ? "Lượt" : p.periodSort, v => c.set(() => ({ periodSort: v as UI["periodSort"] }))),
    songIsHistory: p.songView === "Lịch sử",
    songViewTabs: chips(["Danh sách", "Tăng hạng", "Mới vào", "Lịch sử"],
      p.songView === "Lịch sử" ? "Lịch sử" : p.filter === "Đang lên" ? "Tăng hạng" : p.filter === "Mới vào" ? "Mới vào" : "Danh sách",
      value => c.set(() => value === "Tăng hạng" || value === "Mới vào"
        ? {songView:"Danh sách",filter:value === "Tăng hạng" ? "Đang lên" : value}
        : {songView:value as UI["songView"],filter:"Tất cả"})),
    periodRisingNote: "",
    periodFilterChips: chips(["Tất cả", "Đang lên", "Mới vào"], p.periodFilter, v => c.set(() => ({ periodFilter: v }))),
    topArtistsTitle: `Top ${DESKTOP_WEB ? 12 : 6} Artists ${p.scope}`, topSongsTitle: `Top 10 Songs ${p.scope}`,
    topAlbumsTitle: `Top 6 Albums ${p.scope}`, topGenresTitle: `Top 10 Genres ${p.scope}`,
    viewArtists: () => { c.go("artistsAll"); },
    viewAlbums: () => c.go("periodTop", `albums~${scopeValue(p.scope,vnToday())}~${vnToday()}`),
    viewSongs: () => { c.go("top100"); },
    ch, rd, periodOptions, sampleChip: false, chipText: CHIP_ERR, trendTabs: trendTabs(c, S.TODAY),
    top5Title: "Top 5 Songs M09/26", weekTitle: "Tuần này (28/09–04/10)", viewTodaySongs: () => c.go("top100"),
    top5Prev: false, top5Note: "", top5Sub: "", monthEmpty: false,
    lfmL: "Cập nhật 2 phút trước", lfmSched: LFM_SCHED, appleSub: APPLE_SUB,
    libPending: false, libStale: false, libPendingL: "",
    onSyncLfm: () => syncLastfm(p.lfmBusy, setP, c.ptoast), onSyncLib: () => syncLibrary(p.libBusy, setP, c.ptoast),
    rules3: sampleRules.slice(0, 3), rulesAll: sampleRules, rulesMore: `Xem tất cả (${SAMPLE_RULES.length} quy tắc)`, hasRules: true,
    dateLabel: "Thứ Ba, 29 tháng 9", wk: { plays: "31", sub: "20 bài · 8 nghệ sĩ", chg: "▼ 71,6% so với tuần trước", col: "var(--down)" }, mo: { plays: "210", sub: "114 bài · 40 nghệ sĩ", chg: "▼ 6,7% so với tháng trước", col: "var(--down)" },
    yr: { label: "Năm 2026", plays: "1.424", sub: "457 bài · 95 nghệ sĩ", prev: "Năm trước 6.786 lượt" }, totalLine: "Tổng 22.334 lượt · 3.012 bài · 411 nghệ sĩ",
    t100Head: "Thay đổi so với tháng trước · cập nhật T09/26", hasBefore: true, beforeL: "Trước khi theo dõi: 8.323 lượt (cột bị cắt)", dayTitle: "Tháng 9 · theo ngày", monthWeeks: monthWeeks("2026-09", "2026-09-29", S.DAYV),
    areaLegend: S.AREA.map((s: Any, k: number) => ({ name: s.name, color: `var(--c${k + 1})` })), bumpEl: scr === "trend" ? sampleBump() : null,
    weekTable: S.WEEK_ART.map(([name, a, b]: Any) => ({ name, an: name, ini: ini(name), ...S.fl(name), total: a + b, cells: [a, b, "", "", "", "", ""].map((v, k) => ({ v: k > 1 ? "·" : v || "–", s: { color: k > 1 || !v ? "var(--text3)" : "var(--text)", fontWeight: v && k < 2 ? 600 : 400 } })) })),
    appleL: "3.071 bài · thêm gần nhất 19/09/2026",
    shareCards: scr === "song" ? [cardSong(song)] : scr === "artist" ? [cardArtist(art)] : [],
    recent: S.RECENT.map(([t, a, tm, u]: Any) => ({ title: t, artist: a, time: tm, date: weekdayDate(S.TODAY), unmatched: !!u, ini: ini(a), onTap: toSong(slug(t)) })),
    top5: S.SONGS.slice(0, 5).map((s: Any, k: number) => ({ rank: k + 1, title: s.t, artist: s.a || "Chưa rõ nghệ sĩ", ini: ini(s.a || s.t), ...NOFL, chg: chgEl(s.c), spark: null, metric: s.n + " lượt", onTap: toSong(slug(s.t)) })),
    filterChips: chips(["Tất cả", "Đang lên", "Mới vào"], p.filter, (v) => c.set(() => ({ filter: v }))),
    top100Rows: S.TOP100.map((s: Any, k: number) => ({ ...s, k })).filter((s: Any) => p.filter === "Tất cả" || (p.filter === "Đang lên" ? s.c > 0 : s.c === "new"))
      .map((s: Any) => ({ rank: s.k + 1, chg: chgEl(s.c), title: s.t, artist: s.a || "Chưa rõ nghệ sĩ", lv: s.lv, peak: s.peak, months: s.months, spark: spark(s.hist, { w: 60, h: 22 }), onTap: toSong(slug(s.t)) })),
    sortChips: chips(["Giờ nghe", "Lượt", "Điểm", "Đang lên", "Mới vào", "Lịch sử"], p.sort === "Lịch sử" ? p.sort : p.artistFilter !== "Tất cả" ? p.artistFilter : p.sort, (v) => c.set(() => v === "Đang lên" || v === "Mới vào"
      ? {artistFilter:v, ...(p.sort === "Lịch sử" ? {sort:"Giờ nghe" as const} : {})}
      : {sort:v as UI["sort"],artistFilter:"Tất cả"})), sortPts: sortKey === "Điểm", artistIsHistory: p.sort === "Lịch sử",
    artistRows: aList.map((a: Any, k: number) => {
      const x = (S.PTS as Any)[a.name];
      return { rank: k + 1, name: a.name, ini: ini(a.name), ...S.fl(a.name), sub: `${a.nSongs} bài · nghe lần cuối ${a.last}`,
        big: sortKey === "Điểm" ? d1(x.pts) : sortKey === "Lượt" ? vn(a.plays) + " lượt" : fmtH(a.hrs),
        small: sortKey === "Điểm" ? `${fmtH(a.hrs)} · ${vn(a.plays)} lượt` : sortKey === "Lượt" ? fmtH(a.hrs) : vn(a.plays) + " lượt", onTap: toArtist(a.id) };
    }),
    ...(() => {
      const rows = S.RISING.map((r: Any) => {
        const n = r.path.length, up = n > 1 ? r.path[n - 2][1] - r.path[n - 1][1] : 0;
        return { rise: up, pos: r.pos, up: up > 0 ? "▲" + up : "", title: r.t, artist: r.a, path: r.path.slice(-2).map(([m, k]: Any) => `${m} #${k}`).join(" → "), spark: spark(r.path.map((x: Any) => x[1]), { w: 54, h: 26, color: "currentColor" }), onTap: toSong(slug(r.t)) };
      }).sort((a: Any, b: Any) => a.pos - b.pos);
      return { rising: rows.slice(0, 10), risingAll: rows, risingMore: true, risingCount: rows.length, risingHead: `${rows.length} bài lên hạng All time trong T09/26 · tăng so với tháng trước` };
    })(),
    risingArtists: S.RART.map((g: Any) => ({ month: g.month, rows: g.rows.slice().sort((a: Any, b: Any) => Number(String(a[1]).match(/#(\d+)/)?.[1] || Infinity) - Number(String(b[1]).match(/#(\d+)/)?.[1] || Infinity)).map(([name, ranks0]: Any) => ({ name, ini: ini(name), ...S.fl(name), ranks: String(ranks0).replace(/#(\d+) ← #(\d+)/, "#$2 → #$1"), sub: fmtH(ADB[slug(name)].hrs) + " All time", onTap: toArtist(slug(name)) })) })),
    scopeChips: chips([...S.SCOPES].reverse(), p.scope, (v) => c.set(() => ({ scope: v, sel: {} }))),
    stats: (S.STATS as Any)[p.scope].map((v: number, k: number) => ({ v: vn(v), l: SL[k], span: k < 3 ? 2 : 3 })), isMonth: p.scope === "Tháng", isAll: p.scope === "All time",
    hourArtists: sd.hourArt.slice(0, DESKTOP_WEB ? 12 : 6).map((a: Any, k: number) => ({ rank: k + 1, name: a.name, ...S.fl(a.name), v: fmtH(a.hrs), bar: bar((a.hrs / sd.hourArt[0].hrs) * 100), spark: spark(a.sp, { inv: false, w: 46 }), onTap: toArtist(a.id) })),
    scoreRows: S.POINTS.slice(0, 6).map((x: Any, k: number) => ({ rank: k + 1, name: x.name, ...S.fl(x.name), score: d1(x.pts), bar: bar((x.pts / (S.POINTS[0] as Any).pts) * 100, "var(--c2)"), open: p.open === k, onTap: () => c.set((q) => ({ open: q.open === k ? -1 : k })), parts: partRows(x) })),
    top15: sd.top15.slice(0, 10).map((e: Any, k: number) => { const s = SDB[e.id]; return { rank: k + 1, title: s.t, artist: s.a || "Chưa rõ nghệ sĩ", v: vn(e.v) + " lượt", onTap: toSong(e.id) }; }),
    genres: sd.genres.map((g: Any) => ({ name: g.n, v: vn(g.v), bar: bar((g.v / sd.genres[0].v) * 100, g.k < 8 ? `var(--c${g.k + 1})` : "var(--text3)", 4) })),
    albums: sd.albums.slice(0, 6).map((a: Any, k: number) => ({ rank: k + 1, title: a.t, artist: a.a, ini: ini(a.t), v: fmtH(a.v) })),
    searching, results, hasResults: results.length > 0, noResults: searching && results.length === 0,
    resultLabel: results.length ? `${results.length} kết quả` : "Kết quả",
    unPlays: vn(unP), unSongs: vn(unS),
    matches: S.UNMATCHED.slice(0, 3).map(matchRow), allMatches: S.UNMATCHED.map(matchRow),
    unHint: `Hiện ${S.UNMATCHED.length} bài nhiều lượt nhất, sắp theo số lượt`,
    rmOn: p.remaster, remerging: p.remerge, simNote: true as boolean,
    toggleRemaster: () => { c.set((q) => ({ remaster: !q.remaster, remerge: true })); c.later(1800, () => c.set(() => ({ remerge: false }))); },
    findOpen: !!fItem, findTitle: fItem ? `“${fItem.t}” – ${fItem.a} · ${fItem.plays} lượt` : "",
    findLabel: fq ? `${fRes.length} kết quả` : fItem ? `Bài của ${fItem.a} trong thư viện` : "", fRes, fNone: fRes.length === 0,
    song: { img: "", gone: false, title: song.t, artist: song.a, goArtist: toArtist(slug(song.a || "x")), ini: ini(song.t), lv: "lv" + song.lv,
      totalPlays: vn(song.total),
      score: song.scoreV, scoreL: song.scoreL, rank: song.ranked ? "#" + song.rank : "–", rankL: song.ranked ? "All time" : "Không xếp hạng",
      chg: song.ranked && song.chg != null ? chgInline(song.chg) : null, hasHist,
      histNote: song.ranked ? `Mới vào bảng All time T09/26 ở hạng #${song.rank}, chưa có lịch sử các tháng trước.` : `Bài này không nằm trong bảng All time (${song.note}).`,
      info: [["Thêm vào thư viện", `${song.added} · ${sDays} ngày`], ["Lần nghe cuối", song.last], ["Bỏ qua", song.skip + " lần"], ["Tổng", `${vn(song.total)} lượt · ${fmtMin(song.mins)}`]].concat(song.note ? [["Ghi chú", song.note]] : []).map(([k, v]) => ({ k, v })) },
    artist: { img: "", name: art.name, ini: ini(art.name), ...S.fl(art.name), sub: `${vn(art.plays)} lượt · ${fmtH(art.hrs)} · ${art.days} ngày có nghe`,
      metrics: [{ value: vn(art.plays), label: "Lượt nghe" }, { value: fmtH(art.hrs), label: "Thời gian nghe" }, { value: vn(art.days), label: "Ngày có nghe" }],
      wk: rf(rk("Tuần")), mo: rf(rk("Tháng")), all: "#" + art.allRank,
      rline: `7 ngày ${rf(rk("7 ngày"))} · 1 tháng ${rf(rk("1 tháng"))} · 100 ngày ${rf(rk("100 ngày"))} · từ 04/2024 ${rf(rk("Từ 04/2024"))}`,
      gap: d1(art.gap) + " ngày", lib: `Trong thư viện: ${art.nSongs} bài · ${art.nAlbums} Albums · ${art.genre}`,
      hasPts: !!pt, pts: pt ? d1(pt.pts) : "", ptsRank: pt ? "#" + pt.rank : "", parts: pt ? partRows(pt) : [],
      songs: art.songs.map((id: string, k: number) => ({ rank: k + 1, title: SDB[id].t, v: vn(SDB[id].total) + " lượt", onTap: toSong(id) })) },
  };
}

export type VM = ReturnType<typeof sampleVM> & { artwork?: {artists?:Record<string,string>;albums?:Record<string,string>;tracks?:Record<string,string>}; isLoading?: boolean; unavailable?: string; album?: any; currentSongChanges?: Record<string,number>; currentSongComparisons?: Record<string,string>; currentSongRanks?: Record<string,number>; currentSongRankGeneration?: string; playlistLibrary?: any[]; playlistArtwork?: Record<string,string>; nowPlayingLibrary?: any[]; todayPlaylistRows?: any[]; periodRisingGroups?: any[]; periodListOnly?: boolean; songRankMonthChips?: any[]; artistRankMonthChips?: any[]; albumRankMonthChips?: any[]; trendMonthChips?: any[] };

function serverGet(c: Ctx) {
  const p = c.p, scr = c.screen, D: Any = {}, codes: string[] = [], failures: string[] = [];
  let st: "ok" | "loading" | "err" = "ok", stale = false, failed = false;
  const dataTimes: number[] = [];
  const pull = (k: string, path: string, soft?: boolean, cacheOnly = false) => {
    const e = fetchJson(path, cacheOnly);
    if (!soft && e.st === "err") {
      failed = true;
      if (e.code) codes.push(e.code);
      failures.push(`${e.status ?? "lỗi không rõ"}${e.code ? ` · ${e.code}` : ""}`);
    }
    if (e.data != null) {
      D[k] = e.data;
      if (!soft) {
        dataTimes.push(e.dataAt);
        if (e.st !== "ok") stale = true;
      }
      return true;
    }
    if (soft) { D[k + "St"] = e.st; return false; }
    if (e.st === "err") st = "err";
    else if (st !== "err") st = "loading";
    return false;
  };
  // Artwork changes only when the library/artwork scanner finds a new image. Reuse the
  // persistent last-good copy across screen refreshes and app restarts; fetch only when
  // this device has no saved copy yet.
  pull("aw", "/artwork", true, true);
  // Read-only metadata enrichment against the existing API; no Version 1 backend changes.
  if (["today", "recent", "overview", "top100", "artistsAll", "periodTop", "song", "artist", "album", "settings", "library", "trend", "rising", "playlists", "playlist", "topPlaylists"].includes(scr)) {
    const currentSongRanksPath = "/charts/songs?window=at&limit=5000";
    pull("currentSongRanks", currentSongRanksPath, true);
    D.currentSongRankGeneration = fetchJson(currentSongRanksPath, true).generation;
    if (["overview", "album", "artist"].includes(scr) || scr === "periodTop" && topPeriod(c.id).kind === "albums") pull("currentAlbumRanks", "/charts/albums?limit=5000", true);
    pull("metadataStats", "/ratings", scr !== "album" && !(scr === "overview" && p.scope === "All time"));
    pull("libraryGeneration", "/library/generation", true);
    const rows: Any[] = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
      if (!D.libraryGeneration?.generation) break;
      const key = "metadataPage" + offset;
      if (!pull(key, `/library/metadata?offset=${offset}&limit=1000&generation=${D.libraryGeneration.generation}`, scr !== "playlists" && scr !== "album" && !(scr === "overview" && p.scope === "All time") && !(scr === "periodTop" && topPeriod(c.id).kind === "albums"), true)) break;
      const pageRows = D[key].rows;
      delete D[key]; // Do not duplicate the full library in a cached view.
      rows.push(...pageRows);
      if (pageRows.length < 1000) { D.metadataRows = rows; break; }
    }
  }
  if (scr === "recent") {
    pull("recent", "/recent?limit=25");
    const ids = (D.recent?.rows || []).map((row: Any) => row.track_id).filter(Boolean);
    if (ids.length) pull("detailSongHistory", `/history/song-ranks?ids=${encodeURIComponent([...new Set(ids)].join(","))}&months=60`, true);
  }
  if (scr === "playlist") pull("recent", "/recent?limit=200", true);
  if (scr === "today") {
    const hasSummary = pull("sum", "/summary");
    pull("daily", "/daily"); pull("weekHours", "/overview?scope=week"); pull("recent", DESKTOP_WEB ? "/recent?limit=25" : "/recent?limit=5"); pull("wart", DESKTOP_WEB ? "/artists/week?limit=50" : "/artists/week?limit=5");
    pull("rollingSongs", "/charts/songs?window=15d&limit=5000");
    const ids = [...(D.recent?.rows || []), ...(D.rollingSongs?.rows || [])].map((row: Any) => row.track_id).filter(Boolean);
    if (ids.length) pull("detailSongHistory", `/history/song-ranks?ids=${encodeURIComponent([...new Set(ids)].join(","))}&months=60`, true);
    if (hasSummary) {
      const weekStart = addDays(D.sum.asOf, -((dow(D.sum.asOf) + 6) % 7));
      pull("todayArtistRanks", "/charts/artists?window=at&limit=5000", true);
      pull("todayArtistRanksBefore", `/charts/artists?window=at&asOf=${addDays(weekStart, -1)}&limit=5000`, true);
    }
  }
  if (scr === "top100" || scr === "artistsAll" || (scr === "periodTop" && topPeriod(c.id).kind === "albums" && topPeriod(c.id).scope === "all")) pull("sum", "/summary", true);
  if (scr === "top100") {
    const currentAsOf = D.sum?.asOf || vnToday();
    const songAsOf = songRankAsOf(p, currentAsOf);
    const historicalAsOf = songAsOf < currentAsOf ? songAsOf : "";
    const e = fetchJson(songRankPath(historicalAsOf), !!historicalAsOf);
    if (e.data != null) {
      D.hist = e.data;
      dataTimes.push(e.dataAt);
      if (e.st !== "ok") stale = true;
    } else if (e.st === "err") { st = "err"; failed = true; if (e.code) codes.push(e.code); }
    else if (st !== "err") st = "loading";
  }
  if (scr === "rising" || scr === "trend") {
    if (pull("hist", "/history/songs?top=100&months=36")) {
      const date = D.hist.asOf || vnToday();
      const monthEnd = addDays(date.slice(0, 7) + "-01", -1);
      pull("risingCurrentOverview", `/overview?scope=${date.slice(0,7)}&asOf=${date}&limit=5000`,true);
      pull("risingPreviousOverview", `/overview?scope=${monthEnd.slice(0,7)}&asOf=${monthEnd}&limit=5000`,true);
      // Query last play as of that month, so a newer play cannot hide an older month's activity.
      pull("risingHistory", `/history/songs?top=300&months=36&asOf=${monthEnd}`);
    }
  }
  if (scr === "artistsAll") {
    const currentAsOf = D.sum?.asOf || vnToday();
    const limit=artistAllTimeLimit(p.periodListSize);
    const artistAsOf = artistRankAsOf(p, currentAsOf);
    const historicalAsOf = artistAsOf < currentAsOf ? artistAsOf : "";
    if (["Đang lên","Mới vào"].includes(p.artistFilter) && p.sort !== "Lịch sử") {
      const prev=comparisonPeriod("all",artistAsOf);
      const prevPath = artistRankPath(p.sort, prev.asOf, limit);
      const pe = fetchJson(prevPath, true);
      if (pe.data != null) {
        D.previousArtists = pe.data;
        dataTimes.push(pe.dataAt);
        if (pe.st !== "ok") stale = true;
      } else if (pe.st === "err") { st = "err"; failed = true; if (pe.code) codes.push(pe.code); }
      else if (st !== "err") st = "loading";
    }
    pull("ahist", "/history/artists?top=300&months=36", true);
    const aatPath = artistRankPath(p.sort, historicalAsOf, limit);
    const e = fetchJson(aatPath, !!historicalAsOf);
    if (e.data != null) {
      D.aat = e.data;
      dataTimes.push(e.dataAt);
      if (e.st !== "ok") stale = true;
    } else if (e.st === "err") { st = "err"; failed = true; if (e.code) codes.push(e.code); }
    else if (st !== "err") st = "loading";
    // The selected response is already the current ranking unless the user selected a
    // historical month. Avoid requesting the same expensive All-time query twice.
    if (!historicalAsOf) D.currentArtistRanks = D.aat;
    else {
      const cur = fetchJson(artistRankPath(p.sort, "", limit), false);
      if (cur.data != null) {
        D.currentArtistRanks = cur.data;
        dataTimes.push(cur.dataAt);
        if (cur.st !== "ok") stale = true;
      } else if (cur.st === "err") { st = "err"; failed = true; if (cur.code) codes.push(cur.code); }
      else if (st !== "err") st = "loading";
    }
    pull("atc", `/charts/artists?window=at&limit=${Math.max(50,limit)}${historicalAsOf ? `&asOf=${historicalAsOf}` : ""}`, true);
  }
  if (scr === "trend") { pull("hist", "/history/songs?top=100&months=36"); pull("ahist", "/history/artists?top=50&months=36"); }
  if (scr === "periodTop") {
    const t = periodSelection(c);
    const listOnly = t.kind === "songs" && t.scope === "15d";
    const rising = !listOnly && (t.kind === "albums" ? p.albumFilter : p.periodFilter) === "Đang lên";
    if (rising) {
      const selectedAlbumAsOfForRise = t.kind === 'albums' && t.scope === 'all' ? albumRankAsOf(p, D.sum?.asOf || vnToday()) : t.asOf;
      const range = allTimeRiseWindow(t.scope, selectedAlbumAsOfForRise < vnToday() ? selectedAlbumAsOfForRise : vnToday());
      D.periodRiseWindow = range;
      if (t.kind === "artists" || t.kind === "albums") {
        for (const [key, date] of [["periodATBefore", range.before], ["periodATEnd", range.end]]) {
          pull(key, `/charts/${t.kind}?${t.kind === "artists" ? "window=at&" : ""}limit=5000&asOf=${date}`, t.kind === "albums" && t.scope === "all" && date < (D.sum?.asOf || vnToday()));
          if (t.kind === "albums" && D.metadataRows && hasGroupedAlbums(D.metadataRows)) pull(key + "Stats", `/ratings?asOf=${date}`, t.kind === "albums" && t.scope === "all" && date < (D.sum?.asOf || vnToday()));
        }
      } else pull("periodATHistory", "/history/songs?top=5000&months=36");
    }
    if (!listOnly && t.kind !== "albums" && !t.newOnly && (t.kind === "artists" ? p.periodSort === "Lịch sử" : p.songView === "Lịch sử")) pull("rankHistory", `/history/period?scope=${t.scope}&asOf=${t.asOf}&kind=${t.kind}&sort=hours&limit=25`, true);
    if(t.kind === "albums") {
      const currentAsOf = D.sum?.asOf || vnToday();
      const selectedAlbumAsOf = t.scope === 'all' ? albumRankAsOf(p, currentAsOf) : t.asOf;
      const historicalAlbumAsOf = t.scope === 'all' && selectedAlbumAsOf < currentAsOf ? selectedAlbumAsOf : "";
      const loadPlays=(key:string,scope:string,date:string,cacheOnly=false)=>{
        const responses:Any[]=[];let complete=true;
        for(const [i,path] of albumPlayPaths(scope,date).entries()){
          const responseKey=key+i;
          const e=fetchJson(path, cacheOnly);
          if(e.data!=null){
            D[responseKey]=e.data;responses.push(D[responseKey]);
            dataTimes.push(e.dataAt);if(e.st!=="ok")stale=true;
          }else{
            complete=false;
            if(e.st==="err"){st="err";failed=true;if(e.code)codes.push(e.code);}
            else if(st!=="err")st="loading";
          }
          delete D[responseKey];
        }
        if(complete)D[key]={rows:mergeAlbumPlayResponses(responses)};
      };
      loadPlays("albumPlays",t.scope,selectedAlbumAsOf,!!historicalAlbumAsOf);
      if(t.scope === 'all') {
        D.albumHistoryDates=albumHistoryDates(t.scope,selectedAlbumAsOf);
        D.albumHistoryDates.forEach((date:string)=>loadPlays("albumHistory"+date,t.scope,date,date<currentAsOf));
      }
      if(p.albumSort === "Lịch sử"){
        // albumHistoryDates is already loaded above for All time; keep this branch for non-all scopes.
        if(t.scope !== 'all') {
          D.albumHistoryDates=albumHistoryDates(t.scope,selectedAlbumAsOf);
          D.albumHistoryDates.forEach((date:string)=>loadPlays("albumHistory"+date,t.scope,date,t.scope==='all'&&date<currentAsOf));
        }
      }else if(p.albumFilter === "Mới vào"){
        const prev=comparisonPeriod(t.scope,selectedAlbumAsOf);
        loadPlays("previousAlbums",prev.scope,prev.asOf,t.scope==='all'&&prev.asOf<currentAsOf);
      }else if(p.albumFilter === "Đang lên" && t.scope === 'all' && D.periodRiseWindow){
        loadPlays("periodATBeforeStats",'all',D.periodRiseWindow.before,D.periodRiseWindow.before<currentAsOf);
        loadPlays("periodATEndStats",'all',D.periodRiseWindow.end,D.periodRiseWindow.end<currentAsOf);
      }
    }
    else if (t.newOnly) pull("additions", `/new-additions?scope=${t.scope}&asOf=${t.asOf}&limit=5000&inLibrary=1&v=3`);
    else if (t.kind === "monthSongs") pull("periodSongs", `/charts/songs?window=month&asOf=${t.asOf}&limit=5000`);
    else pull("ov", `/overview?scope=${t.scope}&asOf=${t.asOf}&limit=5000`);
    if (t.kind === "artists") {
      pull("metaArtists", "/artists/alltime?sort=hours&limit=5000", true);
      if (!t.newOnly) {
        const prev = comparisonPeriod(t.scope, t.asOf);
        pull("prevOv", `/overview?scope=${prev.scope}&asOf=${prev.asOf}&limit=5000`, true);
      }
    }
    else if(t.kind !== "albums") {
      pull("hist", "/history/songs?top=300&months=18", true);
      if (!listOnly && !t.newOnly && t.kind !== "monthSongs") {
        const prev = comparisonPeriod(t.scope, t.asOf);
        pull("prevOv", `/overview?scope=${prev.scope}&asOf=${prev.asOf}&limit=5000`, true);
      }
    }
  }
  if (scr === "releaseYears") { pull("ry", "/release-years"); pull("aat", "/artists/alltime?sort=hours&limit=5000", true); }
  if (scr === "overview") {
    if (p.scope === "All time") {
      pull("hist", "/history/songs?top=100&months=18");
      pull("aat", "/artists/alltime?sort=hours&limit=100");
    }
    if (!DESKTOP_WEB && p.scope === "All time") pull("ry", "/release-years");
    if (p.scope === "All time") pull("pts", "/points/artists");
    if (pull("sum", "/summary")) {
      const trendOverride = c.id?.startsWith("trend~") ? c.id.slice(6) : "";
      const a = /^\d{4}-\d{2}-\d{2}$/.test(trendOverride) ? trendOverride : D.sum.asOf;
      const overviewScope = ({ "All time": "all", "Từ 04/2024": "ft0424", "Năm": a.slice(0, 4), "Tháng": a.slice(0, 7), "Tháng trước": prevYm(a) } as Any)[p.scope];
      if (pull("ov", `/overview?scope=${overviewScope}&asOf=${a}&limit=5000&spark=v2`)) {
        const months = Array.isArray(D.ov?.months) ? D.ov.months : [];
        const selectedHour = Math.min(p.sel?.hours ?? months.length - 1, months.length - 1);
        const selectedMonth = months[selectedHour]?.month;
        if (selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)) pull("ovHoursMonth", `/overview?scope=${selectedMonth}&asOf=${a}&limit=5000`, true);
        if (DESKTOP_WEB && p.scope !== "Tháng" && p.scope !== "Tháng trước") months.forEach((m: Any) => {
          if (m?.month && /^\d{4}-\d{2}$/.test(m.month)) pull("ovWeek" + m.month.replace("-", ""), `/overview?scope=${m.month}&asOf=${a}&limit=1`, true);
        });
      }
      if (/^\d{4}$/.test(overviewScope)) {
        for (let month = 1; month <= 12; month++) {
          const mm = pad(month);
          pull("calendarMonth" + mm, `/overview?scope=${overviewScope}-${mm}&asOf=${a}&limit=1`, true);
        }
      }
      if (overviewScope === "all" || /^\d{4}(-\d{2})?$/.test(overviewScope)) {
        const riseWindow = allTimeRiseWindow(overviewScope, a);
        pull("monthSummaryAdditions", `/new-additions?scope=${overviewScope === "all" ? a.slice(0, 4) : overviewScope}&asOf=${a}&limit=5000&inLibrary=1&v=3`, true);
        pull("monthSummaryATBefore", `/charts/artists?window=at&limit=5000&asOf=${riseWindow.before}`, true);
        pull("monthSummaryATEnd", `/charts/artists?window=at&limit=5000&asOf=${riseWindow.end}`, true);
        pull("monthSummarySongATBefore", `/charts/songs?window=at&limit=5000&asOf=${riseWindow.before}`, true);
        pull("monthSummarySongATEnd", `/charts/songs?window=at&limit=5000&asOf=${riseWindow.end}`, true);
      }
      if(D.metadataRows && hasGroupedAlbums(D.metadataRows) && p.scope!=="All time") {
        const scope=scopeValue(p.scope,a);
        pull("groupAlbumPlays",`/overview?scope=${scope}&asOf=${a}&limit=5000`);
      }
    }
  }
  if (scr === "settings" || scr === "library" || scr === "unmatched") {
    pull("lib", "/library");
    pull("un", scr === "unmatched" ? "/library/unmatched?limit=50" : "/library/unmatched?limit=3");
    if (scr === "settings" || scr === "library") pull("rules", "/library/title-rules", true);
    const qd = (p.qd || "").trim();
    if ((scr === "settings" || scr === "library") && qd.length >= 2) pull("srch", `/library/search?q=${encodeURIComponent(qd)}&limit=15`, true);
    if (p.findK != null && D.un && D.un.rows[p.findK]) {
      const q = (p.fqd || "").trim() || D.un.rows[p.findK].artist;
      if (q.length >= 2) pull("fs", `/library/search?q=${encodeURIComponent(q)}&limit=15`, true);
    }
  }
  if (scr === "song") {
    let id: string | null = c.id;
    if (!/^TR/i.test(id || "")) {
      const t = ((S.SDB as Any)[id || ""] || {}).t;
      id = null;
      if (!t) st = "err";
      else if (pull("ss", `/library/search?q=${encodeURIComponent(t)}&limit=15`)) {
        const ss = D.ss.songs || [], hitRow = ss.find((x: Any) => fold(x.title) === fold(t)) || ss[0];
        if (hitRow) id = hitRow.track_id; else st = "err";
      }
    }
    if (id) { D.songId = id; pull("song", "/song/" + encodeURIComponent(id) + "?history=v2"); }
  }
  if (scr === "artist") {
    pull("art", "/artist/" + encodeURIComponent(artName(c.id)));
    if (D.art) {
      pull("artistRankHistory", `/history/artists?top=${Math.max(300, Number(D.art.ranks?.at) || 0)}&months=36`, true);
      const ids = (D.art.topSongs || []).slice(0, 5).map((row: Any) => row.track_id).filter(Boolean);
      if (ids.length) pull("detailSongHistory", `/history/song-ranks?ids=${encodeURIComponent(ids.join(","))}&months=60`, true);
    }
  }
  if (scr === "album") {
    const identity = parseAlbumId(c.id);
    if (identity) {
      const history = fetchJson(`/history/albums?artist=${encodeURIComponent(identity.artist)}&album=${encodeURIComponent(identity.title)}&months=60`);
      if (history.data != null) D.albumRankHistory = history.data;
      const ids = (D.metadataRows || []).filter((track: Any) => albumKey(track) === identity.artist + US + identity.title).map((track: Any) => track.id).filter(Boolean);
      if (ids.length) pull("detailSongHistory", `/history/song-ranks?ids=${encodeURIComponent(ids.join(","))}&months=60`, true);
    }
  }
  if(D.metadataRows && D.metadataStats && D.currentAlbumRanks) {
    const rows=groupedAllTimeAlbumRanks(D.metadataRows,D.metadataStats.rows || []);
    if(rows)D.currentAlbumRanks={...D.currentAlbumRanks,rows};
  }
  for (const key of ["periodATBefore", "periodATEnd"]) {
    if (D.metadataRows && D[key + "Stats"]) {
      const rows = groupedAllTimeAlbumRanks(D.metadataRows, D[key + "Stats"].rows || []);
      if (rows) D[key] = { ...D[key], rows };
    }
  }
  if(scr==="overview" && D.ov && D.metadataRows && (p.scope==="All time" || hasGroupedAlbums(D.metadataRows))) {
    const plays=p.scope==="All time"?D.metadataStats?.rows:D.groupAlbumPlays?.songs;
    if(plays){
      const periodAlbums=periodAlbumRanking(plays,D.metadataRows);
      const albums=p.scope==="All time" ? rankedAlbums(plays,D.metadataRows,"Giờ nghe",true) : periodAlbums;
      D.ov={...D.ov,albums:albums.slice(0,10),totals:{...D.ov.totals,albums:periodAlbums.length}};
    }
  }
  if (scr === "album" && D.metadataRows) {
    // Keep the full library available on album detail. Some catalog editions are
    // split into duplicate local tracks, while Last.fm attaches every play to one
    // sibling. albumView still renders only the requested album, but can borrow
    // stats from the matching sibling when the visible edition has 0 plays.
    D.albumTracks=D.metadataRows;
    D.albumStats=D.metadataStats;
  }
  if (scr === "rules") pull("rules", "/library/title-rules");
  return { st: st as "ok" | "loading" | "err", D, codes, failures: [...new Set(failures)], stale, failed, dataAt: dataTimes.length ? Math.min(...dataTimes) : 0 };
}

// Ghép thật trên server (token của chủ app); token chỉ đọc thì chỉ đánh dấu trên máy như bản thiết kế.
async function mergeTo(c: Ctx, m: Any, k: number, t: { id: string; title: string; artist?: string | null }) {
  const label = t.title + " · " + (t.artist || "Chưa rõ nghệ sĩ");
  c.set((q) => ({ matched: { ...q.matched, [k]: { plays: m.plays, to: label } }, findK: null, fq: "", fqd: "" }));
  if (!CAN_WRITE) return;
  const r = await postJson("/library/match", { artist: m.artist, title: m.title, album: m.album ?? null, track_id: t.id });
  if (r.status === 200 && r.data) {
    c.ptoast(`Đã ghép ${vn(r.data.matched ?? m.plays)} lượt → ${t.title}`);
    // Danh sách chưa khớp đổi thứ tự sau khi ghép: xoá đánh dấu theo vị trí rồi tải lại.
    c.set(() => ({ matched: {}, pick: {} }));
    invalidate(() => true);
  } else {
    c.set((q) => { const mm = { ...q.matched }; delete mm[k]; return { matched: mm }; });
    c.ptoast(r.code === "d1_daily_limit" ? "Server tạm nghỉ, chưa ghép được" : "Không ghép được, thử lại sau");
  }
}

function srvMatchRow(c: Ctx, m: Any, k: number) {
  const p = c.p, sel = p.pick[k] ?? 0, done = p.matched[k], sugg = (m.suggestions || []).slice(0, 3);
  return { t: m.title, a: m.artist, plays: m.plays, canMerge: !done && sugg.length > 0, canFind: !done && sugg.length === 0, done: !!done, showSugg: !done && sugg.length > 0,
    doneLabel: done ? `Đã ghép ${done.plays} lượt` : "", doneTo: done ? "→ " + done.to : "",
    sugg: sugg.map((s: Any, j: number) => ({ label: s.title + " · " + s.artist, on: j === sel, onTap: () => c.set((q) => ({ pick: { ...q.pick, [k]: j } })) })),
    onMerge: () => { const s = sugg[p.pick[k] ?? 0]; if (s) mergeTo(c, m, k, { id: s.id, title: s.title, artist: s.artist }); },
    onFind: () => c.set(() => ({ findK: k, fq: "", fqd: "" })) };
}

// Bài đang lên hạng dùng cùng trục lịch sử 05/2024–hiện tại với trang chi tiết.
function risingRows(H: Any, asOf: string, toSong: (id: string) => () => void, noop: () => void) {
  // rise compares the current rank with the latest month-end snapshot.
  // lastMonth.rise describes a finished month and can include songs now falling.
  const rise = (r: Any) => r.rise ?? 0;
  const period = (H.periods || []).slice(-1)[0];
  const month = /^T(0[1-9]|1[0-2])\/(\d{2})$/.exec(period || "");
  // Require a logged play after the comparison snapshot, using Vietnam midnight.
  // Missing play/comparison dates cannot establish activity in this period.
  const start = month ? Date.UTC(2000 + Number(month[2]), Number(month[1]), 1) / 1000 - 7 * 3600 : NaN;
  const end = Date.parse(`${addDays(H.asOf || asOf, 1)}T00:00:00+07:00`) / 1000;
  return (H.rows || []).filter((r: Any) => rise(r) > 0 && Number.isFinite(r.lastPlayedAt) && r.lastPlayedAt >= start && r.lastPlayedAt < end).sort((a: Any, b: Any) => b.lastPlayedAt - a.lastPlayedAt || byCurrentRank(a,b)).map((r: Any) => ({
    tid: r.track_id, pos: r.rank, up: "▲" + rise(r), risingRank: r.rank, risingPreviousRank: r.previous ?? r.rank + rise(r), risingPreviousPeriod: period, title: r.title, artist: r.artist || "Chưa rõ nghệ sĩ",
    path: (r.history || []).slice(-2).map((e: Any) => `${per(e.period)} #${e.rank}`).join(" → "),
    spark: sparkGap(songRankTimeline(r.history || [], H.asOf || asOf, r.rank).ranks, { w: 54, h: 26, full: true, trimLeading: true, color: "var(--song-history-rank)" }), onTap: r.track_id ? toSong(r.track_id) : noop,
  }));
}

function risingSongGroups(D: Any, asOf: string, toSong: (id: string) => () => void, noop: () => void) {
  const date = D.hist.asOf || asOf;
  const end = addDays(date.slice(0, 7) + "-01", -1);
  const month = per(end.slice(0, 7)), previous = per(prevYm(end));
  const history = D.risingHistory;
  const withPeriodMetrics=(rows:Any[],overview:Any)=>{
    const scopedRows=overview?.songs || [];
    const metrics=new Map<string,Any>(scopedRows.map((r:Any)=>[r.track_id,r]));
    const order=new Map<string,number>(scopedRows.map((r:Any,k:number)=>[r.track_id,k]));
    return rows.map((r:Any)=>{
      const scoped=metrics.get(r.tid);
      if(!scoped) return {...r,metric:'– lượt',listening:'–',timeFirst:false};
      const plays=scoped?.plays || 0;
      return {...r,periodPlays:plays,metric:`${vn(plays)} lượt`,listening:fmtH(scoped?.hours || 0),timeFirst:false};
    }).sort((a:Any,b:Any)=>(order.get(a.tid) ?? Infinity)-(order.get(b.tid) ?? Infinity));
  };
  const pastRows = (history?.rows || []).flatMap((r: Any) => {
    const rank = r.history?.find((p: Any) => p.period === month)?.rank;
    const before = r.history?.find((p: Any) => p.period === previous)?.rank;
    if (!(rank > 0 && rank <= 100 && before > rank)) return [];
    const points = (r.history || []).filter((p: Any) => {
      const label = /^T(\d{2})\/(\d{2})$/.exec(p.period);
      return label && `20${label[2]}-${label[1]}` <= end.slice(0, 7);
    });
    return [{ ...r, rank, previous: before, rise: before - rank, history: points }];
  });
  return [
    { scope: date.slice(0, 7), month: per(date.slice(0, 7)), rows: withPeriodMetrics(risingRows(D.hist, date, toSong, noop),D.risingCurrentOverview) },
    { scope: end.slice(0, 7), month, rows: withPeriodMetrics(risingRows({ asOf: end, periods: [previous], rows: pastRows }, end, toSong, noop),D.risingPreviousOverview) },
  ].filter(g => g.rows.length);
}

function releaseYearData(rows: Any[]) {
    const gt: Any = {};
    rows.forEach((r: Any) => { gt[r.genre] = (gt[r.genre] || 0) + (r.songs || 0); });
    const gl = Object.keys(gt).sort((a, b) => Number(a === "Khác") - Number(b === "Khác") || gt[b] - gt[a]);
    const ys = rows.map((r: Any) => r.year).filter((y: Any) => y != null), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const years = ys.length ? Array.from({ length: y1 - y0 + 1 }, (_, k) => y0 + k) : [];
    const series = gl.map((g, k) => ({ name: g === "Khác" ? "Khác" : cap1(g), color: g === "Khác" || k >= 8 ? "var(--text3)" : `var(--c${k + 1})`, vals: years.map((y) => rows.filter((r: Any) => r.year === y && r.genre === g).reduce((a: number, r: Any) => a + (r.songs || 0), 0)) }));
    const tot = years.map((_, k) => series.reduce((a, s) => a + s.vals[k], 0));
    return { years, series, tot, def: Math.max(0, tot.indexOf(Math.max(...tot))) };
}


function listeningCalendarDays(rows: Any[], scope: string, asOf: string) {
  const year = Number(/^\d{4}$/.test(scope) ? scope : asOf.slice(0, 4));
  if (!Number.isFinite(year)) return [];
  const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
  const byDate = new Map<string, number>();
  (rows || []).forEach((x: Any, index: number) => {
    const raw = x?.date ?? x?.k ?? x?.day;
    let date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
    if (!date && Number.isFinite(Number(raw))) {
      const n = Number(raw);
      const offset = n >= 1 && n <= 31 && rows.length <= 31 ? n - 1 : n;
      date = new Date(start + offset * 86400000).toISOString().slice(0, 10);
    } else if (!date && rows.length > index) date = new Date(start + index * 86400000).toISOString().slice(0, 10);
    const value = Number(x?.plays ?? x?.n ?? x?.value ?? x?.v ?? 0) || 0;
    if (date.slice(0,4) === String(year)) byDate.set(date, value);
  });
  const days: Any[] = [];
  for (let t = start; t < end; t += 86400000) {
    const d = new Date(t), date = d.toISOString().slice(0, 10), jan = new Date(start);
    const weekday = d.getUTCDay();
    const week = Math.floor((Math.floor((t - start) / 86400000) + jan.getUTCDay()) / 7);
    days.push({ date, label: date.slice(8,10) + '/' + date.slice(5,7), month: d.getUTCMonth(), week, weekday, value: byDate.get(date) || 0 });
  }
  return days;
}

function yearCalendarRows(D: Any, year: string) {
  const rows: Any[] = [];
  let loaded = false;
  for (let month = 1; month <= 12; month++) {
    const mm = pad(month), data = D['calendarMonth' + mm];
    if (!data?.byDay) continue;
    loaded = true;
    (data.byDay || []).forEach((x: Any, index: number) => {
      const raw = x?.date ?? x?.k ?? x?.day;
      const day = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? Number(raw.slice(8, 10)) : Number.isFinite(Number(raw)) ? (Number(raw) >= 1 ? Number(raw) : Number(raw) + 1) : index + 1;
      if (!Number.isFinite(day) || day < 1) return;
      rows.push({ date: `${year}-${mm}-${pad(day)}`, plays: Number(x?.plays ?? x?.n ?? x?.value ?? x?.v ?? 0) || 0 });
    });
  }
  return { rows, loaded };
}

const ARTIST_COUNTRIES: Record<string, {code:string; name:string}> = {
  'mono': {code:'JP', name:'Japan'}, 'aephanemer': {code:'FR', name:'France'}, 'wintersun': {code:'FI', name:'Finland'}, 'kalmah': {code:'FI', name:'Finland'}, 'nightwish': {code:'FI', name:'Finland'}, 'ensiferum': {code:'FI', name:'Finland'}, 'insomnium': {code:'FI', name:'Finland'}, 'omnium gatherum': {code:'FI', name:'Finland'},
  'no clear mind': {code:'GR', name:'Greece'}, 'i am no hero': {code:'GR', name:'Greece'}, 'tyr': {code:'FO', name:'Faroe Islands'}, 'týr': {code:'FO', name:'Faroe Islands'}, 'epica': {code:'NL', name:'Netherlands'}, 'shylmagoghnar': {code:'NL', name:'Netherlands'},
  'scorpions': {code:'DE', name:'Germany'}, 'helloween': {code:'DE', name:'Germany'}, 'dark tranquillity': {code:'SE', name:'Sweden'}, 'amon amarth': {code:'SE', name:'Sweden'}, 'in flames': {code:'SE', name:'Sweden'}, 'therion': {code:'SE', name:'Sweden'}, 'soilwork': {code:'SE', name:'Sweden'}, 'after earth': {code:'SE', name:'Sweden'},
  'metallica': {code:'US', name:'United States'}, 'buckethead': {code:'US', name:'United States'}, 'aether realm': {code:'US', name:'United States'}, 'æther realm': {code:'US', name:'United States'}, 'muse': {code:'GB', name:'United Kingdom'},
  'nguyễn hà': {code:'VN', name:'Vietnam'}, 'le cat trong ly': {code:'VN', name:'Vietnam'}, 'lê cát trọng lý': {code:'VN', name:'Vietnam'}, 'ludovico einaudi': {code:'IT', name:'Italy'}, 'atavistia': {code:'CA', name:'Canada'}, 'april rain': {code:'RU', name:'Russia'}
};
function artistCountryData(rows: Any[]) {
  const map = new Map<string, Any>();
  (rows || []).forEach((r: Any) => {
    const name = r.artist || r.name;
    const c = ARTIST_COUNTRIES[fold(name || '')];
    if (!c) return;
    const cur = map.get(c.code) || { ...c, value: 0, hours: 0, topArtist: '' };
    cur.value += 1; cur.hours += r.hours || 0;
    if (!cur.topArtist || (r.rank || Infinity) < (cur.topRank || Infinity)) { cur.topArtist = name; cur.topRank = r.rank; }
    map.set(c.code, cur);
  });
  return [...map.values()].sort((a, b) => b.value - a.value || b.hours - a.hours).slice(0, 24);
}

function mapServer(c: Ctx, D: Any) {
  const p = c.p, scr = c.screen, toSong = (id: string) => () => c.go("song", id), toArtist = (n: string) => () => c.go("artist", n), noop = () => {};
  const o: Any = { sampleChip: false }, asOf: string = (D.sum && D.sum.asOf) || vnToday();
  o.currentSongRankGeneration = D.currentSongRankGeneration;
  o.trendTabs = trendTabs(c, asOf);
  o.trendMonthChips = trendMonthPeriodChips(c, asOf);
  const risingKind = scr === "periodTop" ? topPeriod(c.id).kind : "";
  const filterAllTimeRise = !!risingKind && (risingKind === "albums" ? p.albumFilter : p.periodFilter) === "Đang lên";
  const riseRange = D.periodRiseWindow;
  const allTimeChanges = !filterAllTimeRise || !riseRange ? new Map<string, number>()
    : risingKind === "artists" || risingKind === "albums"
      ? allTimeRankChanges(D.periodATEnd?.rows || [], D.periodATBefore?.rows || [], r => risingKind === "artists" ? r.artist : r.album_artist + US + r.album)
      : songAllTimeChanges(D.periodATHistory, riseRange.before, riseRange.end);
  if (filterAllTimeRise) o.periodRisingNote = riseRange
    ? `Tăng hạng All time từ ${dmy(riseRange.before)} đến ${dmy(riseRange.end)} · có lượt nghe trong kỳ.`
    : "Chưa tải được hạng All time của kỳ so sánh.";
  if (scr === "album") {
    const identity=parseAlbumId(c.id);
    const release=identity ? findReleaseAlbum(identity.artist,identity.title) : undefined;
    o.album=albumView(c.id,D.albumTracks || D.metadataRows || [],D.albumStats || D.metadataStats,exportMetadata.items,D.currentAlbumRanks?.rows || [],D.aw,asOf,c.go)
      || (release ? releaseAlbumView(release,c.go) : identity ? catalogAlbumView(identity.artist,identity.title,c.go) : null);
    if(o.album && release) {
      if(!release.id.startsWith('playlist-recommend:') && !release.id.startsWith('saved:'))o.album.releaseId=release.id;
      o.album.img ||= release.cover;
    }
    const history = D.albumRankHistory?.rows || [];
    if (o.album && history.length) {
      const values = history.map((row: Any) => Number(row.hours) || 0);
      const ranks = history.map((row: Any) => Number.isInteger(row.rank) && row.rank > 0 ? row.rank : null);
      const labels = history.map((row: Any) => mlab(String(row.period).slice(0, 7)));
      const savedSelection = Number(p.sel?.alh);
      const selected = Math.min(Number.isInteger(savedSelection) && savedSelection >= 0 ? savedSelection : history.length - 1, history.length - 1);
      const rank = ranks[selected];
      o.ch = { ...(o.ch || {}), alh: songHistoryChart(values, ranks, labels, {
        ...(DESKTOP_WEB ? { w: 1100, h: 250 } : {}),
        primaryLabel: o.album.title,
        valueFormatter: (value: number) => `${Math.round(value)}h`,
        rankThreshold: 50,
        ariaLabel: `Giờ nghe và lịch sử hạng theo tháng của ${o.album.title}`,
        currentRank: D.albumRankHistory.currentRank ?? o.album.rank,
        sel: selected,
        onSel: (index: number) => c.set((q) => ({ sel: { ...q.sel, alh: index } })),
      }) };
      o.rd = { ...(o.rd || {}), alh: `T${labels[selected]} · ${fmtH(values[selected])} · ${rank == null ? "chưa có hạng" : "hạng #" + rank}` };
      o.periodOptions = { ...(o.periodOptions || {}), alh: labels.map((label: string, index: number) => ({ label: `T${label}`, period: `20${label.slice(3, 5)}-${label.slice(0, 2)}`, index })) };
    }
  }
  if (scr === "today" || scr === "playlist" || scr === "playlists" || scr === "topPlaylists") {
    const stats=new Map((D.metadataStats?.rows||[]).map((r:Any)=>[r.track_id,r.plays]));
    o.playlistLibrary = D.metadataRows?.map((r:Any)=>({...r,allPlays:stats.get(r.id)}));
    o.playlistArtwork = D.aw?.tracks || {};
  }
  if (scr === "today" || scr === "recent") {
    const recentRanks = new Map((D.currentSongRanks?.rows || []).map((r: Any) => [r.track_id, r.rank]));
    o.recent = D.recent.rows.map((r: Any) => { const t = r.track_title ?? r.title, a = r.track_artist ?? r.artist; return { title: t, artist: a, album: r.album, rank: r.track_id ? recentRanks.get(r.track_id) : undefined, time: `${pad(r.hour)}:${pad(r.minute)}`, date: weekdayDate(r.play_date), unmatched: !r.track_id, tid: r.track_id, ini: ini(a || t), onTap: r.track_id ? toSong(r.track_id) : noop }; });
  }
  if (scr === "today") {
    const s = D.sum, A = ymd(asOf);
    const card = (x: Any, w: string, progressWord: string) => {
      const cc = pctTxt(x.change, w);
      const progress = pctTxt(x.progressChange, progressWord);
      return {
        plays: vn(x.plays),
        sub: `${vn(x.tracks)} bài · ${vn(x.artists)} nghệ sĩ`,
        chg: cc.t,
        col: cc.col,
        progressChg: progress.t,
        progressCol: x.progressChange < 0 ? "var(--accent)" : x.progressChange >= 100 ? "var(--up)" : x.progressChange > 0 ? "var(--c2)" : "var(--text3)",
      };
    };
    o.dateLabel = `${DOWF[dow(asOf)]}, ${A.d} tháng ${A.m}`;
    const weekStart = addDays(asOf,-((dow(asOf)+6)%7));
    o.weekTitle = `Tuần này (${dm(weekStart)}–${dm(addDays(weekStart,6))})`;
    o.wk = card(s.week, "tuần trước", "cùng kỳ");
    o.mo = card(s.month, "tháng trước", "cùng kỳ");
    o.yr = { label: "Năm " + A.y, plays: vn(s.year.plays), sub: `${vn(s.year.tracks)} bài · ${vn(s.year.artists)} nghệ sĩ`, prev: `Năm trước ${vn(s.year.previousPlays ?? 0)} lượt` };
    o.totalLine = `Tổng ${vn(s.total.plays)} lượt · ${vn(s.total.songs)} bài trong thư viện · ${vn(s.total.artists)} nghệ sĩ`;
    // Đầu tháng chưa có lượt nghe: không so % với cả tháng trước (luôn ra ▼100%).
    if (!s.month.plays) o.mo = { ...o.mo, chg: "Chưa có lượt nghe trong tháng", col: "var(--text3)" };
    const days = D.daily.days.map((d: Any) => ({ l: DOWS[dow(d.date)], full: `${DOWF[dow(d.date)]} ${dm(d.date)}`, v: [d.average ?? null, d.lastWeek || 0, d.future ? null : d.plays || 0], future: d.future }));
    let def = days.length - 1;
    while (def > 0 && days[def].future) def--;
    Object.assign(o, charts(c, null, null, { week: { def, days }, weekHours: Array.isArray(D.weekHours.byHour) ? arrOf(D.weekHours.byHour, 24, x => x.k) : null }));

    const currentArtistRanks = new Map<string, number>((D.todayArtistRanks?.rows || []).map((r: Any) => [fold(r.artist), Number(r.rank)]));
    const previousArtistRanks = new Map<string, number>((D.todayArtistRanksBefore?.rows || []).map((r: Any) => [fold(r.artist), Number(r.rank)]));
    o.weekTable = (DESKTOP_WEB ? [...D.wart.rows].sort((a: Any,b: Any)=>b.plays-a.plays).slice(0,5) : D.wart.rows).map((r: Any) => {
      const rank = currentArtistRanks.get(fold(r.artist));
      const previous = previousArtistRanks.get(fold(r.artist));
      return { name: r.artist, an: r.artist, ini: ini(r.artist), ...NOFL, total: vn(r.plays), rank, rankChange: rank && previous ? previous - rank : null,
        cells: Array.from({ length: 7 }, (_, k) => { const v = (r.byDay || [])[k]; return { v: v == null ? "·" : v || "–", s: { color: v ? "var(--text)" : "var(--text3)", fontWeight: v ? 600 : 400 } }; }) };
    });
    const artistCounts = new Map<string, number>();
    const rolling = (D.rollingSongs?.rows || []).filter((r: Any) => {
      const key = fold(r.artist || "");
      const count = artistCounts.get(key) || 0;
      if (count >= 3) return false;
      artistCounts.set(key, count + 1);
      return true;
    }).slice(0, 5);
    o.top5Prev = false;
    o.top5Title = "Top songs · 15 ngày";
    o.viewTodaySongs = () => c.go("periodTop", `songs~15d~${asOf}`, { periodFilter: "Tất cả", songView: "Danh sách" });
    o.top5Note = ""; o.top5Sub = "";
    o.todayPlaylistRows = D.rollingSongs?.rows || [];
    o.top5 = rolling.map((r: Any) => ({ tid: r.track_id, rank: r.rank, title: r.title, artist: r.artist || "Chưa rõ nghệ sĩ", ini: ini(r.title), ...NOFL, chg: chgEl(chgOf(r)), spark: null, periodPlays: r.plays, listening: "–", metric: vn(r.plays) + " lượt", onTap: r.track_id ? toSong(r.track_id) : noop }));
  }
  if (scr === "top100") {
    const limit=songAllTimeLimit(p.periodListSize);
    const H = D.hist, periods = H.periods || [];
    const currentAsOf = D.sum?.asOf || H.asOf || asOf;
    const selectedSongAsOf = songRankAsOf(p, currentAsOf);
    const selectedYm = selectedSongAsOf.slice(0, 7);
    const showSongMonthChanges = selectedYm < currentAsOf.slice(0, 7);
    const selectedPeriod = per(selectedYm), previousPeriod = per(prevYm(selectedYm));
    const historyRank = (r: Any, period: string) => (r.history || []).find((point: Any) => per(point.period) === period)?.rank;
    const sourceRows = showSongMonthChanges
      ? (H.rows || []).flatMap((r: Any) => {
        const rank = historyRank(r, selectedPeriod);
        if (!(Number.isInteger(rank) && rank > 0 && rank <= 100)) return [];
        const previous = historyRank(r, previousPeriod);
        return [{ ...r, rank, previous: Number.isInteger(previous) && previous > 0 ? previous : null }];
      }).sort((a: Any, b: Any) => a.rank - b.rank)
      : (H.rows || []).filter((r: Any) => r.rank >= 1 && r.rank <= 100).sort((a: Any, b: Any) => a.rank - b.rank);
    const rowDelta = (r: Any) => showSongMonthChanges && r.previous != null ? r.previous - r.rank : 0;
    o.songRankMonthChips = songRankPeriodChips(p, currentAsOf, (value) => c.set(() => ({ songRankAsOf: value })));
    o.songFilterNote = p.filter === "Mới vào" ? `Từ hạng ngoài Top ${limit} ở ${previousPeriod} lên Top ${limit} ${selectedPeriod}.` : "";
    o.t100Head = showSongMonthChanges ? `Hạng ${selectedPeriod} so với chốt ${previousPeriod}` : "Tháng hiện tại mới bắt đầu · chưa tính tăng/giảm so với tháng trước";
    o.top100Rows = sourceRows.filter((r: Any) => p.filter === "Tất cả" || (showSongMonthChanges && (p.filter === "Đang lên" ? rowDelta(r) > 0 : (r.previous == null || r.previous > limit) && r.rank <= limit))).map((r: Any) => {
      const delta = rowDelta(r);
      return { tid: r.track_id, rank: r.rank, metric: `${vn(r.plays)} lượt`, listening: fmtMin(r.minutes || 0), timeFirst: true, chg: chgEl(!showSongMonthChanges || r.previous == null ? null : delta), title: r.title, artist: r.artist || "Chưa rõ nghệ sĩ", lv: "lv" + (r.level ?? "–"),
        rankTrendClass: delta > 0 ? "rank-trend-up" : delta < 0 ? "rank-trend-down" : "", hideRankProgress: !showSongMonthChanges || (showSongMonthChanges && r.previous === r.rank),
        ...(showSongMonthChanges && r.previous !== r.rank ? { monthRankPrevious: r.previous, monthRankCurrent: r.rank, monthRankPreviousPeriod: previousPeriod, monthRankCurrentPeriod: selectedPeriod } : {}),
        peak: r.best ? `Cao nhất #${r.best.rank} · ${per(r.best.period)}` : "Cao nhất –", months: `${r.monthsInTop100 ?? 0} tháng trong top 100`, spark: sparkGap(songRankTimeline(r.history || [], showSongMonthChanges ? selectedSongAsOf : H.asOf || asOf, r.rank).ranks, { w: 54, h: 26, full: true, trimLeading: true, color: "var(--song-history-rank)" }), onTap: r.track_id ? toSong(r.track_id) : noop };
    });
  }
  if (scr === "artistsAll") {
    const limit=artistAllTimeLimit(p.periodListSize);
    const currentAsOf = D.sum?.asOf || asOf;
    const selectedArtistAsOf = artistRankAsOf(p, currentAsOf);
    o.artistRankMonthChips = artistRankPeriodChips(p, currentAsOf, (value) => c.set(() => ({ artistRankAsOf: value })));
    o.artistRankPeriodNote = selectedArtistAsOf.slice(0, 7) === currentAsOf.slice(0, 7) ? "Đang hiển thị dữ liệu hiện tại." : `Xếp hạng tính đến ${dmy(selectedArtistAsOf)}.`;
    const pts = p.sort === "Điểm";
    const nmap: Any = {};
    ((D.atc && D.atc.rows) || []).forEach((r: Any) => { nmap[r.artist] = r.tracks; });
    const artistBadgeBest = new Map<string,{rank:number;period:string}>();
    for (const row of D.ahist?.rows || []) {
      const candidates=[row.best,...(row.history || [])].filter((point:Any)=>point && Number.isInteger(point.rank) && point.rank>0 && typeof point.period==='string' && point.period);
      const best=candidates.reduce((best:Any,point:Any)=>!best || point.rank<best.rank ? point : best,null);
      if(best)artistBadgeBest.set(row.artist,{rank:best.rank,period:per(best.period)});
    }
    const artistRankValue = (r: Any, k: number) => pts ? r.pointsRank ?? r.rank : p.sort === "Lượt" ? k + 1 : r.rank;
    const currentArtistRanks = new Map<string,number>((D.currentArtistRanks?.rows || []).filter((r:Any)=>!pts || r.points!=null).map((r:Any,k:number)=>[r.artist,artistRankValue(r,k)]));
    o.artistRows = D.aat.rows.filter((r: Any) => !pts || r.points != null).map((r: Any, k: number) => {
      const rank = artistRankValue(r,k);
      const badgeRank = currentArtistRanks.get(r.artist);
      const badgeBest = artistBadgeBest.get(r.artist);
      const badgeChange = badgeRank != null && badgeBest && badgeBest.rank !== badgeRank ? badgeBest.rank - badgeRank : undefined;
      return { an: r.artist, rank, allTimeRank: badgeRank, allTimeChange: badgeChange, allTimeComparison: badgeChange == null ? undefined : badgeBest?.period, name: r.artist, ini: ini(r.artist), ...flOf(r.flag),
      listenedTracks: nmap[r.artist], lastPlayed: shortDate(r.lastPlayed),
      sub: (nmap[r.artist] != null ? vn(nmap[r.artist]) + " bài · " : "") + "nghe lần cuối " + shortDate(r.lastPlayed),
      big: pts ? d1(r.points) : p.sort === "Lượt" ? vn(r.plays) + " lượt" : fmtH(r.hours || 0), small: pts ? `${fmtH(r.hours || 0)} · ${vn(r.plays)} lượt` : p.sort === "Lượt" ? fmtH(r.hours || 0) : vn(r.plays) + " lượt", onTap: toArtist(r.artist) };
    });
    if(["Đang lên","Mới vào"].includes(p.artistFilter) && p.sort !== "Lịch sử"){
      const prev=comparisonPeriod("all",selectedArtistAsOf);
      const ranks=new Map<string,number>((D.previousArtists?.rows || []).filter((r:Any)=>!pts || r.points!=null).map((r:Any,k:number)=>[r.artist,pts?r.pointsRank ?? r.rank:p.sort === "Lượt"?k+1:r.rank]));
      const newcomers=p.artistFilter === "Mới vào";
      o.artistRows=o.artistRows.map((r:Any)=>({...r,change:ranks.has(r.an)?ranks.get(r.an)!-r.rank:0}))
        .filter((r:Any)=>newcomers ? r.rank<=limit && !ranks.has(r.an) : r.change>0)
        .map((r:Any)=>({...r,chg:chgEl(newcomers ? "new" : r.change)}));
      o.artistFilterNote=newcomers ? `Mới vào Top ${limit} theo ${p.sort.toLowerCase()} so với ${prev.label}.` : `Tăng hạng Top ${limit} theo ${p.sort.toLowerCase()} so với ${prev.label}.`;
    }
  }
  if (scr === "trend") {
    const H = D.hist, periods = H.periods || [], groups = risingSongGroups(D, asOf, toSong, noop);
    const trendAsOf=H.asOf || asOf;

    const openRisingMonth=(kind:'artists'|'songs',scope:string)=>scope ? ()=>{
      const end=allTimeRiseWindow(scope,trendAsOf).end;
      c.go("periodTop",`${kind}~${scope}~${end}`,{periodFilter:"Đang lên",periodSort:"Lượt",songView:"Danh sách"});
    } : undefined;
    o.risingGroups = groups.map(g => ({ ...g, rows: g.rows.slice(0, 10), onViewAll:openRisingMonth('songs',g.scope) }));
    o.rising = o.risingGroups.flatMap((g: Any) => g.rows);
    o.risingCount = groups.reduce((n, g) => n + g.rows.length, 0); o.risingMore = o.risingCount > 0;
    const AH_ = D.ahist, ap = AH_.periods || [];
    // Nhóm theo tháng từ rising[]; bỏ nhóm rỗng. Server cũ chưa có rising[] thì tự tính từ rows.
    o.risingArtists = Array.isArray(AH_.rising)
      ? AH_.rising.filter((g: Any) => (g.rows || []).length).map((g: Any) => ({ month: per(g.period), onViewAll:openRisingMonth('artists',scopeFromPeriod(g.period)), rows: g.rows.slice().sort(byCurrentRank).map((r: Any) => ({ an: r.artist, name: r.artist, ini: ini(r.artist), ...NOFL,
          sub: `${vn(r.monthPlays || 0)}x · ${fmtH(r.monthHours || 0)}`, rise: r.previous == null ? null : r.previous - r.rank, ranks: `#${r.previous ?? "–"} → #${r.rank}`, onTap: toArtist(r.artist) })) }))
      : [{ month: per(ap[ap.length - 1]), onViewAll:openRisingMonth('artists',scopeFromPeriod(ap[ap.length - 1])), rows: AH_.rows.filter((r: Any) => (r.rise || 0) > 0).sort(byCurrentRank).slice(0, 6).map((r: Any) => ({ an: r.artist, name: r.artist, ini: ini(r.artist), ...NOFL, sub: `${fmtH(r.hours || 0)} All time`, ranks: `#${r.previous} → #${r.rank}`, onTap: toArtist(r.artist) })) }];
    const p12 = periods.filter((period: string) => scopeFromPeriod(period) >= "2024-05");
    o.bumpEl = bump(H.rows.slice(0, 10).map((r: Any, k: number) => ({ name: r.title, ranks: p12.map((pp: string) => { const e = (r.history || []).find((x: Any) => x.period === pp); return Math.min(11, e ? e.rank : 11); }), color: k < 8 ? `var(--c${k + 1})` : "var(--text3)" })), p12.map(mlab));
  }
  if (scr === "periodTop" && topPeriod(c.id).kind !== "albums") {
    const t = periodSelection(c), artists = t.kind === "artists";
    const listOnly = t.kind === "songs" && t.scope === "15d";
    o.topPeriodTitle = periodTopTitle(c.id, c.p.periodFilter);
    o.periodNewOnly = t.newOnly;
    const setPeriodFilter = (value: string) => c.set(() => ({ periodFilter: value, songView: "Danh sách", ...(p.periodSort === "Lịch sử" ? { periodSort: "Giờ nghe" as const } : {}) }));
    o.periodFilterChips = chips(t.canNew ? ["Tất cả", "Mới vào", "Mới thêm"] : ["Tất cả", "Mới vào"], p.periodFilter, setPeriodFilter);
    o.periodSortChips = chips(["Giờ nghe", "Lượt", "Tăng hạng", "Mới vào", ...(t.canNew ? ["Mới thêm"] : []), "Lịch sử"],
      p.periodSort === "Lịch sử" ? "Lịch sử" : filterAllTimeRise ? "Tăng hạng" : p.periodFilter !== "Tất cả" ? p.periodFilter : p.periodSort === "Điểm All time" ? "Lượt" : p.periodSort, value => {
      if (value === "Tăng hạng") return setPeriodFilter("Đang lên");
      if (value === "Mới vào" || value === "Mới thêm") return setPeriodFilter(value);
      c.set(() => ({ periodSort: value as UI["periodSort"], periodFilter: "Tất cả" }));
    });
    o.songViewTabs = chips(listOnly ? ["Danh sách"] : ["Danh sách", "Tăng hạng", "Mới vào", ...(t.canNew ? ["Mới thêm"] : []), "Lịch sử"],
      p.songView === "Lịch sử" ? "Lịch sử" : filterAllTimeRise ? "Tăng hạng" : p.periodFilter === "Tất cả" ? "Danh sách" : p.periodFilter, value => {
      if (value === "Tăng hạng") return setPeriodFilter("Đang lên");
      if (value === "Mới vào" || value === "Mới thêm") return setPeriodFilter(value);
      c.set(() => ({ songView: value as UI["songView"], periodFilter: "Tất cả" }));
    });
    o.periodListOnly = listOnly;
    o.periodIsArtists = artists;
    o.periodIsHistory = !listOnly && !t.newOnly && (artists ? p.periodSort === "Lịch sử" : p.songView === "Lịch sử");
    const rows = t.newOnly ? (artists ? D.additions.artists : D.additions.songs) : t.kind === "monthSongs" ? D.periodSongs.rows : artists ? D.ov.artists : D.ov.songs;
    o.periodEmpty = rows.length ? "Không có kết quả cho bộ lọc này." : "Chưa có lượt nghe trong giai đoạn này.";
    if (artists) {
      const meta = new Map<string, Any>((D.metaArtists?.rows || []).map((r: Any) => [r.artist, r]));
      const previousAllTime = new Map<string,number>((D.periodATBefore?.rows || []).map((r:Any)=>[r.artist,r.rank]));
      const currentAllTime = new Map<string,number>((D.periodATEnd?.rows || []).map((r:Any)=>[r.artist,r.rank]));
      const plays = p.periodSort === "Lượt" || p.periodSort === "Điểm All time";
      const sorted = rows.map((r: Any, k: number) => ({ ...r, periodRank: r.rank ?? k + 1, meta: meta.get(r.name) }));
      if (plays) sorted.sort((a: Any, b: Any) => b.plays - a.plays || b.hours - a.hours || a.periodRank - b.periodRank);
      const previousRows = (D.prevOv?.artists || []).map((r: Any, k: number) => ({ ...r, periodRank: r.rank ?? k + 1 }));
      if (plays) previousRows.sort((a: Any, b: Any) => b.plays - a.plays || b.hours - a.hours || a.periodRank - b.periodRank);
      const previous = new Map<string, number>(previousRows.map((r: Any, k: number) => [r.name, plays ? k + 1 : r.periodRank]));
      const changeFor = (r: Any, k: number) => filterAllTimeRise ? allTimeChanges.get(r.name) ?? null : !D.prevOv ? null : !previous.has(r.name) ? "new" : previous.get(r.name)! - (plays ? k + 1 : r.periodRank);
      o.periodRows = sorted.map((r: Any, k: number) => ({
        an: r.name, rank: plays ? k + 1 : r.periodRank, title: r.name, name: r.name, ini: ini(r.name), ...flOf(r.meta?.flag),
        change: changeFor(r, k), chg: !t.newOnly && p.periodFilter === "Đang lên" ? chgEl(changeFor(r, k) ?? 0) : null,
        ranks: filterAllTimeRise ? `#${previousAllTime.get(r.name) ?? "–"} → #${currentAllTime.get(r.name) ?? "–"}` : "",
        rise: filterAllTimeRise ? changeFor(r,k) : null,
        listenedTracks: t.newOnly ? undefined : (r.tracks || 0), lastPlayed: r.meta ? shortDate(r.meta.lastPlayed) : "–",
        sub: `${t.newOnly ? `Thêm ${dmy(r.added)} · ` : ""}${vn(r.tracks || 0)} bài${t.newOnly ? " trong thư viện" : " trong kỳ"} · nghe lần cuối ${r.meta ? shortDate(r.meta.lastPlayed) : "–"}`,
        big: plays ? `${vn(r.plays)} lượt` : fmtH(r.hours || 0),
        small: plays ? fmtH(r.hours || 0) : `${vn(r.plays)} lượt`,
        onTap: toArtist(r.name),
      })).filter((r: Any) => t.newOnly || p.periodFilter === "Tất cả" || (p.periodFilter === "Đang lên" ? typeof r.change === "number" && r.change > 0 : r.change === "new"));
      if(filterAllTimeRise) {
        o.periodRows.sort((a:Any,b:Any)=>(currentAllTime.get(a.name) ?? Infinity)-(currentAllTime.get(b.name) ?? Infinity));
        o.periodRows.forEach((r:Any)=>{const source=rows.find((x:Any)=>x.name===r.name);r.sub=`${vn(source?.plays || 0)}x · ${fmtH(source?.hours || 0)}`;});
        o.periodRisingGroups=o.periodRows.length?[{month:/^\d{4}-\d{2}$/.test(t.scope)?per(t.scope):t.label,rows:o.periodRows}]:[];
      }
      o.periodNote = "Số bài, lượt và giờ nghe thuộc kỳ đang xem. Dấu * / !!! và lần nghe cuối theo dữ liệu All time.";
      o.periodNote += filterAllTimeRise ? ` ${o.periodRisingNote}` : ` Thay đổi hạng ${plays ? "theo lượt" : "theo giờ nghe"} so với ${comparisonPeriod(t.scope, t.asOf).label.toLowerCase()}.`;
      if (!D.metaArtists) o.periodNote += " Thông tin All time chưa tải được.";
    } else {
      const prev = comparisonPeriod(t.scope, t.asOf);
      const previous = new Map<string, number>((D.prevOv?.songs || []).map((r: Any, k: number) => [r.track_id, r.rank ?? k + 1]));
      const histories = new Map<string, Any>((D.hist?.rows || []).map((r: Any) => [r.track_id, r]));
      const periods = D.hist?.periods || [];
      const comparisons = filterAllTimeRise && riseRange ? songAllTimeComparisons(D.periodATHistory, riseRange.before, riseRange.end) : new Map();
      o.periodRows = rows.map((r: Any, k: number) => {
        const rank = r.rank ?? k + 1, known = t.kind === "monthSongs" ? r.previous !== undefined : !!D.prevOv;
        const old = t.kind === "monthSongs" ? r.previous : previous.get(r.track_id) ?? null;
        const change = filterAllTimeRise ? allTimeChanges.get(r.track_id) ?? null : !known ? null : old === null ? "new" : old - rank;
        const history = histories.get(r.track_id);
        const comparison = comparisons.get(r.track_id);
        return { tid: r.track_id, rank, title: r.title, artist: r.artist || "Chưa rõ nghệ sĩ", change,
          ...(comparison ? { risingPreviousRank: comparison.previous, risingRank: comparison.current, risingGain: comparison.change, risingPreviousPeriod: per(riseRange.before.slice(0,7)) } : {}),
          added: t.newOnly ? `Thêm vào thư viện ${dmy(r.added)}` : "",
          periodPlays:r.plays, listening:r.hours!=null?fmtH(r.hours):r.minutes!=null?fmtMin(r.minutes):"–", timeFirst:t.scope==='all', chg: t.newOnly || change === null ? "–" : chgEl(change), metric: `${vn(r.plays)} lượt`,
          peak: history?.best ? `Cao nhất #${history.best.rank} · ${per(history.best.period)} (All time)` : D.hist ? "Chưa có lịch sử All time để hiển thị" : "Chưa tải được lịch sử All time",
          months: history ? `${history.monthsInTop100 ?? 0} tháng trong top 100` : "",
          spark: comparison ? sparkGap(songRankTimeline(comparison.history, riseRange.end, comparison.current).ranks, { w: 54, h: 26, full: true, trimLeading: true, color: "var(--song-history-rank)" }) : history && history.history?.length ? sparkGap(histVals(history.history, periods), { w: 60, h: 22, color: "var(--song-history-rank)" }) : null,
          sparkLabel: history?.history?.length ? `${periods.length} tháng · AT` : "",
          onTap: r.track_id ? toSong(r.track_id) : noop,
        };
      }).filter((r: Any) => t.newOnly || p.periodFilter === "Tất cả" || (p.periodFilter === "Đang lên" ? typeof r.change === "number" && r.change > 0 && (!filterAllTimeRise || (r.risingRank ?? Infinity) <= 100) : r.change === "new"));
      o.periodNote = `Số trên cover là hạng All time hiện tại. Lượt nghe và tăng/giảm hạng thuộc kỳ đang xem; so với ${prev.label.toLowerCase()}. Đường biểu diễn và thành tích top 100 theo All time.`;
      if (filterAllTimeRise) o.periodNote = o.periodRisingNote;
      if (t.kind !== "monthSongs" && !D.prevOv) o.periodNote += " Chưa tải được kỳ so sánh.";
    }
    if (t.newOnly) {
      o.periodNote = `${artists ? "Nghệ sĩ có bài đầu tiên được thêm vào thư viện" : "Bài hát được thêm vào thư viện"} trong ${t.label.toLowerCase()}. ${artists ? "Hạng tính riêng nhóm mới thêm" : "Số trên cover là hạng All time hiện tại"}; lượt và giờ nghe thuộc kỳ này.`;
      o.periodEmpty = `Chưa có ${artists ? "nghệ sĩ" : "bài hát"} mới thêm trong kỳ này.`;
    }
  }
  if (scr === "periodTop" && topPeriod(c.id).kind !== "albums") {
    const H = D.rankHistory, rows = o.periodRows.filter((r: Any) => r.rank <= 25).slice(0, 25);
    o.rankHistoryTitle = `Top ${rows.length} ${o.periodIsArtists ? "nghệ sĩ" : "bài hát"} · lịch sử thứ hạng`;
    o.rankHistoryNote = H ? `Hạng cộng dồn trong kỳ theo ${H.daily ? "ngày" : "tháng"}. Top 25 ${o.periodIsArtists ? "nghệ sĩ theo giờ nghe" : "bài hát"}; khoảng trống: chưa có hạng hoặc thấp hơn hạng cuối danh sách.` : D.rankHistorySt === "err" ? "Chưa tải được lịch sử thứ hạng." : "Đang tải lịch sử thứ hạng…";
    if (H && rows.length && H.dates?.length) {
      const histories = new Map<string, Any>((H.rows || []).map((r: Any) => [r.id, r]));
      const series = rows.map((r: Any, k: number) => ({ name: r.name || r.title,
        ranks: H.dates.map((_: string, i: number) => i === H.dates.length - 1 ? r.rank : histories.get(r.an || r.tid)?.ranks?.[i] ?? null),
        color: `hsl(${(k * 137.508) % 360} 55% 40%)`,
      }));
      const maxRank = Math.max(1, ...rows.map((r: Any) => Number(r.rank) || 1));
      o.rankHistoryChart = bump(series, H.dates.map((d: string) => H.daily ? d.slice(8) : `${d.slice(5, 7)}/${d.slice(2, 4)}`), { maxRank, height: Math.max(250, maxRank * 22 + 30) });
    } else if (H) o.rankHistoryNote = "Chưa có dữ liệu thứ hạng trong kỳ này.";
  }
  if(scr === "periodTop" && topPeriod(c.id).kind === "albums") {
    const t=topPeriod(c.id);
    o.albumSortChips = chips(["Giờ nghe", "Lượt", "Tăng hạng", "Mới vào", "Lịch sử"],
      p.albumSort === "Lịch sử" ? "Lịch sử" : filterAllTimeRise ? "Tăng hạng" : p.albumFilter === "Mới vào" ? "Mới vào" : p.albumSort, value => {
      if (value === "Tăng hạng" || value === "Mới vào") return c.set(() => ({ albumFilter: value === "Tăng hạng" ? "Đang lên" : value, ...(p.albumSort === "Lịch sử" ? { albumSort: "Giờ nghe" as const } : {}) }));
      c.set(() => ({ albumSort: value as UI["albumSort"], albumFilter: "Tất cả" }));
    });
    o.albumFilterChips = chips(["Tất cả", "Mới vào"], p.albumFilter, value => c.set(() => ({ albumFilter: value })));
    o.periodIsAlbums=true;o.periodAllTime=t.scope==='all';o.albumIsHistory=p.albumSort==='Lịch sử';
    const currentAsOf = D.sum?.asOf || asOf;
    const selectedAlbumAsOf = o.periodAllTime ? albumRankAsOf(p,currentAsOf) : t.asOf;
    if(o.periodAllTime){
      o.albumRankMonthChips=albumRankPeriodChips(p,currentAsOf,(value)=>c.set(()=>({albumRankAsOf:value})));
      o.albumRankPeriodNote=selectedAlbumAsOf.slice(0,7)===currentAsOf.slice(0,7)?"Đang hiển thị dữ liệu hiện tại.":`Xếp hạng tính đến ${dmy(selectedAlbumAsOf)}.`;
    }
    const sort=p.albumSort==='Lượt'?'Lượt':'Giờ nghe',limit=o.periodAllTime?albumAllTimeLimit(p.periodListSize):listDisplayLimit(o.periodAllTime,p.periodListSize);
    o.topPeriodTitle=periodTopTitle(c.id, c.p.periodFilter);
    o.periodNote=o.periodAllTime && sort!=="Lượt" ? "Điểm = giờ nghe × √(min(số bài, 12) / 12). Level chỉ dùng để kiểm tra đủ điều kiện." : `Xếp theo ${sort.toLowerCase()} trong kỳ.`;
    const current=rankedAlbums(D.albumPlays?.rows || [],D.metadataRows || [],sort,o.periodAllTime).slice(0,limit);
    const previous=rankedAlbums(D.previousAlbums?.rows || [],D.metadataRows || [],sort,o.periodAllTime);
    const ranks=new Map(previous.map(r=>[r.key,r.rank]));
    const albumBadgeHistory = o.periodAllTime && sort !== 'Lượt'
      ? (D.albumHistoryDates || []).flatMap((date:string) => rankedAlbums(D['albumHistory'+date]?.rows || [], D.metadataRows || [], sort, true).map((r:any) => ({ key: r.key, rank: r.rank, period: per(date.slice(0,7)) })))
      : [];
    const albumBadgeBest = new Map<string,{rank:number;period:string}>();
    for (const point of albumBadgeHistory) {
      if (!Number.isInteger(point.rank) || point.rank <= 0) continue;
      const best = albumBadgeBest.get(point.key);
      if (!best || point.rank < best.rank) albumBadgeBest.set(point.key, { rank: point.rank, period: point.period });
    }
    o.albums=current.map((a:Any)=>{
      const badgeBest = albumBadgeBest.get(a.key);
      const badgeChange = badgeBest && badgeBest.rank !== a.rank ? badgeBest.rank - a.rank : undefined;
      return {ak:a.key,rank:a.rank,title:a.name,artist:a.artist,ini:ini(a.name),plays:sort==='Lượt'?fmtH(a.hours):`${vn(a.plays)} lượt`,listened:a.tracks,v:sort==='Lượt'?`${vn(a.plays)} lượt`:fmtH(a.hours),
      allTimeChange: badgeChange, allTimeComparison: badgeChange == null ? undefined : badgeBest?.period,
      change:filterAllTimeRise ? allTimeChanges.get(a.key) ?? null : rankChange(ranks.get(a.key),a.rank,limit),onTap:()=>c.go('album',albumId(a.artist,a.name))};
    });
    if(!o.albumIsHistory && p.albumFilter && p.albumFilter!=='Tất cả'){
      o.albums=o.albums.filter((r:Any)=>p.albumFilter==='Đang lên'?typeof r.change==='number'&&r.change>0:r.change==='new').map((r:Any)=>({...r,chg:chgEl(r.change)}));
      o.periodNote+=filterAllTimeRise ? ` ${o.periodRisingNote}` : ` So với ${comparisonPeriod(t.scope,t.asOf).label}.`;
    }
    if(o.albumIsHistory){
      const dates=D.albumHistoryDates || [];
      const snapshots=dates.map((date:string)=>new Map(rankedAlbums(D['albumHistory'+date]?.rows || [],D.metadataRows || [],sort,o.periodAllTime).map(r=>[r.key,r.rank])));
      const series=current.map((r:Any,k:number)=>({name:r.name+' · '+r.artist,ranks:snapshots.map((ranks:Map<string,number>)=>ranks.get(r.key) ?? null).concat([r.rank]),color:`hsl(${(k*137.508)%360} 55% 40%)`}));
      o.rankHistoryTitle=`Top ${current.length} Albums · lịch sử thứ hạng`;
      o.rankHistoryNote=o.periodAllTime ? 'Hạng theo giờ nghe và lợi thế số bài, tối đa ở 12 bài. Level chỉ kiểm tra đủ điều kiện. Khoảng trống: chưa đủ điều kiện xếp hạng hoặc ngoài phạm vi biểu đồ.' : 'Hạng theo giờ nghe cộng dồn trong kỳ, tính từ lượt nghe và dữ liệu bài hát hiện có. Khoảng trống: chưa có lượt nghe hoặc ngoài phạm vi biểu đồ.';
      o.rankHistoryChart=series.length?bump(series,dates.map((date:string)=>/^\d{4}-\d{2}$/.test(t.scope)?dm(date):`${date.slice(5,7)}/${date.slice(2,4)}`).concat(['Hiện tại']),{maxRank:current.length,height:Math.max(250,current.length*22+30)}):null;
      if(!series.length)o.rankHistoryNote='Chưa có dữ liệu lịch sử album trong kỳ này.';
    }
  }

  if (scr === "top100" || scr === "artistsAll") {
    const artists = scr === "artistsAll", H = artists ? D.ahist : D.hist;
    const artistHistory = new Map<string, Any>((H?.rows || []).map((r: Any) => [r.artist, r]));
    // Follow the hours list exactly, including artists with no historical checkpoints yet.
    const rows = artists ? (D.aat.rows || []).map((r: Any) => ({ ...r, history: artistHistory.get(r.artist)?.history || [] })) : (H?.rows || []).filter((r: Any) => r.rank >= 1 && r.rank <= 100);
    o.rankHistoryTitle = artists ? `${rows.length} nghệ sĩ · lịch sử All time` : `${rows.length} bài hát · lịch sử All time`;
    o.rankHistoryNote = artists ? "Cùng danh sách nghệ sĩ với tab Giờ nghe. Tháng thiếu dữ liệu giữ hạng gần nhất trước đó; trước bản ghi đầu tiên để trống. Điểm cuối là hạng hiện tại." : "Hạng All time theo tháng; điểm cuối là hạng hiện tại. Tháng 8–9/2024 thiếu dữ liệu được giữ hạng tháng trước. Các khoảng trống khác: chưa có lịch sử hoặc thấp hơn hạng cuối danh sách.";
    if (H && rows.length) {
      const lastPeriod = (H.periods || []).map(scopeFromPeriod).filter(Boolean).sort().at(-1) || (H.asOf || asOf).slice(0,7);
      const periods: string[] = [];
      for (let year=2024, month=5; ; month++) {
        if (month>12) { year++; month=1; }
        const period = `${year}-${String(month).padStart(2,'0')}`;
        if (period>lastPeriod) break;
        periods.push(period);
      }
      const labels = periods.map(mlab).concat(["Nay"]);
      o.rankHistoryLabels = labels;
      const series = rows.map((r: Any, k: number) => ({ name: artists ? r.artist : r.title,
        ranks: ranksWithHistoricalGaps(r.history || [], periods, artists).concat([r.rank]),
        color: `hsl(${(k * 137.508) % 360} 55% 40%)`,
      }));
      const maxRank = Math.max(1, ...rows.map((r: Any) => Number(r.rank) || 1));
      o.rankHistoryChart = bump(series, labels, DESKTOP_WEB ? { maxRank, width: 1400, height: Math.max(320, maxRank * 30 + 40), fullLabels: true, labelWidth: artists ? 230 : 360 } : { maxRank, height: Math.max(250, maxRank * 22 + 30) });
    } else o.rankHistoryNote = H ? "Chưa có dữ liệu lịch sử thứ hạng." : "Chưa tải được lịch sử thứ hạng.";
  }
  if (scr === "releaseYears") {
    const releaseArea=releaseYearData(D.ry?.rows || []);
    o.areaLegend=releaseArea.series.map(s=>({name:s.name,color:s.color}));
    Object.assign(o,charts(c,null,null,{area:releaseArea}));
    o.ch.tags = releaseArea.years.length ? tagStream(releaseArea.years, releaseArea.series, { ...(DESKTOP_WEB ? {w:1100,h:270} : {}) }) : null;
    o.ch.artistMap = artistMapChart(artistCountryData(D.aat?.rows || []), { ...(DESKTOP_WEB ? {w:1100,h:360} : {}) });
  }
  if (scr === "overview") {
    const O = D.ov, T = O.totals || {}, all = p.scope === "All time", before = all && O.beforeTracking ? O.beforeTracking.plays : null;
    const trendOverride = c.id?.startsWith("trend~") ? c.id.slice(6) : "";
    const viewAsOf = /^\d{4}-\d{2}-\d{2}$/.test(trendOverride) ? trendOverride : asOf;
    const isM = p.scope === "Tháng" || p.scope === "Tháng trước", scYm = p.scope === "Tháng trước" ? prevYm(viewAsOf) : viewAsOf.slice(0, 7), mm = scYm.slice(5, 7);
    const curM = Number(viewAsOf.slice(5, 7)), pvM = Number(prevYm(viewAsOf).slice(5, 7));
    o.scopeChips = SCOPE_ORDER.map((v) => ({
      label: v === "Tháng" ? "Tháng " + curM : v === "Tháng trước" ? "Tháng " + pvM : v === "Năm" ? "Năm " + viewAsOf.slice(0, 4) : v,
      active: v === p.scope, onTap: () => c.set(() => ({ scope: v, sel: {} })),
    }));
    o.isMonth = isM; o.isAll = all;
    // Tổng quan đếm bài / nghệ sĩ / album đã nghe trong phạm vi (khác dòng "Tổng" ở Hôm nay: cả thư viện)
    const SLP = ["lượt", "bài đã nghe", "nghệ sĩ", "album", "thể loại"];
    o.stats = [T.plays, T.songs, T.artists, T.albums, T.genres].map((v, k) => ({ v: vn(v || 0), l: SLP[k], span: k < 3 ? 2 : 3 }));
    o.hasBefore = before != null; o.beforeL = before != null ? `Trước khi theo dõi: ${vn(before)} lượt (cột bị cắt)` : "";
    o.dayTitle = `M${mm}/${scYm.slice(2,4)}`;
    const months = (O.months || []).map((m: Any) => ({ month: m.month, l: mlab(m.month), plays: m.plays || 0, hours: m.hours || 0 }));
    const monthIndex = new Map(months.map((m: Any, i: number) => [m.month, i]));
    const topArtistHours = (O.artists || []).slice(0, 10).map((a: Any) => {
      const out = months.map(() => 0), vals = Array.isArray(a.spark) ? a.spark : [];
      const sparkMonths = Array.isArray(O.sparkMonths) ? O.sparkMonths : [];
      if (vals.length && sparkMonths.length === vals.length) vals.forEach((v: number, i: number) => { const j = monthIndex.get(sparkMonths[i]); if (j != null) out[j] = Number(v) || 0; });
      else if (vals.length) vals.forEach((v: number, i: number) => { const j = months.length - vals.length + i; if (j >= 0 && j < months.length) out[j] = Number(v) || 0; });
      return { name: a.name, vals: out };
    }).filter((a: Any) => a.vals.some((v: number) => v > 0));
    const selectedHourIndex = Math.min(p.sel?.hours ?? months.length - 1, months.length - 1);
    const selectedHourMonth = months[selectedHourIndex]?.month;
    const monthArtistHours = (O.monthArtists || []).map((a: Any) => ({ month: a.month, name: a.artist, plays: a.plays || 0, hours: a.hours || 0 }));
    if (selectedHourMonth && D.ovHoursMonth?.artists) {
      const seenMonthArtists = new Set(monthArtistHours.filter((a: Any) => a.month === selectedHourMonth).map((a: Any) => a.name));
      (D.ovHoursMonth.artists || []).slice(0, 10).forEach((a: Any) => {
        if (!seenMonthArtists.has(a.name)) monthArtistHours.push({ month: selectedHourMonth, name: a.name, plays: a.plays || 0, hours: a.hours || 0 });
      });
    }
    const weekPlays: Any[] = [];
    const weekNo = (date: string) => {
      const d = new Date(`${date}T00:00:00Z`), start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.floor((Number(d) - Number(start)) / 604800000) + 1;
    };
    months.forEach((m: Any, mi: number) => {
      const detail = D["ovWeek" + String(m.month || "").replace("-", "")];
      const dayRows = Array.isArray(detail?.byDay) ? detail.byDay : [];
      if (!dayRows.length) return;
      const buckets = new Map<number, Any>();
      dayRows.forEach((r: Any) => {
        const date = String(r.k || r.date || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        const day = Number(date.slice(8, 10));
        const bi = Math.floor((day - 1) / 7);
        const bucket = buckets.get(bi) || { month: m.month, monthIndex: mi, from: date, to: date, plays: 0 };
        bucket.to = date;
        bucket.plays += Number(r.plays ?? r.n ?? r.count ?? 0) || 0;
        buckets.set(bi, bucket);
      });
      [...buckets].sort((a, b) => a[0] - b[0]).forEach(([_, bucket]) => {
        weekPlays.push({ ...bucket, label: `WW ${pad(weekNo(bucket.from))} ${Number(bucket.from.slice(8, 10))}–${Number(bucket.to.slice(8, 10))}/${bucket.to.slice(5, 7)}/${bucket.to.slice(2, 4)}` });
      });
    });
    const dim = new Date(Date.UTC(Number(scYm.slice(0, 4)), Number(mm), 0)).getUTCDate();
    const ov: Any = { before, months, weekPlays, topArtistHours, monthArtistHours, cap: before != null && months.length ? Math.max(...months.map((m: Any) => m.plays)) * 1.1 : undefined, dots: [], mm,
      day: arrOf(O.byDay, dim, (x) => { const k = x.k ?? x.day ?? x.date; return typeof k === "string" ? Number(k.slice(8, 10)) - 1 : k >= 1 ? k - 1 : k; }),
      wd: Array(7).fill(0), hr: arrOf(O.byHour, 24, (x) => x.k ?? x.hour ?? x.h) };
    if (Array.isArray(O.byWeekday)) O.byWeekday.forEach((x: Any, idx: number) => { const k = typeof x === "number" ? idx : x.k ?? x.weekday ?? x.dow; const v = typeof x === "number" ? x : x.plays ?? x.n ?? 0; if (k != null) ov.wd[(k + 6) % 7] = v; });
    ov.dayDef = p.scope === "Tháng" ? Math.max(0, Number(viewAsOf.slice(8, 10)) - 1) : dim - 1;
    o.monthEmpty = isM && !T.plays;
    o.monthWeeks = isM ? monthWeeks(scYm, viewAsOf, ov.day) : [];
    const scope = scopeValue(p.scope, viewAsOf), label = periodLabel(scope);
    const compactLabel = /^\d{4}-\d{2}$/.test(scope) ? `M${scope.slice(5)}/${scope.slice(2,4)}` : label;
    {
      const openArtists = (periodFilter = "Tất cả") => c.go("periodTop", `artists~${scope}~${viewAsOf}`, { periodFilter, periodSort: "Giờ nghe" });
      const openSongs = (periodFilter = "Tất cả") => c.go("periodTop", `songs~${scope}~${viewAsOf}`, { periodFilter, songView: "Danh sách" });
      const newScope = all ? viewAsOf.slice(0, 4) : scope;
      const openNewArtists = () => c.go("periodTop", `artists~${newScope}~${viewAsOf}`, { periodFilter: "Mới thêm", periodSort: "Giờ nghe" });
      const openNewSongs = () => c.go("periodTop", `songs~${newScope}~${viewAsOf}`, { periodFilter: "Mới thêm", songView: "Danh sách" });
      const notable = (r: Any) => !all || (r.plays || 0) > 0 || (r.hours || 0) > 0;
      const additions = (D.monthSummaryAdditions?.artists || []).filter(notable).map((r: Any) => ({ an:r.name, name:r.name, ini:ini(r.name), added:r.added, plays:r.plays, hours:r.hours, onTap:toArtist(r.name) }));
      const newSongs = (D.monthSummaryAdditions?.songs || []).filter(notable).slice().sort((a: Any, b: Any) => (b.plays || 0) - (a.plays || 0) || (b.hours || 0) - (a.hours || 0)).map((r: Any) => ({ tid:r.track_id, title:r.title, name:r.title, artist:r.artist, ini:ini(r.title), added:r.added, plays:r.plays, hours:r.hours, onTap:r.track_id ? toSong(r.track_id) : noop }));
      const listened = new Set((O.artists || []).map((r: Any) => r.name));
      const changes = allTimeRankChanges(D.monthSummaryATEnd?.rows || [], D.monthSummaryATBefore?.rows || [], (r: Any) => r.artist);
      const currentRanks = new Map<string, number>((D.monthSummaryATEnd?.rows || []).map((r: Any) => [r.artist, r.rank]));
      const risingArtists = [...changes].filter(([name, change]) => change > 0 && (all || listened.has(name))).sort((a, b) => (currentRanks.get(a[0]) ?? Infinity) - (currentRanks.get(b[0]) ?? Infinity)).map(([name, change]) => ({ an:name, name, ini:ini(name), change, rank:currentRanks.get(name), onTap:toArtist(name) }));
      const listenedSongs = new Map<string, Any>((O.songs || []).map((r: Any) => [r.track_id, r]));
      const songChanges = allTimeRankChanges(D.monthSummarySongATEnd?.rows || [], D.monthSummarySongATBefore?.rows || [], (r: Any) => r.track_id);
      const currentSongRanks = new Map<string, number>((D.monthSummarySongATEnd?.rows || []).map((r: Any) => [r.track_id, r.rank]));
      const currentSongRows = new Map<string, Any>((D.monthSummarySongATEnd?.rows || []).map((r: Any) => [r.track_id, r]));
      const risingSongs = all ? (D.hist?.rows || []).filter((r: Any) => (r.rise || 0) > 0 && (r.rank ?? Infinity) <= 100).sort(byCurrentRank).map((r: Any) => ({
        tid:r.track_id, title:r.title, name:r.title, artist:r.artist, ini:ini(r.title), change:r.rise, rank:r.rank, onTap:r.track_id ? toSong(r.track_id) : noop
      })) : [...songChanges].filter(([id, change]) => change > 0 && listenedSongs.has(id) && (currentSongRanks.get(id) ?? Infinity) <= 100).sort((a, b) => (currentSongRanks.get(a[0]) ?? Infinity) - (currentSongRanks.get(b[0]) ?? Infinity)).map(([id, change]) => {
        const song = listenedSongs.get(id) || currentSongRows.get(id) || {};
        return { tid:id, title:song.title, name:song.title, artist:song.artist, ini:ini(song.title), change, rank:currentSongRanks.get(id), onTap:toSong(id) };
      });
      const topArtists = (O.artists || []).slice(0, 3).map((r: Any) => ({ an:r.name, name:r.name, ini:ini(r.name), metric:fmtH(r.hours || 0), onTap:toArtist(r.name) }));
      const topAlbums = (O.albums || []).slice(0, 3).map((r: Any) => ({ ak:r.artist + US + r.name, name:r.name, artist:r.artist, ini:ini(r.name), metric:fmtH(r.hours || 0), onTap:()=>c.go("album",albumId(r.artist,r.name)) }));
      const topSongs = (O.songs || []).slice(0, 3).map((r: Any) => ({ tid:r.track_id, name:r.title, title:r.title, artist:r.artist, ini:ini(r.title), metric:`${vn(r.plays || 0)}x`, onTap:r.track_id ? toSong(r.track_id) : noop }));
      const lead = (O.artists || [])[0];
      o.monthSummary = {
        title:isM ? `Tóm tắt tháng ${Number(mm)}` : all ? "Tóm tắt All time" : `Tóm tắt ${scope}`,
        status:`${vn(T.plays || 0)} lượt · ${vn(T.songs || 0)} bài · ${vn(T.artists || 0)} nghệ sĩ · ${vn(T.albums || 0)} Albums`,
        metrics:[
          {value:vn(T.plays || 0),label:"lượt"},
          {value:vn(T.songs || 0),label:"bài"},
          {value:vn(T.artists || 0),label:"nghệ sĩ"},
          {value:vn(T.albums || 0),label:"Albums"},
        ],
        lead:lead ? { an:lead.name, name:lead.name, ini:ini(lead.name), value:fmtH(lead.hours || 0), onTap:()=>openArtists() } : null,
        newArtists:additions.slice(0,3), newCount:additions.length,
        risingArtists:risingArtists.slice(0,3), risingCount:risingArtists.length,
        newSongs:newSongs.slice(0,3), newSongCount:newSongs.length,
        risingSongs:risingSongs.slice(0,3), risingSongCount:risingSongs.length,
        openAll:()=>openArtists(), openNew:openNewArtists, openRising:()=>openArtists("Đang lên"),
        openNewSongs, openRisingSongs:()=>openSongs("Đang lên"),
        blocks:isM ? [
          {label:"Top artist",count:"3 nghệ sĩ",rows:topArtists,round:true,onTap:()=>openArtists()},
          {label:"Top Albums",count:`${topAlbums.length} Albums`,rows:topAlbums,onTap:()=>c.go("periodTop",`albums~${scope}~${viewAsOf}`)},
          {label:"Top song",count:"3 bài",rows:topSongs,onTap:()=>openSongs()},
          {label:"Tăng hạng",count:risingArtists.length ? `${risingArtists.length} nghệ sĩ` : "Chưa có",rows:risingArtists.slice(0,3),round:true,onTap:()=>openArtists("Đang lên")},
        ] : undefined,
      };
    }
    const releaseArea = releaseYearData(D.ry?.rows || []);
    o.areaLegend = releaseArea.series.map((s) => ({ name: s.name, color: s.color }));
    Object.assign(o, charts(c, null, null, { ov, area: releaseArea }));
    if (p.scope === "Năm") {
      const calendarSource = yearCalendarRows(D, scope);
      const calendarDays = listeningCalendarDays(calendarSource.loaded ? calendarSource.rows : O.byDay || [], scope, viewAsOf);
      o.ch.calendar = calendarDays.length ? listeningCalendar(calendarDays, { ...(DESKTOP_WEB ? {w:1100,cell:14,gap:3} : {}), year: scope }) : null;
      o.rd.calendar = calendarSource.loaded ? `${scope} · ${vn(calendarDays.reduce((a: number, d: Any) => a + (d.value || 0), 0))} lượt` : "Đang tải dữ liệu ngày…";
    }
    if (!months.length) o.rd = { ...o.rd, month: "Chưa có lượt nghe trong kỳ này", hours: "Chưa có lượt nghe trong kỳ này" };
    o.topArtistsTitle = `Top ${DESKTOP_WEB ? 12 : 6} Artists ${compactLabel}`;
    o.topAlbumsTitle = `Top 6 Albums ${compactLabel}`;
    o.topSongsTitle = `Top 10 Songs ${compactLabel}`;
    o.topGenresTitle = `Top 10 Genres ${compactLabel}`;
    o.viewArtists = () => {
      if (all) { c.go("artistsAll"); }
      else { c.go("periodTop", `artists~${scope}~${viewAsOf}`, {periodSort:"Giờ nghe",periodFilter:"Tất cả"}); }
    };
    o.viewAlbums = () => c.go("periodTop", `albums~${scope}~${viewAsOf}`);
    o.viewSongs = () => {
      if (all) { c.go("top100"); }
      else { c.go("periodTop", `songs~${scope}~${viewAsOf}`); }
    };
    const arts = all ? D.aat.rows.map((a: Any) => ({ ...a, name: a.artist })) : [...(O.artists || [])].sort((a: Any,b: Any) => (b.hours || 0)-(a.hours || 0) || (b.plays || 0)-(a.plays || 0)), a0 = (arts[0] && arts[0].hours) || 1;
    o.hourArtists = arts.slice(0, DESKTOP_WEB ? 12 : 6).map((a: Any, k: number) => ({ an: a.name, rank: !all ? k + 1 : a.rank ?? k + 1, name: a.name, ini: ini(a.name), listenedTracks: all ? undefined : (a.tracks || 0), lastPlayed: all ? shortDate(a.lastPlayed) : undefined, sub: all ? `nghe lần cuối ${shortDate(a.lastPlayed)}` : `${vn(a.tracks || 0)} bài trong kỳ`, small: `${vn(a.plays)} lượt`, listeningHours: fmtH(a.hours || 0), ...NOFL, v: fmtH(a.hours || 0), bar: bar(((a.hours || 0) / a0) * 100),
      spark: Array.isArray(a.spark) && a.spark.length > 1 ? spark(a.spark, { inv: false, w: 46 }) : null, onTap: toArtist(a.name) }));
    if (all && D.pts) {
      const pr = D.pts.rows || [], top = (pr[0] && pr[0].points) || 1;
      o.scoreRows = pr.slice(0, 6).map((x: Any, k: number) => ({ rank: x.rank ?? k + 1, name: x.artist, ...NOFL, score: d1(x.points), bar: bar((x.points / top) * 100, "var(--c2)"), open: p.open === k, onTap: () => c.set((q) => ({ open: q.open === k ? -1 : k })), parts: ptRows(x.parts) }));
    }
    o.top15 = (all ? D.hist.rows : O.songs || []).slice(0, 10).map((r: Any, k: number) => ({ tid: r.track_id, rank: r.rank ?? k + 1, title: r.title, artist: r.artist || "Chưa rõ nghệ sĩ", listening: all ? fmtMin(r.minutes || 0) : fmtH(r.hours || 0), timeFirst: all, v: vn(r.plays) + " lượt", onTap: r.track_id ? toSong(r.track_id) : noop }));
    const gs = (O.genres || []).slice(0, 10), g0 = (gs[0] && gs[0].plays) || 1;
    o.genres = gs.map((g: Any, k: number) => ({ name: cap1(g.name), detail: `${vn(g.tracks || 0)} bài · ${fmtH(g.hours || 0)}`, v: vn(g.plays || 0) + " lượt", bar: bar(((g.plays || 0) / g0) * 100, k < 8 ? `var(--c${k + 1})` : "var(--text3)", 4) }));
    o.albums = (O.albums || []).slice(0, 6).map((a: Any, k: number) => ({ ak: a.artist + US + a.name, rank: a.rank ?? k + 1, title: a.name, name: a.name, artist: a.artist, ini: ini(a.name), plays: `${vn(a.plays)} lượt`, listened: a.tracks, v: fmtH(a.hours || 0), onTap: () => c.go("album",albumId(a.artist,a.name)) }));
  }
  if (scr === "rising") {
    o.risingGroups = risingSongGroups(D, asOf, toSong, noop);
    o.risingAll = o.risingGroups.flatMap((g: Any) => g.rows);
    o.risingHead = "Tháng hiện tại và tháng trước · tăng hạng All time so với cuối tháng liền trước · có lượt nghe trong tháng · nghe gần nhất trước";
  }
  if (scr === "rules") {
    const rr = (D.rules.rules || []).map((x: Any) => ({ from: x.from_key, title: x.title, artist: x.artist, onTap: x.track_id ? toSong(x.track_id) : noop }));
    o.rulesAll = rr;
  }
  if (scr === "settings" || scr === "library" || scr === "unmatched") {
    const L = D.lib, lf = (L.sync || []).find((x: Any) => x.key === "lastfm"), rows = D.un.rows || [], mv = Object.values(p.matched);
    o.lfmL = lf ? "Cập nhật " + ago(lf.updated_at) : "Chưa có thông tin đồng bộ";
    const lsy = (L.sync || []).find((x: Any) => x.key === "library");
    let lv: Any = {};
    try { lv = JSON.parse((lsy && lsy.value) || "{}"); } catch {}
    o.appleL = `${vn(L.library.tracks)} bài · file cập nhật ${fmtLocal(lv.file_modified || L.library.last_added)}` + (lsy ? ` · đồng bộ ${ago(lsy.updated_at)}` : "");
    // Yêu cầu đồng bộ thư viện: lấy bản mới hơn giữa trạng thái trong app và /library.libraryRequest.
    const srvReq = L.libraryRequest;
    const lr = LIBREQ.st && (!srvReq || Date.parse(LIBREQ.st.requested_at || "") >= Date.parse(srvReq.requested_at || "")) ? LIBREQ.st : srvReq || { status: "idle" };
    if (lr.status === "pending" && !LIBREQ.st) { LIBREQ.st = lr; LIBREQ.toast = c.ptoast; startLibPoll(); }
    const stale = libStale(lr);
    o.libPending = lr.status === "pending" && !stale; o.libStale = stale;
    o.libPendingL = lr.phase || "Đang đồng bộ thư viện và ID Apple Music…";
    const sm = lr.status === "done" && lr.summary;
    o.appleSub = lr.status === "failed" ? (lr.error || "Đồng bộ chưa thành công, hãy thử lại") : sm
      ? sm.catalog_changed
        ? sm.source === 'iOS Music Library'
          ? `Lần đồng bộ gần nhất ${hhmmdm(lr.done_at)}: +${vn(sm.added || 0)} bài mới · cập nhật ${vn(sm.catalog_keys || 0)} ID Apple Music`
          : `Lần đồng bộ gần nhất ${hhmmdm(lr.done_at)}: +${vn(sm.added || 0)} bài mới · cập nhật ${vn(sm.catalog_files || 0)} file ID Apple Music`
        : !sm.added && !sm.missing && !sm.changed && !sm.metadata_changed
        ? `Lần đồng bộ gần nhất ${hhmmdm(lr.done_at)}: thư viện đã khớp, không có gì mới`
        : `Lần đồng bộ gần nhất ${hhmmdm(lr.done_at)}: +${vn(sm.added || 0)} bài mới · ${vn(sm.missing || 0)} bài không còn · ${vn(sm.changed || 0)} bài thay đổi`
      : lsy ? `Lần đồng bộ gần nhất: +${vn(lv.added || 0)} bài mới · ${vn(lv.missing || 0)} bài không còn trong thư viện` : APPLE_SUB;
    // Optional endpoints must never leave sample records in the server view.
    o.rules3 = []; o.rulesAll = []; o.rulesMore = ""; o.hasRules = false;
    if (D.rules) {
      const rr = (D.rules.rules || []).map((x: Any) => ({ from: x.from_key, title: x.title, artist: x.artist, onTap: x.track_id ? toSong(x.track_id) : noop }));
      o.rules3 = rr.slice(0, 3); o.rulesMore = `Xem tất cả (${vn(rr.length)} quy tắc)`; o.hasRules = rr.length > 0;
    }
    o.simNote = !CAN_WRITE;
    o.unPlays = vn(Math.max(0, L.unmatched.plays - mv.reduce((a, m) => a + m.plays, 0)));
    o.unSongs = vn(Math.max(0, L.unmatched.songs - mv.length));
    const srvRm = !!(L.rules && L.rules.mergeRemaster), rmCur = p.rmTouched ? p.remaster : srvRm;
    o.rmOn = rmCur;
    o.toggleRemaster = async () => {
      const next = !rmCur;
      c.set(() => ({ rmTouched: true, remaster: next, remerge: true }));
      if (!CAN_WRITE) { c.later(1800, () => c.set(() => ({ remerge: false }))); return; }
      const r = await postJson("/settings/rules", { mergeRemaster: next });
      if (r.status === 200) {
        await postJson("/sync"); // ghép lại ngay một đợt lượt chưa khớp theo quy tắc mới (phần còn lại cron làm tiếp)
        c.set(() => ({ rmTouched: false, remerge: false }));
        c.ptoast(next ? "Đã bật gộp bản remaster" : "Đã tắt gộp bản remaster");
        invalidate(() => true);
      } else {
        c.set(() => ({ rmTouched: false, remerge: false }));
        c.ptoast("Không đổi được quy tắc, thử lại sau");
      }
    };
    const mr = rows.map((m: Any, k: number) => srvMatchRow(c, m, k));
    o.matches = mr.slice(0, 3); o.allMatches = mr; o.unHint = `Hiện ${rows.length} bài nhiều lượt nhất, sắp theo số lượt`;
    const qd = (p.qd || "").trim(), searching = (scr === "settings" || scr === "library") && (p.q || "").trim().length > 0;
    if (searching) {
      if (qd.length < 2 || (p.q || "").trim() !== qd) {
        o.results = []; o.hasResults = false; o.noResults = false;
        o.resultLabel = (p.q || "").trim().length < 2 ? "Gõ ít nhất 2 ký tự" : "Đang tìm…";
      } else if (D.srch) {
        const R = D.srch, res: Any[] = [];
        (R.artists || []).forEach((a: Any) => res.push({ an: a.artist, kind: "Nghệ sĩ", title: a.artist, sub: vn(a.tracks || 0) + " bài" + (a.plays != null ? " · " + vn(a.plays) + " lượt" : ""), ini: ini(a.artist), round: true, onTap: toArtist(a.artist) }));
        (R.songs || []).forEach((x: Any) => res.push({ tid: x.track_id, kind: "Bài hát", title: x.title, artist:x.artist, sub: x.artist || "Chưa rõ nghệ sĩ", ini: ini(x.artist || x.title), round: false, onTap: x.track_id ? toSong(x.track_id) : noop }));
        (R.albums || []).map((a:Any)=>({...a,album:canonicalAlbum(a.artist || '',a.album)})).filter((a:Any,i:number,rows:Any[])=>rows.findIndex(b=>b.artist===a.artist&&b.album===a.album)===i).forEach((a: Any) => res.push({ ak: a.artist + US + a.album, kind: "Album", title: a.album, sub: a.artist + (a.year ? " " + a.year : ""), ini: ini(a.album), round: false, onTap: () => c.go("album", albumId(a.artist,a.album)) }));
        o.results = res.slice(0, 15); o.hasResults = res.length > 0; o.noResults = res.length === 0;
        o.resultLabel = res.length ? `${Math.min(15, res.length)} kết quả` : "Kết quả";
      } else {
        o.results = []; o.hasResults = false; o.noResults = D.srchSt === "err";
        o.resultLabel = D.srchSt === "err" ? "Không tìm được" : "Đang tìm…";
      }
    }
    const fItem = p.findK != null ? rows[p.findK] : null;
    o.findOpen = !!fItem;
    if (fItem) {
      const fq = fold((p.fqd || "").trim()), list = D.fs ? D.fs.songs || [] : [];
      const fr = list.filter((x: Any) => (fq ? true : fold(x.artist || "") === fold(fItem.artist))).slice(0, 12).map((x: Any) => ({ tid: x.track_id, title: x.title, artist: x.artist || "Chưa rõ nghệ sĩ", ini: ini(x.artist || x.title),
        onTap: () => mergeTo(c, fItem, p.findK as number, { id: x.track_id, title: x.title, artist: x.artist }) }));
      o.findTitle = `“${fItem.title}” – ${fItem.artist} · ${fItem.plays} lượt`;
      o.findLabel = D.fs ? (fq ? `${fr.length} kết quả` : `Bài của ${fItem.artist} trong thư viện`) : "Đang tìm…";
      o.fRes = fr; o.fNone = !!D.fs && fr.length === 0;
    }
  }
  if (scr === "song") {
    const g = D.song, tr = g.track || {}, at = g.allTime, rt = g.rating, stop = /stop rating/i.test(tr.comments || "");
    const ms = g.months || [], latestMonth = ms.length ? String(ms[ms.length - 1].month).slice(0, 7) : asOf.slice(0, 7);
    const endYm = latestMonth > asOf.slice(0, 7) ? latestMonth : asOf.slice(0, 7);
    const firstYm = ms.length ? String(ms[0].month).slice(0, 7) : endYm;
    const [firstYear, firstMonth] = firstYm.split("-").map(Number), [endYear, endMonth] = endYm.split("-").map(Number);
    const monthCount = Math.max(1, (endYear - firstYear) * 12 + endMonth - firstMonth + 1);
    const win = monthsBack(endYm, monthCount);
    const mv = win.map((m) => { const e = ms.find((x: Any) => String(x.month).slice(0, 7) === m); return e ? e.plays : 0; });
    const rh = g.rankHistory || [], timeline = songRankTimeline(rh, asOf, at?.rank), ranks = timeline.ranks;
    const rankByMonth = new Map<string, number | null>();
    timeline.labels.forEach((label, i) => {
      const match = /^(\d{2})\/(\d{2})$/.exec(label);
      rankByMonth.set(match ? `20${match[2]}-${match[1]}` : endYm, ranks[i] ?? null);
    });
    const rankMonths = win.map((month) => rankByMonth.get(month) ?? null);
    const bestRank = rh.reduce((best: number | null, point: Any) => Number.isInteger(point.rank) && point.rank > 0 && (best == null || point.rank < best) ? point.rank : best, null);
    const chg = at && bestRank != null ? bestRank - at.rank : null;
    const sObj = { months: mv, mL: win.map(mlab), rankMonths, ranks, rL: timeline.labels, currentRank: at?.rank, ranked: !!at };
    Object.assign(o, charts(c, sObj, null, {}));
    const scoreV = stop && tr.my_rating != null ? `★ ${Math.round(tr.my_rating / 20)}/5` : rt && rt.rating != null ? String(Math.round(rt.rating)) : "–";
    const days = rt && rt.days_in_library != null ? rt.days_in_library : null;
    o.song = { tid: tr.id || D.songId, gone: tr.in_library === 0, title: tr.title, album: tr.album, goAlbum: tr.album ? () => c.go("album",albumId(tr.album_artist || tr.artist || "",tr.album)) : undefined, artist: tr.artist, goArtist: toArtist(tr.artist), ini: ini(tr.title), rankWeight:tr.rank_weight, lv: at ? "lv" + at.level : "–",
      totalPlays: vn(at?.plays ?? ((tr.plays_to_12_2024 || 0) + (g.plays?.since_cutover || 0))),
      score: scoreV, scoreL: stop ? "Đánh giá Apple" : "Điểm /10", rank: at ? "#" + at.rank : "–", rankL: at ? "All time" : "Không xếp hạng", chg: chg != null ? chgInline(chg) : null,
      hasHist: !!at && ranks.filter(r => r != null).length > 1, histNote: at ? `Mới vào bảng All time ở hạng #${at.rank}, chưa có lịch sử các tháng trước.` : "Bài này không nằm trong bảng All time.",
      info: [["Thêm vào thư viện", dmy(tr.date_added) + (days != null ? ` · ${vn(days)} ngày` : "")], ["Lần nghe cuối", fmtWhen(g.plays && g.plays.last)], ["Bỏ qua", (tr.apple_skips ?? 0) + " lần"], ["Tổng", at ? `${vn(at.plays)} lượt · ${fmtMin(at.minutes)}` : `${vn((g.plays && g.plays.logged) || 0)} lượt`]].map(([k, v]) => ({ k, v })) };
    o.shareCards = [{ tid: tr.id || D.songId, isWeek: false, period: "All time · " + dmy(asOf), title: tr.title, sub: tr.artist || "Chưa rõ nghệ sĩ",
      stats: [[at ? "#" + at.rank : "–", at ? (chg != null ? "Hạng · " + chgTxt(chg) : "Hạng") : "Không xếp hạng"], [vn(at ? at.plays : 0), "Lượt nghe"], [scoreV, stop ? "Đánh giá Apple" : "Điểm"]].map(([v, l]) => ({ v, l })),
      chartLabel: "Lượt nghe theo tháng", chart: statChart(mv) }];
  }
  if (scr === "artist") {
    const A = D.art, nm = artName(c.id), rk = A.ranks || {}, rf = (v: Any) => (v ? "#" + v : "–"), lib = A.library || {};
    const ms = A.months || [], latestMonth = ms.length ? String(ms[ms.length - 1].month).slice(0, 7) : asOf.slice(0, 7);
    const endYm = latestMonth > asOf.slice(0, 7) ? latestMonth : asOf.slice(0, 7);
    const artistHistory = (D.artistRankHistory?.rows || []).find((row: Any) => fold(row.artist) === fold(nm));
    const rankRows = artistHistory?.history || [];
    const rankYm = (period: string) => { const match = /^T(\d{2})\/(\d{2})$/.exec(period); return match ? `20${match[2]}-${match[1]}` : period.slice(0, 7); };
    const firstCandidates = [ms[0]?.month && String(ms[0].month).slice(0, 7), rankRows[0]?.period && rankYm(rankRows[0].period)].filter(Boolean).sort();
    const firstYm = firstCandidates[0] || endYm;
    const [firstYear, firstMonth] = firstYm.split("-").map(Number), [endYear, endMonth] = endYm.split("-").map(Number);
    const monthCount = Math.max(1, (endYear - firstYear) * 12 + endMonth - firstMonth + 1);
    const win = monthsBack(endYm, monthCount);
    const mrow = (m: string) => ms.find((x: Any) => String(x.month).slice(0, 7) === m) || {};
    const wk = A.weeks || [], lastW = wk.length ? String(wk[wk.length - 1].week).slice(0, 10) : addDays(asOf, -((dow(asOf) + 6) % 7));
    const wd = Array.from({ length: 26 }, (_, k) => addDays(lastW, -7 * (25 - k)));
    const wv = wd.map((d) => { const e = wk.find((x: Any) => String(x.week).slice(0, 10) === d); return e ? e.plays : 0; });
    const rankHistory = ranksWithHistoricalGaps(rankRows, win, true);
    if (win.length && rk.at) rankHistory[rankHistory.length - 1] = rk.at;
    const aObj = { name: nm, hours: win.map((m) => mrow(m).hours || 0), tot: win.map((m) => mrow(m).totalHours || 0), mL: win.map(mlab), weeks: wv, wL: wd.map((d) => "Tuần " + dm(d)), wT: wd.map((d, k) => (k % 5 === 0 ? dm(d) : "")), rankHistory, currentRank: rk.at };
    Object.assign(o, charts(c, null, aObj, {}));
    const gen = Array.isArray(lib.genres) ? lib.genres.map((x: Any) => cap1(x.name ?? x)).join(", ") : cap1(lib.genres || "");
    const pt = A.points, top = A.topSongs || [];
    o.artist = { an: nm, name: nm, ini: ini(nm), ...flOf(A.flag), sub: `${vn((A.allTime || {}).plays || 0)} lượt · ${fmtH((A.allTime || {}).hours || 0)} · ${vn((A.logged || {}).days || 0)} ngày có nghe`,
      metrics: [{ value: vn(A.allTime?.plays || 0), label: "Lượt nghe" }, { value: fmtH(A.allTime?.hours || 0), label: "Thời gian nghe" }, { value: vn(A.logged?.days || 0), label: "Ngày có nghe" }],
      wk: rf(rk.week), mo: rf(rk.month), all: rf(rk.at), rline: `1 tháng ${rf(rk.m1)} · 100 ngày ${rf(rk.d100)} · từ 04/2024 ${rf(rk.ft0424)} · All time ${rf(rk.at)}`,
      gap: A.avgGapDays != null ? d1(A.avgGapDays) + " ngày" : "–", trackCount: Number(lib.tracks || 0), lib: `Trong thư viện: ${vn(lib.tracks || 0)} bài · ${vn(lib.albums || 0)} Albums` + (gen ? " · " + gen : ""),
      hasPts: !!pt, pts: pt ? d1(pt.points) : "", ptsRank: pt ? "#" + pt.rank : "", parts: pt ? ptRows(pt.parts) : [],
      songs: top.slice(0, 5).map((x: Any, k: number) => ({ tid: x.track_id, artist: nm, rank: x.rank ?? k + 1, title: x.title, v: vn(x.plays) + " lượt", onTap: x.track_id ? toSong(x.track_id) : noop })) };
    o.shareCards = [{ an: nm, isWeek: false, period: "All time · " + dmy(asOf), title: nm, sub: vn(lib.tracks || 0) + " bài trong thư viện",
      stats: [[rf(rk.at), "All time"], [vn((A.allTime || {}).plays || 0), "Lượt nghe"], [fmtH((A.allTime || {}).hours || 0), "Giờ nghe"]].map(([v, l]) => ({ v, l })),
      chartLabel: "Giờ nghe 14 tháng", chart: statChart(aObj.hours) }];
  }
  return o;
}

export function buildVM(c: Ctx): VM {
  if (!SCOPE_ORDER.includes(c.p.scope)) c = { ...c, p: { ...c.p, scope: "Tháng" } };
  const base = sampleVM(c);
  if (c.screen === "releases") return { ...base, sampleChip: false };
  if (DATA_SOURCE !== "Server") return base;
  // Keep filters available while loading or when the selected scope is unavailable.
  base.scopeChips = chips(SCOPE_ORDER, c.p.scope,
    (scope) => c.set(() => ({ scope, sel: {} })));
  const { st, D, codes, failures, stale, failed, dataAt } = serverGet(c);
  const p = c.p;
  // Cache raw server data, not React elements or callbacks tied to old UI state.
  const viewKey = "view:" + JSON.stringify([c.screen, c.id, p.sort, p.scope, p.filter, p.songView, p.songRankAsOf, p.artistFilter, p.artistRankAsOf,p.albumSort,p.albumFilter,p.albumRankAsOf,
    "Tháng", "album24BadgeV2", p.qd, p.findK, p.fqd, p.sheet, ...(c.screen === "periodTop" && p.periodFilter === "Mới thêm" ? ["new"] : [])]);
  const previous = lastGood.get(viewKey);
  const cacheableViewData = (data: Any) => Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith("metadata")));
  const label = (at: number, error: boolean) =>
    (error ? (codes.includes("d1_daily_limit") ? CHIP_D1 : CHIP_ERR) : "Đang cập nhật · đang hiện dữ liệu đã lưu")
    + (at ? " · lưu lúc " + hhmmdm(new Date(at).toISOString()) : "");
  // Cached content stays quiet during normal background revalidation; report actual failures only.
  const savedView = (error: boolean): VM | undefined => {
    if (!previous) return;
    try {
      const o = { ...base, ...mapServer(c, previous.data), sampleChip: error, chipText: label(previous.at, error) };
      decorate(o, previous.data.aw);
      applyArtworkRanks(o, D.currentSongRanks?.rows || previous.data.currentSongRanks?.rows, D.currentAlbumRanks?.rows || previous.data.currentAlbumRanks?.rows, D.detailSongHistory || previous.data.detailSongHistory || D.hist || previous.data.hist);
      safelyEnrichMetadata(o, D, c);
      return o;
    } catch { return; }
  };
  const unavailable = (): VM => ({ ...base, unavailable: codes.includes("d1_daily_limit")
    ? "Server tạm nghỉ đến 7:00. Chưa có dữ liệu đã lưu cho màn hình này."
    : `Không tải được dữ liệu từ server${failures.length ? ` (${failures.slice(0, 3).join(", ")})` : ""} và chưa có dữ liệu đã lưu cho màn hình này.` });
  if (st === "err") return savedView(true) || unavailable();
  if (st === "loading") return savedView(failed) || { ...base, isLoading: true };
  try {
    const viewData = cacheableViewData(D);
    const o = { ...base, ...mapServer(c, D), sampleChip: failed, chipText: label(dataAt, failed) };
    decorate(o, D.aw);
    applyArtworkRanks(o, D.currentSongRanks?.rows, D.currentAlbumRanks?.rows, D.detailSongHistory || D.hist);
    safelyEnrichMetadata(o, D, c);
    if (!stale && !failed && (previous?.at !== dataAt || !sameResponseReferences(previous?.data,viewData) && JSON.stringify(previous?.data) !== JSON.stringify(viewData))) lastGood.set(viewKey, viewData, dataAt);
    return o;
  } catch (e) {
    const detail = e instanceof Error ? (e.stack || e.message) : String(e);
    console.warn("Không đọc được dữ liệu server cho màn " + c.screen, detail, "payloads:", Object.keys(D).join(","));
    return savedView(true) || unavailable();
  }
}

// Gắn ảnh bìa / avatar từ /artwork: bài theo track_id (tid), album theo "nghệ sĩ␟album" (ak), nghệ sĩ theo tên (an).
function decorate(o: Any, AW: Any) {
  if (!AW) return;
  o.artwork = AW;
  const T = AW.tracks || {}, A = AW.artists || {}, B = AW.albums || {};
  const fix = (r: Any) => { if (r && typeof r === "object") r.img = (r.tid && T[r.tid]) || (r.ak && B[r.ak]) || (r.an && A[r.an]) || ""; };
  ["recent", "top5", "top15", "hourArtists", "top100Rows", "artistRows", "periodRows", "albums", "results", "fRes", "shareCards", "weekTable", "rising", "risingAll"].forEach((k) => (o[k] || []).forEach(fix));
  (o.risingArtists || []).forEach((g: Any) => (g.rows || []).forEach(fix));
  fix(o.monthSummary?.lead);
  (o.monthSummary?.newArtists || []).forEach(fix);
  (o.monthSummary?.risingArtists || []).forEach(fix);
  (o.monthSummary?.newSongs || []).forEach(fix);
  (o.monthSummary?.risingSongs || []).forEach(fix);
  (o.monthSummary?.blocks || []).forEach((b: Any) => (b.rows || []).forEach(fix));
  fix(o.song);
  fix(o.artist);
  (o.artist?.songs || []).forEach(fix);
}


// Metadata comes from the live library. Only Date Modified / catalog track counts
// supplement the API from the user's Apple export, without confusing sync time with update date.
function enrichMetadata(o: Any, D: Any, c: Ctx) {
  if (!D.metadataRows) return;
  const index = metadataIndex(D.metadataRows, D.metadataStats, exportMetadata.items);
  const today = vnToday();
  // Latest logged play wins over an older Apple Music export, independent of the viewed period.
  const rememberPlay = (id: string, value: Any) => {
    const track = index.tracks[id];
    if (track && Number.isFinite(toMs(value)) && (!Number.isFinite(toMs(track.last_played)) || toMs(value) > toMs(track.last_played))) track.last_played = value;
  };
  (D.hist?.rows || []).forEach((r: Any) => rememberPlay(r.track_id, r.lastPlayedAt));
  (D.recent?.rows || []).forEach((r: Any) => rememberPlay(r.track_id, r.played_at ?? `${r.play_date}T${pad(r.hour || 0)}:${pad(r.minute || 0)}:00+07:00`));
  if (o.song?.tid) rememberPlay(o.song.tid, D.song?.plays?.last);
  o.nowPlayingLibrary = Object.values(index.tracks).map((t: Any) => ({
    title: t.title,
    artist: t.artist,
    album: t.album,
    image: D.aw?.tracks?.[t.id] || D.aw?.albums?.[albumKey(t)],
    libraryTrackId: t.id,
    persistentId: t.apple_pid,
    apple_pid: t.apple_pid,
    duration_s: t.duration_s,
    year: t.year,
    date_added: t.date_added,
    last_played: t.last_played,
    my_rating: t.my_rating,
    plays: t.allPlays,
    allTimeRank: o.currentSongRanks?.[t.id],
    allTimeChange: o.currentSongChanges?.[t.id],
    allTimeComparison: o.currentSongComparisons?.[t.id],
    in_library: t.in_library,
  }));
  if (o.playlistLibrary) o.playlistLibrary = o.playlistLibrary.map((row: Any) => {
    const t = index.tracks[row.id] || row;
    const hours = t.allHours ?? ((t.allPlays ?? row.allPlays ?? 0) * (t.duration_s || row.duration_s || 0) / 3600);
    return {
      ...row,
      allPlays: t.allPlays ?? row.allPlays,
      allHours: hours,
      duration_s: t.duration_s || row.duration_s,
      year: t.year || row.year,
      date_added: t.date_added || row.date_added,
      last_played: t.last_played || row.last_played,
      my_rating: t.my_rating ?? row.my_rating,
      metadata: trackMetadata({...t,allHours:hours}, today),
      titleTone: ratingTone(t.my_rating || 0),
      artistTone: artistTone(index.artists[t.album_artist || t.artist]?.allHours || 0),
      img: D.aw?.tracks?.[t.id] || D.aw?.albums?.[albumKey(t)],
      allTimeRank: o.currentSongRanks?.[t.id] ?? row.allTimeRank,
      allTimeChange: o.currentSongChanges?.[t.id] ?? row.allTimeChange,
      allTimeComparison: o.currentSongComparisons?.[t.id] ?? row.allTimeComparison,
      originalAlbum: t.album || row.album,
      albumArtist: t.album_artist || row.album_artist || row.artist,
    };
  });
  if(c.screen === "artist" && o.artist) {
    const names=[...new Set(D.metadataRows.filter((t:Any)=>(t.album_artist || t.artist)===o.artist.name && t.album && t.in_library!==0).map((t:Any)=>albumKey(t)))]
      .filter((key:string)=>!key.split(US)[1]?.toLocaleLowerCase().includes('archive'));
    o.artist.albums=names.map((key:any)=>{
      const [artist,title]=key.split(US),group=index.albums[key];
      const years=group?.years ? [...group.years].map(Number).filter((year:number)=>year>0) : [];
      const year=years.length ? Math.min(...years) : 0;
      return {ak:key,title,artist,year,ini:ini(title),img:D.aw?.albums?.[key],metadata:collectionMetadata(group,today,true),
        allTimeMetric:group?.allPlays>0?`${vn(group.allPlays)} lượt`:undefined,
        allTimeListening:group?.allPlays>0?fmtH(group.allHours || 0):undefined,
        artistTone:artistTone(index.artists[artist]?.allHours || 0),
        allTimeRank:D.currentAlbumRanks?.rows?.find((r:Any)=>r.album_artist+US+r.album===key)?.rank,onTap:()=>c.go("album",albumId(artist,title))};
    }).sort((a:Any,b:Any)=>(a.year||Number.MAX_SAFE_INTEGER)-(b.year||Number.MAX_SAFE_INTEGER)||a.title.localeCompare(b.title));
    o.artist.allSongs=Object.values(index.tracks).filter((track:Any)=>track.in_library!==0&&(
      fold(track.artist)===fold(o.artist.name)||fold(track.album_artist)===fold(o.artist.name)
    )).sort((a:Any,b:Any)=>(Number(a.year)||Number.MAX_SAFE_INTEGER)-(Number(b.year)||Number.MAX_SAFE_INTEGER)
      ||String(a.album||'').localeCompare(String(b.album||''))||(Number(a.disc)||0)-(Number(b.disc)||0)
      ||(Number(a.track)||Number(a.track_number)||0)-(Number(b.track)||Number(b.track_number)||0)
      ||String(a.title||'').localeCompare(String(b.title||''))).map((track:Any)=>({
        tid:track.id,title:track.title,artist:track.artist||o.artist.name,album:track.album,albumArtist:track.album_artist||track.artist,
        year:track.year,metric:`${vn(track.allPlays||0)} lượt`,listening:fmtH(track.allHours||0),onTap:track.id?()=>c.go("song",track.id):()=>{},
      }));
  }
  if(c.screen === "album" && o.album) {
    o.album.ak ||= albumKey({album_artist:o.album.artist,album:o.album.title});
    o.album.artistTone=artistTone(index.artists[o.album.artist]?.allHours || 0);
  }
  const fix = (r: Any) => {
    if (!r) return;
    const t = index.tracks[r.tid];
    const a = index.artists[r.an], album = index.albums[r.ak];
    if (t) {
      r.gone = t.in_library === 0;
      r.duration_s = t.duration_s;
      r.metadata = trackMetadata(t, today);
      r.titleTone = ratingTone(t.my_rating || 0);
      r.artistTone = artistTone(index.artists[t.album_artist || t.artist]?.allHours || 0);
      r.ini ||= ini(t.title);
      r.applePid = t.apple_pid || t.persistentId;
      r.rankWeight = t.rank_weight;
      r.originalAlbum = t.album;
      r.album = canonicalAlbum(t.album_artist || t.artist || '',t.album || '');
      r.artist ||= t.artist;
      r.albumArtist = t.album_artist || t.artist;
      r.allTimeMetric = t.allPlays == null ? undefined : `${vn(t.allPlays)} lượt`;
      r.allTimeListening = t.allHours == null ? undefined : fmtH(t.allHours);
      r.allTimeMetadata = trackMetadata(t, today);
      const trackAlbum=index.albums[albumKey(t)];
      r.albumAllTimeMetric=trackAlbum?.allPlays>0?`${vn(trackAlbum.allPlays)} lượt`:undefined;
      r.albumAllTimeListening=trackAlbum?.allPlays>0?fmtH(trackAlbum.allHours || 0):undefined;
      if(t.album)r.goAlbum=()=>c.go("album",albumId(t.album_artist || t.artist || "",t.album));
      if (!r.metric && !r.v && t.allPlays != null) r.metric = `${vn(t.allPlays)} lượt`;
      if (r.periodPlays != null && t.duration_s > 0) r.listening = fmtH(r.periodPlays * t.duration_s / 3600);
      // Scoped views always supply their own listening time.
      if (r.listening == null && t.allHours != null) r.listening = fmtH(t.allHours);
    } else if (a || album) {
      const collection=a || album;
      r.metadata = collectionMetadata(collection, today, !!album, r.listened);
      r.allTimeMetric = collection.allPlays == null ? undefined : `${vn(collection.allPlays)} lượt`;
      r.allTimeListening = collection.allHours == null ? undefined : fmtH(collection.allHours);
      r.allTimeMetadata = collectionMetadata(collection, today, !!album, collection.listened);
      if (a) {
        r.titleTone = artistTone(a.allHours || 0);
        r.libraryTracks = a.libraryTracks;
        r.listenedTracks ??= a.listened;
      }
    }
    if(!r.goAlbum && r.album && (r.albumArtist || r.artist))r.goAlbum=()=>c.go("album",albumId(r.albumArtist || r.artist,r.album));
  };
  ["recent", "top5", "top15", "top100Rows", "artistRows", "periodRows", "hourArtists", "albums", "results", "rising", "risingAll"].forEach(k => (o[k] || []).forEach(fix));
  (o.risingArtists || []).forEach((g: Any) => (g.rows || []).forEach(fix));
  fix(o.song); fix(o.artist); fix(o.album); (o.artist?.songs || []).forEach(fix); (o.artist?.allSongs || []).forEach(fix); (o.album?.songs || []).forEach(fix);
  const attachSectionQueue=(rows:Any[],label:string)=>{
    const items=rows.map(row=>({persistentId:row?.applePid || row?.apple_pid || row?.persistentId,artist:row?.artist,title:row?.title,album:row?.originalAlbum || row?.album}));
    rows.forEach((row,index)=>{
      if(row?.tid && items[index].persistentId && !row.queueContext)row.queueContext={kind:'section',items,index,label};
    });
  };
  attachSectionQueue(o.recent || [],'Vừa nghe');
  attachSectionQueue(o.top5 || [],o.top5Title || 'Top songs');
  attachSectionQueue(o.top15 || [],o.topSongsTitle || 'Top songs');
  attachSectionQueue(o.top100Rows || [],'Top 100 bài All time');
  attachSectionQueue((o.periodRows || []).slice(0,listDisplayLimit(false,c.p.periodListSize)),o.topPeriodTitle || 'Top theo kỳ');
  attachSectionQueue(o.results || [],'Kết quả tìm kiếm');
  attachSectionQueue(o.fRes || [],o.findLabel || 'Kết quả tìm kiếm');
  attachSectionQueue(o.rising || [],'Bài hát đang lên');
  attachSectionQueue(o.risingAll || [],'Bài hát đang lên');
  attachSectionQueue(o.artist?.songs || [],o.artist?.name || 'Bài hát của nghệ sĩ');
  attachSectionQueue(o.artist?.allSongs || [],o.artist?.name || 'Bài hát của nghệ sĩ');
  attachSectionQueue(o.album?.songs || [],o.album?.title || 'Bài hát trong album');
  const t = index.tracks[o.song?.tid];
  if (t) {
    const extra = [
      t.album && { k: 'Album', v: canonicalAlbum(t.album_artist || t.artist || '',t.album), onTap: o.song.goAlbum },
      t.releaseDate && { k: 'Ngày phát hành', v: dmy(t.releaseDate), tone: releaseTone(Number(t.releaseDate.slice(0, 4))) },
      t.duration_s && { k: 'Độ dài', v: durationLabel(t.duration_s), tone: durationTone(t.duration_s, t.allHours || 0) },
      t.genre && { k: 'Thể loại', v: t.genre },
    ].filter(Boolean);
    o.song.info = [...extra, ...o.song.info];
  }
}

function safelyEnrichMetadata(o: Any, D: Any, c: Ctx) {
  try {
    enrichMetadata(o, D, c);
  } catch (error) {
    const value = error as Any;
    console.warn(
      `Không bổ sung được metadata cho màn ${c.screen}`,
      value?.name || typeof error,
      value?.message || String(error),
      value?.stack || "",
    );
  }
}
