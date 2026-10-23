import type { UI } from '../state';

export const VIEW_DEFAULTS = {
  filter:'Tất cả', periodSort:'Giờ nghe', periodFilter:'Tất cả', artistFilter:'Tất cả',
  albumFilter:'Tất cả', albumSort:'Giờ nghe', songView:'Danh sách', sort:'Giờ nghe',
  scope:'Tháng', open:0, q:'', qd:'', sel:{}, playlistSort:'Thứ tự gốc',
  playlistFolder:'Tất cả', listLimit:50, releaseMode:'recent', trendMode:'rising',
} as const;
export type ViewPreferences = Pick<UI, keyof typeof VIEW_DEFAULTS>;
export type SavedViews = Record<string, Partial<ViewPreferences>>;
const KEY='music-stats:view-preferences:v1';
const choices:Record<string,readonly string[]>={
  sort:['Giờ nghe','Điểm','Lượt','Lịch sử'], periodSort:['Giờ nghe','Điểm All time','Lượt','Lịch sử'],
  albumSort:['Giờ nghe','Lượt','Lịch sử'], songView:['Danh sách','Lịch sử'],
  scope:['Tháng','Tháng trước','Năm','All time'],releaseMode:['recommend','recent','upcoming','saved','settings'],
  trendMode:['rising','Tháng trước','Tháng','Năm'],
};
export function cleanView(value:unknown):Partial<ViewPreferences> {
  const out:Record<string,unknown>={};
  if(!value || typeof value!=='object' || Array.isArray(value))return out;
  for(const [key, fallback] of Object.entries(VIEW_DEFAULTS)) {
    const v=(value as Record<string,unknown>)[key];
    if(typeof fallback==='string' && typeof v==='string' && v.length<=500 && (!choices[key] || choices[key].includes(v)))out[key]=v;
    if(typeof fallback==='number' && typeof v==='number' && Number.isFinite(v) && Number.isInteger(v) && v>=(key==='listLimit'?50:-1) && v<=100000)out[key]=v;
    if(key==='sel' && v && typeof v==='object' && !Array.isArray(v))out[key]=Object.fromEntries(Object.entries(v).filter(([,n])=>typeof n==='number'&&Number.isFinite(n)));
  }
  return out;
}
export function readViews():SavedViews {
  try {
    const raw=JSON.parse(localStorage.getItem(KEY)||'{}');
    if(!raw || typeof raw!=='object' || Array.isArray(raw))return {};
    return Object.fromEntries(Object.entries(raw).filter(([key])=>key.startsWith('/')).slice(-200).map(([key,value])=>[key,cleanView(value)]));
  } catch {return {};}
}
export function saveViews(views:SavedViews) {
  try {localStorage.setItem(KEY,JSON.stringify(Object.fromEntries(Object.entries(views).slice(-200))));}catch {}
}
export function rememberView(views:SavedViews,key:string,patch:Partial<UI>):SavedViews {
  const prefs=cleanView(patch);
  if(!Object.keys(prefs).length)return views;
  // Keep the most recently changed screens when pruning storage.
  const {[key]:previous,...rest}=views;
  return {...rest,[key]:{...previous,...prefs}};
}
export function screenView(ui:UI,key:string):UI {
  return {...ui,...VIEW_DEFAULTS,...(key==='/playlists/favourites'?{playlistFolder:'Favourite'}:{}),...ui.views[key]};
}
