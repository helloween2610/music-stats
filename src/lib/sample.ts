// @ts-nocheck
// Dữ liệu mẫu, port nguyên từ bản thiết kế. Dùng khi không kết nối được server
// (kèm chip "Dữ liệu mẫu · không kết nối được server").
// Thứ tự gọi rnd() được giữ nguyên để số khớp với bản thiết kế.
import { vn, d1, fmtH, slug, pad } from "./fmt";

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const hashS = s => { let x = 2166136261; for (const c of s) { x ^= c.codePointAt(0); x = Math.imul(x, 16777619); } return ((x >>> 0) % 2147483645) + 1; };
const mkR = s => { let v = hashS(s); return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; }; };
export const shuffle = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export function rankHistR(end, len, c, r = rnd) {
  if (c === 'new') return [end + 5, end];
  const a = [end]; let x = end;
  for (let i = 1; i < len; i++) { x = x + (c > 0 ? r() * 3 + 0.3 : c < 0 ? -r() * 2 : (r() - 0.5) * 2.2); a.unshift(Math.max(1, Math.round(x))); }
  return a;
}

export const TODAY = '29/09/2026';
export const M = ['04/24', '05/24', '06/24', '07/24', '08/24', '09/24', '10/24', '11/24', '12/24', '01/25', '02/25', '03/25', '04/25', '05/25', '06/25', '07/25', '08/25', '09/25', '10/25', '11/25', '12/25', '01/26', '02/26', '03/26', '04/26', '05/26', '06/26', '07/26', '08/26', '09/26'];
export const P = [1012, 1204, 686, 473, 764, 479, 448, 298, 437, 647, 1015, 660, 530, 307, 182, 689, 628, 487, 616, 519, 506, 247, 131, 173, 85, 73, 177, 103, 225, 210];
export const PRE = 8323;
export const GIVEN_H = { 0: 88.8, 1: 106.6, 10: 86.5, 15: 59.5, 25: 6.6, 26: 16.6, 27: 9, 28: 19.6, 29: 18 };
export const HRS = P.map((v, i) => GIVEN_H[i] ?? Math.round(v * 0.085 * 10) / 10);
export const M14 = M.slice(-14), LH = HRS.slice(-14);
export const toDays = d => { const [dd, mm, yy] = d.split('/').map(Number); return Math.round((Date.UTC(2026, 8, 29) - Date.UTC(yy, mm - 1, dd)) / 864e5); };
const FLAG = { 'Aephanemer': '*', 'Wintersun': '*', 'I Am No Hero': '*', 'In Flames': '*', 'Scorpions': '!!!' };
export const fl = n => ({ hot: FLAG[n] === '*', cold: FLAG[n] === '!!!' });
export const NOFL = { hot: false, cold: false };
const p1 = (v, j) => j < 3 ? d1(v) : vn(v);

export const SONGS = [
  { t: "Sisyphus' Bliss", a: 'Aephanemer', n: 10, c: 2 },
  { t: 'Dialogue With The Stars', a: 'In Flames', n: 9, c: 'new' },
  { t: 'Memento Mori 2.0', a: 'Aephanemer', n: 8, c: 5 },
  { t: 'Unstoppable', a: 'Aephanemer', n: 8, c: -1 },
  { t: 'Gilgamesh 1.1', a: 'Aephanemer', n: 7, c: 0 },
  { t: 'The Call of the Wild', a: 'Aephanemer', n: 7, c: 1 },
  { t: 'Inner Storm 1.1', a: 'Aephanemer', n: 6, c: -2 },
  { t: 'Who You Really Are', a: '', n: 4, c: 'new' }];
