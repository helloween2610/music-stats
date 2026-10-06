import { toMs, fmtWhen } from './fmt';
import { groupedAlbumKey } from './album-groups';
// Color-only rules from Marvis Preferences.mPref (October 2026).
// Use the Year / Duration / Artist Alltime groups; no rating or selection changes.
export type Tone = 'gray' | 'green' | 'teal' | 'cyan' | 'blue' | 'sage' | 'lime' | 'gold' | 'amber' | 'purple' | 'violet';
export type MetaItem = { text: string; title: string; detail?: string; rule?: string[]; color?: string; tone?: Tone };
export const releaseTone = (year: number): Tone => year >= 2024 ? 'green' : year >= 2020 ? 'gray' : year >= 2010 ? 'cyan' : year >= 2000 ? 'sage' : year >= 1980 ? 'gold' : 'purple';
export const artistTone = (hours: number): Tone => hours >= 240 ? 'purple' : hours >= 168 ? 'gold' : hours >= 120 ? 'sage' : hours >= 72 ? 'cyan' : 'gray';
export const ratingTone = (rating: number): Tone => rating >= 100 ? 'gold' : rating >= 80 ? 'sage' : rating >= 60 ? 'cyan' : 'gray';
export function durationTone(seconds: number, spentHours: number): Tone {
  // Each duration band has its own all-time listening threshold in the export.
  return seconds < 360 ? 'gray'
    : seconds < 480 ? (spentHours >= 2 ? 'blue' : 'cyan')
    : seconds < 600 ? (spentHours >= 3 ? 'lime' : 'sage')
    : seconds < 1200 ? (spentHours >= 4 ? 'amber' : 'gold')
    : (spentHours >= 5 ? 'violet' : 'purple');
}
export function ageMonths(date: string, asOf: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date) || !/^\d{4}-\d{2}-\d{2}/.test(asOf) || date.slice(0,10) > asOf.slice(0,10)) return null;
  const a = date.slice(0,10).split('-').map(Number), b = asOf.slice(0,10).split('-').map(Number);
  return (b[0] - a[0]) * 12 + b[1] - a[1] - (b[2] < a[2] ? 1 : 0);
}
export function addedTone(date: string, asOf: string): Tone {
  const m = ageMonths(date, asOf);
  return m == null ? 'gray' : m < 1 ? 'green' : m < 3 ? 'teal' : m < 12 ? 'gray' : m < 24 ? 'cyan' : m < 36 ? 'sage' : m < 60 ? 'gold' : 'purple';
}
export const durationLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;
export const dateLabel = (date: string) => date.slice(0,10).split('-').reverse().join('/');
// Timestamp inputs retain hours; date-only inputs never invent an exact time.
export function elapsedAgeLabel(date: string | number, asOf: string | number = Date.now() / 1000): string {
  const valid = (value: string | number) => {
    if (typeof value === 'number' || /^\d+$/.test(value)) return Number.isFinite(toMs(value));
    const day = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(toMs(value)) && new Date(day).toISOString().slice(0, 10) === day;
  };
  if (!valid(date) || !valid(asOf)) return '—';
  const start = toMs(date), end = toMs(asOf);
  if (start > end) return '—';
  const localDay = (ms: number) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);
  const months = ageMonths(localDay(start), localDay(end))!;
  if (months >= 12) return `${Math.floor(months / 12)}y`;
  if (months >= 1) return `${months}mo`;
  const days = Math.floor((end - start) / 86400000);
  if (days >= 7) return `${Math.floor(days / 7)}w`;
  if (days >= 1 || typeof date === 'string' && date.length === 10) return `${days}d`;
  return `${Math.floor((end - start) / 3600000)}h`;
}
export const addedAgeLabel = (date: string, asOf?: string | number) => {
  const age = elapsedAgeLabel(date, asOf);
  return age === '—' ? age : '+' + age;
};
// Last Played palette from Songs.mMetadata (LP Song); default has no color override.
export function lastPlayedColor(date: string | number, now: string | number = Date.now() / 1000): string | undefined {
  const age = elapsedAgeLabel(date, now);
  if (age === '—') return undefined;
  const hours = (toMs(now) - toMs(date)) / 3600000;
  if (hours < 12) return '#32c759';
  if (hours < 24) return '#cde8b5';
  const day = (value: string | number) => new Date(toMs(value) + 7 * 3600e3).toISOString().slice(0,10);
  const months = ageMonths(day(date), day(now))!;
  return months >= 12 ? '#5e30eb' : months >= 6 ? '#ff3a30' : months >= 3 ? '#ffe700' : undefined;
}
export const exportKey = (t: any) => [t.artist, t.album, t.title].map(x => String(x || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')).join('\u001f');
const US = '\u001f';
type Any = any;
export function metadataIndex(rows: Any[], all: Any, supplemental: Record<string, Any>) {
  const songs = new Map<string, Any>((all?.rows || []).map((r: Any) => [r.track_id, r]));
  const tracks: Record<string, Any> = {}, artists: Record<string, Any> = {}, albums: Record<string, Any> = {};
  const merge = (g: Any, t: Any) => {
    if (t.date_added && (!g.added || t.date_added < g.added)) g.added = t.date_added;
    // Date Modified from the export, never sync time or last played.
    if (t.updated && (!g.updated || t.updated > g.updated)) g.updated = t.updated;
    if (t.in_library !== 0) {
      g.libraryTracks++;
      if ((songs.get(t.id)?.plays || 0) > 0) g.listened++;
    }
    if (t.year > 0) g.years.add(t.year);
    if (t.trackCount > 0) g.discs.set(t.disc || 1, Math.max(g.discs.get(t.disc || 1) || 0, t.trackCount));
  };
  const group = () => ({ libraryTracks: 0, listened: 0, years: new Set<number>(), discs: new Map<number, number>() });
  for (const t of rows) {
    let extra = supplemental[exportKey(t)] || {};
    if (t.library_metadata) { try { extra = JSON.parse(t.library_metadata); } catch {} }
    const s = songs.get(t.id);
    const item = { ...t, ...extra, allHours: s ? (t.duration_s || 0) * s.plays / 3600 : undefined, allPlays: s?.plays };
    tracks[t.id] = item;
    const an = t.album_artist || t.artist, ak = groupedAlbumKey(an || '',t.album || '');
    const a = artists[an] ||= group(), b = albums[ak] ||= group();
    merge(a, item); merge(b, item);
    if (s) {
      a.allHours = (a.allHours || 0) + item.allHours;
      a.allPlays = (a.allPlays || 0) + (item.allPlays || 0);
      b.allHours = (b.allHours || 0) + item.allHours;
      b.allPlays = (b.allPlays || 0) + (item.allPlays || 0);
    }
  }
  for (const a of Object.values(albums) as Any[]) {
    a.totalTracks = Math.max(a.libraryTracks, [...a.discs.values()].reduce((x: number, n: number) => x + n, 0));
    a.year = a.years.size === 1 ? [...a.years][0] : null;
  }
  return { tracks, artists, albums };
}
export function trackMetadata(t: Any, asOf: string, now: string | number = Date.now() / 1000): MetaItem[] {
  if (!t) return [];
  const out: MetaItem[] = [];
  if (t.year > 0) out.push({ text: String(t.year), title: 'Năm phát hành', tone: releaseTone(t.year) });
  if (t.date_added) out.push({ text: addedAgeLabel(t.date_added,now), title: 'Thêm vào thư viện', detail: fmtWhen(t.date_added), tone: addedTone(t.date_added, asOf) });
  const lastPlay = elapsedAgeLabel(t.last_played ?? '', now);
  if (lastPlay !== '—') out.push({ text: '▷' + lastPlay, title: 'Lần nghe cuối', detail: fmtWhen(t.last_played), tone: 'gray', color: lastPlayedColor(t.last_played, now) });
  if (t.duration_s > 0) out.push({ text: durationLabel(t.duration_s), title: 'Độ dài bài hát', tone: durationTone(t.duration_s, t.allHours || 0), rule: [
    `Tổng thời gian nghe All time dùng cho màu: ${(t.allHours || 0).toLocaleString('vi-VN',{maximumFractionDigits:2})} giờ.`,
    'Dưới 6 phút: xám. Từ 6 đến dưới 8 phút: xanh nhạt, chuyển xanh đậm khi nghe đủ 2 giờ. Từ 8 đến dưới 10 phút: xanh sage, chuyển xanh chanh khi đủ 3 giờ. Từ 10 đến dưới 20 phút: vàng nhạt, chuyển vàng đậm khi đủ 4 giờ. Từ 20 phút: tím nhạt, chuyển tím đậm khi đủ 5 giờ.'
  ] });
  if (t.my_rating > 0) out.push({ text: '★ ' + Math.round(t.my_rating / 20), title: 'Đánh giá của bạn', tone: ratingTone(t.my_rating) });
  return out;
}
export function collectionMetadata(t: Any, asOf: string, album = false, listened?: number, now: string | number = Date.now() / 1000): MetaItem[] {
  if (!t) return [];
  const out: MetaItem[] = [];
  if (album && t.year) out.push({ text: String(t.year), title: 'Năm phát hành', tone: releaseTone(t.year) });
  if (album) out.push({ text: `${listened ?? t.listened}/${t.totalTracks}♪`, title: 'Số bài đã nghe trong kỳ / tổng số track của album theo thư viện Apple Music', tone: 'gray' });
  if (t.added) out.push({ text: addedAgeLabel(t.added,now), title: 'Thêm vào thư viện', detail: fmtWhen(t.added), tone: addedTone(t.added, asOf) });
  if (!album) out.push({ text: `${t.libraryTracks} bài trong thư viện`, title: 'Số bài hiện có trong thư viện', tone: 'gray' });
  return out;
}