SONGS.forEach((s, i) => { s.hist = rankHistR(i + 1, 8, s.c); });
const ARTM = [
  { t: 'Aephanemer', a: '24 bài', n: 68, c: 0 }, { t: 'Sopor Aeternus', a: '11 bài', n: 37, c: 3 }, { t: 'In Flames', a: '9 bài', n: 31, c: 4 }, { t: 'Opeth', a: '8 bài', n: 14, c: -1 },
  { t: 'Týr', a: '6 bài', n: 12, c: 1 }, { t: 'MONO', a: '5 bài', n: 11, c: -3 }, { t: 'Soilwork', a: '4 bài', n: 9, c: 'new' }, { t: 'Wintersun', a: '4 bài', n: 8, c: -2 }];
export const PERIODS = ['Tuần', '7 ngày', 'Tháng', '1 tháng', '100 ngày', 'Từ 04/2024', 'All time'];
const PF = { 'Tuần': 0.3, '7 ngày': 0.35, 'Tháng': 0.85, '1 tháng': 1, '100 ngày': 3.1, 'Từ 04/2024': 17, 'All time': 24 };

export const TOP100 = [
  ['One With the Shadows 2.2', '', 0, 20, '#1 · T08/24', 22], ['When You Sat by Your Window Pane', '', 1, 19, '#1 · T11/24', 21], ['Burial at Sea', 'MONO', -1, 19, '#2 · T06/24', 22],
  ['Sons of Winter and Stars 2.1', 'Wintersun', 2, 18, '#3 · T02/25', 14], ['Stars', '', 0, 17, '#4 · T09/24', 19], ['Time 2.1', 'Wintersun', -2, 17, '#4 · T05/25', 16],
  ['The Way of the Fire 2.3', '', 3, 16, '#7 · T05/26', 11], ['If I Should Die 1.2', 'Aephanemer', 5, 16, '#8 · T05/26', 9], ['A Dream of Wilderness 1.1', '', 'new', 15, '#9 · T05/26', 1], ['Moonlight', '', -1, 15, '#6 · T12/24', 17],
  ['Ashes in the Snow', 'MONO', 1, 15, '#9 · T03/25', 15], ['Starchild', 'Wintersun', -1, 15, '#8 · T10/24', 18], ['Ghost Love Score', 'Nightwish', 0, 14, '#10 · T01/25', 13], ["Sisyphus' Bliss", 'Aephanemer', 4, 14, '#14 · T09/26', 6], ['Ormurin Langi', 'Týr', 'new', 14, '#15 · T09/26', 1]
].map(([t, a, c, lv, pk, m], i) => ({ t, a, c, lvn: lv, lv: 'lv' + lv, peak: 'Cao nhất ' + pk, months: m + ' tháng trong top 100', hist: c === 'new' ? [24, 17, 9] : rankHistR(i + 1, 18, c) }));

export const ART = [['MONO', 1913, 272.8, '17/09', 38], ['Aephanemer', 2878, 257.6, '29/09', 44], ['Wintersun', 1241, 173.3, '27/09', 31], ['No Clear Mind', 1727, 145.0, '25/07', 22], ['Kalmah', 895, 81.6, '31/08', 57], ['I Am No Hero', 730, 78.3, '16/09', 19], ['Týr', 739, 69.6, '29/09', 41], ['Epica', 745, 60.6, '18/09', 63], ['Scorpions', 775, 60.4, '19/02', 38], ['Nightwish', 642, 57.2, '18/09', 49]]
  .map(([name, plays, hrs, last, n]) => ({ name, plays, hrs, last, n, sp: Array.from({ length: 12 }, () => rnd() * hrs / 20 + hrs / 60) }));

export const PT_L = ['Đánh giá bài', 'Hạng All time', 'Hạng từ 04/2024', 'Thành tích tuần', 'Thành tích tháng', 'Thành tích năm', 'Album top 30', 'Bài top 100'];
const PT_GIVEN = [['Aephanemer', 97.2, [11.4, 9.3, 11.5, 13, 16, 4, 5, 27]], ['MONO', 79.6, [13.4, 9.7, 10.5, 10, 13, 3, 7, 13]], ['Wintersun', 76.4, [8.4, 9.0, 11.0, 12, 15, 5, 5, 11]], ['Kalmah', 59.7, [8.3, 8.3, 10.0, 11, 14, 0, 1, 7]], ['Dark Tranquillity', 45.9, [5.7, 5.7, 9.5, 6, 11, 1, 1, 6]], ['Epica', 40.6, [5.3, 7.3, 9.0, 1, 11, 2, 0, 5]]];
const PT_MORE = ['No Clear Mind', 'I Am No Hero', 'Týr', 'Nightwish', 'In Flames', 'Scorpions', 'Opeth', 'Sopor Aeternus', 'Insomnium', 'Omnium Gatherum', 'Soilwork', 'Ensiferum', 'Amorphis', 'At the Gates', 'Eluveitie', 'Children of Bodom', 'Mors Principium Est', 'Wolfheart', 'Persefone', 'Ne Obliviscaris', 'Alcest', 'Within Temptation', 'Lacuna Coil', 'Arch Enemy'];
export const POINTS = PT_GIVEN.map(([name, pts, parts]) => ({ name, pts, parts })).concat(PT_MORE.map((name, k) => {
  const r = mkR('pt' + name), target = 38 - k * 1.1, w = [1, 1, 1.2, 0.8, 1.1, 0.3, 0.3, 0.9].map(x => x * (0.5 + r())), sw = w.reduce((a, b) => a + b, 0);
  const parts = w.map((x, j) => j < 3 ? Math.round(target * x / sw * 10) / 10 : Math.round(target * x / sw));
  return { name, parts, pts: Math.round(parts.reduce((a, b) => a + b, 0) * 10) / 10 };
})).sort((a, b) => b.pts - a.pts).map((p, k) => ({ ...p, rank: k + 1 }));
export const PT_MAX = PT_L.map((_, j) => Math.max(...POINTS.map(p => p.parts[j])) || 1);
export const PTS = Object.fromEntries(POINTS.map(p => [p.name, p]));
export const partVals = x => PT_L.map((l, j) => ({ label: l, v: p1(x.parts[j], j), pct: x.parts[j] / PT_MAX[j] * 100 }));

export const RISING = [
  { pos: 16, t: 'If I Should Die 1.2', a: 'Aephanemer', path: [['T02/25', 46], ['T03/25', 43], ['T07/25', 37], ['T11/25', 31], ['T02/26', 28], ['T05/26', 25]] },
  { pos: 23, t: 'Persephone', a: 'Opeth', path: [['T06/25', 61], ['T09/25', 48], ['T12/25', 39], ['T03/26', 30], ['T05/26', 23]] },
  { pos: 31, t: 'Hel Hath No Fury', a: 'Týr', path: [['T01/26', 72], ['T03/26', 50], ['T05/26', 31]] },
  { pos: 40, t: 'Le Roi a fait battre tambour', a: 'Les Petits Chanteurs À La Croix De Bois', path: [['T10/25', 80], ['T11/25', 65], ['T12/25', 53], ['T02/26', 47], ['T04/26', 43], ['T05/26', 40]] }];
export const RART = [
  { month: 'T09/26', rows: [['Sopor Aeternus', '#11 ← #12'], ['In Flames', '#15 ← #17'], ['Týr', '#7 ← #8']] },
  { month: 'T08/26', rows: [['Opeth', '#24 ← #27'], ['Soilwork', '#41 ← #46']] }];
export const BL = ['10/25', '11/25', '12/25', '01/26', '02/26', '03/26', '04/26', '05/26', '06/26', '07/26', '08/26', '09/26'];
export const BUMP = TOP100.slice(0, 10).map((s, i) => ({ name: s.t, ranks: rankHistR(i + 1, 12, i % 3 === 0 ? 1 : i % 3 === 1 ? 0 : -1).map(v => Math.min(11, v)), color: i < 8 ? `var(--c${i + 1})` : 'var(--text3)' }));

const GENRES = [['Post-rock', 4812], ['Melodeath Metal', 4120], ['Melodeath Symp. Metal', 3655], ['Symp. Metal', 2410], ['Post-rock Vocal', 1802], ['Melodeath Neo-folk Metal', 1240], ['Viking / Folk Metal', 1105], ['Nhạc Việt', 980], ['Gothic Rock', 812], ['Thrash Metal', 640]];
const GC = [[2005, 7, 60], [2008, 8, 55], [2014, 6, 40], [2007, 7, 35], [2012, 6, 20], [2016, 5, 18], [2010, 6, 22], [2000, 12, 15]];
export const YEARS = Array.from({ length: 58 }, (_, i) => 1969 + i);
export const AREA = GC.map(([c, sd, a], i) => ({ name: GENRES[i][0], color: `var(--c${i + 1})`, vals: YEARS.map(y => Math.round(a * Math.exp(-0.5 * ((y - c) / sd) ** 2) * (0.75 + rnd() * 0.5))) }));
export const AREA_T = YEARS.map((_, i) => AREA.reduce((a, s) => a + s.vals[i], 0));
export const ALB = [['TIME', 'Wintersun', 104.1], ['Prokopton', 'Aephanemer', 98.1], ['Mets', 'No Clear Mind', 91.7], ['Nights of Wonder', 'I Am No Hero', 71.6], ['A Dream of Wilderness', 'Aephanemer', 69.9], ['Hymn to the Immortal Wind – Anniversary Edition', 'MONO', 58.4], ['Utopie', 'Aephanemer', 47.2], ['Wintersun 2.0', 'Wintersun', 36.3], ['Dream is Destiny', 'No Clear Mind', 31.3], ['You Are There', 'MONO', 29.3]];
export const albLv = hh => hh >= 24 ? 3 : hh >= 5 ? 2 : 1;
export const STATS = { 'All time': [22334, 3012, 411, 169, 73], 'Từ 04/2024': [15098, 2667, 382, 163, 70], 'Năm': [1424, 457, 95, 61, 34], 'Tháng': [210, 114, 40, 31, 19] };
export const DAYV = (() => { const r = Array.from({ length: 29 }, () => 2 + rnd() * 12), s = r.reduce((a, b) => a + b, 0); return r.map(v => Math.round(v / s * 210)).concat([0]); })();
export const HOURV = (() => { const r = Array.from({ length: 24 }, (_, i) => (i < 7 ? 0.3 : 1) * (1 + 3 * Math.exp(-0.5 * ((i - 22) / 2) ** 2) + rnd())), s = r.reduce((a, b) => a + b, 0); return r.map(v => Math.round(v / s * 210)); })();
export const WDL = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], WDF = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
export const WDV = [24, 33, 19, 33, 22, 51, 28];
export const WEEK = [[12, 8, 16], [14, 18, 15], null, null, null, null, null];
export const WEEK_ART = [['In Flames', 14, 8, 1.6], ['Marcin Jakubek', 1, 0, 0.4], ['Aephanemer', 0, 3, 0.2], ['Opeth', 0, 1, 0.1]];
const WEEK_RANK = [['In Flames', 22, 1, 7], ['Aephanemer', 3, -1, 3], ['Marcin Jakubek', 1, 'new', 1], ['Opeth', 1, 0, 1], ['Týr', 1, 2, 1], ['Soilwork', 1, 'new', 1], ['At the Gates', 1, 'new', 1], ['Les Petits Chanteurs À La Croix De Bois', 1, -3, 1]];
export const RECENT = [['Hel Hath No Fury', 'Týr', '23:12'], ['Le Roi a fait battre tambour', 'Les Petits Chanteurs À La Croix De Bois', '22:56', 1], ['Persephone', 'Opeth', '22:52'], ['Centro De Predominio', 'Soilwork', '22:45'], ['And the World Returned', 'At the Gates', '22:41']];
export const WEEK10 = [['Dialogue With The Stars', 'In Flames', 6], ['Timeless', 'In Flames', 5], ['Only for the Weak', 'In Flames', 4], ['Alias', 'In Flames', 3], ["Sisyphus' Bliss", 'Aephanemer', 2], ['Cloud Connected', 'In Flames', 2], ['Persephone', 'Opeth', 1], ['Hel Hath No Fury', 'Týr', 1], ['Centro De Predominio', 'Soilwork', 1], ['And the World Returned', 'At the Gates', 1]];
const WEEK_CHG = ['new', 2, 'new', 1, -2, 0, 'new', 3];
const MONTH_S = [["Sisyphus' Bliss (2026 Remaster)", 25, 'new'], ['Dialogue With The Stars', 9, 'new'], ['Memento Mori 2.0 (2026 Remaster)', 8, 'new'], ['Unstoppable', 8, -1], ['Gilgamesh 1.1', 7, 0], ['The Call of the Wild', 7, 2], ['Inner Storm 1.1', 6, -3], ['Who You Really Are', 4, 'new']];
const MONTH_A = [['Aephanemer', 71, 0, 27], ['In Flames', 33, 3, 9], ['Wintersun', 22, -1, 8], ['Sopor Aeternus', 18, 2, 6], ['Opeth', 12, -2, 5], ['Týr', 10, 1, 4], ['MONO', 8, -3, 4], ['Soilwork', 6, 'new', 3]];
const SONG_P = [3, 5, 8, 6, 11, 14, 9, 12, 15, 18, 13, 16, 20, 8], SONG_R = [88, 74, 66, 58, 51, 47, 44, 40, 37, 35, 33, 32, 32, 27];
const AH = LH.map((v, k) => Math.round(v * (0.14 + 0.2 * Math.abs(Math.sin(k * 1.7))) * 10) / 10);
const AW26 = [6, 9, 4, 12, 8, 15, 11, 7, 14, 18, 9, 5, 10, 13, 8, 16, 20, 12, 9, 14, 22, 17, 11, 19, 24, 3];
export const AWL = AW26.map((_, k) => k % 5 === 0 ? 'W' + (15 + k) : '');
export const AWLF = AW26.map((_, k) => 'Tuần ' + (15 + k) + (k === 25 ? ' (đang diễn ra)' : ''));
export const UNMATCHED = [
  { t: 'Nhật Ký Của Mẹ (Orchestra)', a: 'Nguyễn Văn Chung & Nguyễn Duyên Quỳnh', plays: 11, sugg: [['Nhật Ký Của Mẹ (Orchestra)', 'Nguyen Van Chung & Nguyễn Duyên Quỳnh']] },
  { t: 'Dead Eternity', a: 'In Flames', plays: 7, sugg: [] },
  { t: 'Timeless', a: 'In Flames', plays: 6, sugg: [['Timeless', 'INSTRU. PIANO']] },
  { t: 'Strider', a: 'Aephanemer', plays: 5, sugg: [['Strider 1.1', 'Aephanemer'], ['Strider (Instrumental)', 'Aephanemer']] },
  { t: 'Le Roi a fait battre tambour (Live)', a: 'Les Petits Chanteurs À La Croix De Bois', plays: 5, sugg: [['Le Roi a fait battre tambour', 'Les Petits Chanteurs À La Croix De Bois']] },
  { t: 'Persephone (Remastered)', a: 'Opeth', plays: 4, sugg: [['Persephone', 'Opeth'], ['Persephone (Slight Return)', 'Opeth'], ['Persephone (Live)', 'Opeth']] },
  { t: 'Ghost of Perdition (Live)', a: 'Opeth', plays: 3, sugg: [['Ghost of Perdition', 'Opeth']] },
  { t: 'Ordinary Story (Demo)', a: 'In Flames', plays: 2, sugg: [] }];
const EXTRA = [['Strider 1.1', 'Aephanemer'], ['Ghost of Perdition', 'Opeth'], ['Stabbing the Drama', 'Soilwork'], ['Slaughter of the Soul', 'At the Gates'], ['Hollow Heart', 'Kalmah'], ['Still Loving You', 'Scorpions'], ['Wind of Change', 'Scorpions'], ['Cry for the Moon', 'Epica'], ['Storm the Sorrow', 'Epica'], ['Nemo', 'Nightwish'], ['Requiem for Hell', 'MONO'], ['Colony', 'In Flames'], ['Ordinary Story', 'In Flames'], ['Coerced Coexistence', 'In Flames'], ['Clayman', 'In Flames']];

// Bảng bài hát (SDB) và nghệ sĩ (ADB) mẫu, khoá theo slug.
const SONG_SRC = [];
const addS = (t, a) => { if (!SONG_SRC.find(x => slug(x[0]) === slug(t))) SONG_SRC.push([t, a || '']); };
SONGS.forEach(s => addS(s.t, s.a)); TOP100.forEach(s => addS(s.t, s.a)); RISING.forEach(s => addS(s.t, s.a));
WEEK10.forEach(([t, a]) => addS(t, a)); RECENT.forEach(([t, a]) => addS(t, a)); EXTRA.forEach(([t, a]) => addS(t, a));
MONTH_S.forEach(([t]) => addS(t, 'Aephanemer'));
UNMATCHED.forEach(u => u.sugg.forEach(([t, a]) => addS(t, a)));
export const SDB = {};
SONG_SRC.forEach(([t, a]) => {
  const id = slug(t), r = mkR('s' + id), ti = TOP100.findIndex(x => x.t === t), ri = RISING.find(x => x.t === t), mi = SONGS.find(x => x.t === t), rc = RECENT.find(x => x[0] === t);
  let rank, chg, lv;
  if (ti >= 0) { rank = ti + 1; chg = TOP100[ti].c; lv = TOP100[ti].lvn; }
  else if (ri) { rank = ri.pos; const pp = ri.path, last = pp[pp.length - 1][1]; chg = (last === rank ? pp[pp.length - 2][1] : last) - rank; }
  else { rank = 28 + Math.floor(r() * 240); chg = [2, 1, 0, -1, -3, 'new', 3, -2][Math.floor(r() * 8)]; }
  if (lv == null) lv = Math.max(3, Math.min(20, Math.round(16.5 - rank / 12)));
  const score = Math.max(0, Math.min(10, Math.round(lv * 0.42 + r() * 2.4)));
  const total = ti >= 0 ? 260 - 5 * ti : Math.round(185 * Math.pow(16 / rank, 0.55));
  const base = total / 40, months = M14.map(() => Math.max(0, Math.round(base * (0.4 + r() * 1.2))));
  if (mi) months[13] = mi.n;
  const ranks = rankHistR(rank, 14, chg === 'new' ? 6 : chg, r);
  const last = rc ? `29/09/2026, ${rc[2]}` : mi ? `${pad(1 + Math.floor(r() * 28))}/09/2026, ${pad(18 + Math.floor(r() * 6))}:${pad(Math.floor(r() * 60))}` : `${pad(1 + Math.floor(r() * 28))}/${pad(1 + Math.floor(r() * 8))}/2026`;
  const addY = 2019 + Math.floor(r() * 7), added = `${pad(1 + Math.floor(r() * 28))}/${pad(1 + Math.floor(r() * 12))}/${addY}`;
  SDB[id] = { id, t, a, lv, rank, chg, total, months, ranks, added, last, skip: Math.floor(r() * 9), mins: Math.round(total * 4.6), ranked: true, scoreV: String(score), scoreL: 'Điểm /10', note: '' };
});
Object.assign(SDB['memento-mori-2-0'], { lv: 14, scoreV: '9', rank: 27, chg: 5, total: 186, months: SONG_P, ranks: SONG_R, added: '12/03/2024', last: '28/09/2026, 22:30', skip: 4, mins: 860 });
Object.assign(SDB['sisyphus-bliss-2026-remaster'], { lv: 3, scoreV: '2', rank: 178, chg: null, total: 25, months: M14.map((_, k) => k === 13 ? 25 : 0), ranks: [178], added: '19/09/2026', days: 12, last: '25/09/2026', skip: 0, mins: 98 });
Object.assign(SDB['still-loving-you'], { scoreV: '★ 4/5', scoreL: 'Đánh giá Apple', ranked: false, note: 'Stop rating' });
Object.assign(SDB['requiem-for-hell'], { ranked: false, note: 'MONO dưới 450 phút' });
Object.assign(SDB['stabbing-the-drama'], { scoreV: '–', added: '29/09/2026', note: 'Thêm vào thư viện hôm nay' });

const ART_NAMES = [];
const addA = n => { if (n && !ART_NAMES.includes(n)) ART_NAMES.push(n); };
ART.forEach(a => addA(a.name)); POINTS.forEach(p => addA(p.name)); ARTM.forEach(a => addA(a.t)); RART.forEach(g => g.rows.forEach(r => addA(r[0]))); WEEK_RANK.forEach(w => addA(w[0])); SONG_SRC.forEach(s => addA(s[1])); ALB.forEach(a => addA(a[1]));
export const ADB = {};
ART_NAMES.forEach(name => {
  const id = slug(name), r = mkR('a' + id), art = ART.find(x => x.name === name), rart = RART.flatMap(g => g.rows).find(x => x[0] === name);
  const allRank = art ? ART.indexOf(art) + 1 : rart ? parseInt(rart[1].slice(1)) : 11 + Math.floor(r() * 120);
  const plays = art ? art.plays : Math.round(640 * Math.pow(10 / allRank, 0.9));
  const hrs = art ? art.hrs : Math.round(plays * 0.08 * 10) / 10;
  const nS = Object.values(SDB).filter(s => s.a === name).length;
  const nSongs = art ? art.n : Math.max(nS, 3 + Math.floor(r() * 25));
  const share = Math.min(0.3, plays / 22334 * 3), wmax = Math.max(2, plays / 120);
  ADB[id] = { id, name, plays, hrs, nSongs, nAlbums: Math.max(1, Math.round(nSongs / 6)), genre: GENRES[Math.floor(r() * GENRES.length)][0], allRank,
    last: art ? art.last : `${pad(1 + Math.floor(r() * 28))}/${pad(1 + Math.floor(r() * 9))}`, gap: 1.5 + Math.round(r() * 200) / 10, days: Math.max(4, Math.round(plays / (6 + r() * 6))),
    hours: LH.map(v => Math.round(v * share * (0.5 + r()) * 10) / 10), weeks: AW26.map(() => Math.round(r() * wmax)) };
});
Object.assign(ADB['aephanemer'], { gap: 3.6, days: 253, hours: AH, weeks: AW26, nAlbums: 8, genre: 'Melodeath Symp. Metal' });
ADB['mono'].genre = 'Post-rock';
Object.values(ADB).forEach(a => { a.songs = Object.values(SDB).filter(s => s.a === a.name).sort((x, y) => y.total - x.total).slice(0, 5).map(s => s.id); });
export const AE_R = { 'Tuần': 2, '7 ngày': 2, 'Tháng': null, '1 tháng': 1, '100 ngày': 1, 'Từ 04/2024': 1 };

// Danh sách xếp hạng mẫu theo từng kỳ.
const SONG_POOL = SONG_SRC.filter(x => x[1]).map(x => slug(x[0]));
const ART_POOL = ART_NAMES.filter(n => ADB[slug(n)].plays > 100).map(slug);
export const PERIOD_DATA = {};
PERIODS.forEach(pd => {
  const r = mkR('p' + pd), f = PF[pd];
  let songs, arts;
  if (pd === '1 tháng') {
    songs = SONGS.map(s => ({ id: slug(s.t), m: s.n + ' lượt', c: s.c }));
    arts = ARTM.map(a => ({ id: slug(a.t), m: a.n + ' lượt', c: a.c, sub: a.a }));
  } else if (pd === 'Tuần') {
    songs = WEEK10.slice(0, 8).map(([t, a, n], k) => ({ id: slug(t), m: n + ' lượt', c: WEEK_CHG[k] }));
    arts = WEEK_RANK.map(([name, n, c, ns]) => ({ id: slug(name), m: n + ' lượt', c, sub: ns + ' bài' }));
  } else if (pd === 'Tháng') {
    songs = MONTH_S.map(([t, n, c]) => ({ id: slug(t), m: n + ' lượt', c }));
    arts = MONTH_A.map(([name, n, c, ns]) => ({ id: slug(name), m: n + ' lượt', c, sub: ns + ' bài' }));
  } else if (pd === 'All time') {
    songs = TOP100.slice(0, 8).map((s, k) => ({ id: slug(s.t), m: vn(260 - 5 * k) + ' lượt', c: s.c, hist: s.hist }));
    const cs = [0, 0, 0, 0, 0, 1, 1, -2, 0, 0];
    arts = ART.slice(0, 8).map((a, k) => ({ id: slug(a.name), m: fmtH(a.hrs), c: cs[k], sub: a.n + ' bài', hist: rankHistR(k + 1, 18, cs[k], r) }));
  } else {
    const ps = shuffle(SONG_POOL, r).slice(0, 8), bs = Math.max(3, 10 * f);
    const ns = ps.map((_, k) => Math.max(1, Math.round(bs * (1 - k * 0.08) * (0.9 + r() * 0.2)))).sort((a, b) => b - a);
    songs = ps.map((id, k) => ({ id, m: vn(ns[k]) + ' lượt', c: 0 }));
    let pa = shuffle(ART_POOL.filter(id => id !== 'aephanemer'), r).slice(0, 7);
    if (AE_R[pd]) pa.splice(AE_R[pd] - 1, 0, 'aephanemer');
    pa = pa.slice(0, 8);
    const ba = Math.max(4, 68 * f), na = pa.map((_, k) => Math.max(1, Math.round(ba * Math.pow(0.8, k) * (0.9 + r() * 0.2)))).sort((a, b) => b - a);
    arts = pa.map((id, k) => ({ id, m: vn(na[k]) + ' lượt', c: 0, sub: Math.max(1, Math.round(na[k] / (3 + r() * 3))) + ' bài' }));
  }
  PERIOD_DATA[pd] = { songs, arts };
});

export const SCOPES = ['All time', 'Từ 04/2024', 'Năm', 'Tháng'];
const SCOPE_F = { 'All time': 1, 'Từ 04/2024': 15098 / 22334, 'Năm': 1424 / 22334, 'Tháng': 210 / 22334 };
export const SCOPE_DATA = {};
SCOPES.forEach(sc => {
  const r = mkR('o' + sc), f = SCOPE_F[sc], all = sc === 'All time', jit = () => 0.7 + r() * 0.6;
  let top15;
  if (all) top15 = TOP100.map((s, k) => ({ id: slug(s.t), v: 260 - 5 * k }));
  else if (sc === 'Tháng') top15 = MONTH_S.map(([t, n]) => ({ id: slug(t), v: n })).concat(shuffle(SONG_POOL.filter(id => !MONTH_S.find(s => slug(s[0]) === id)), r).slice(0, 7).map((id, k) => ({ id, v: [3, 3, 3, 2, 2, 2, 2][k] })));
  else { const top = Math.round(260 * f * 1.25); top15 = shuffle(SONG_POOL, r).slice(0, 15).map((id, k) => ({ id, v: Math.max(1, Math.round(top * Math.pow(0.95, k))) })); }
  const hourArt = ART.map(a => ({ id: slug(a.name), name: a.name, hrs: all ? a.hrs : a.hrs * f * jit(), sp: a.sp })).sort((a, b) => b.hrs - a.hrs);
  const genres = GENRES.map(([n, v], k) => ({ n, k, v: all ? v : Math.max(1, Math.round(v * f * jit())) })).sort((a, b) => b.v - a.v);
  const albums = ALB.map(([t, a, v]) => ({ t, a, v: all ? v : Math.max(0.1, Math.round(v * f * jit() * 10) / 10) })).sort((a, b) => b.v - a.v);
  SCOPE_DATA[sc] = { top15, hourArt, genres, albums };
});
