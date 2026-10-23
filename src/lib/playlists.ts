import { API_BASE, API_TOKEN, CAN_WRITE, DATA_SOURCE, FETCH_TIMEOUT_MS } from "@/config";
import { fmtH, per, toMs, vn } from './fmt';
import { elapsedAgeLabel, lastPlayedColor, type MetaItem } from './metadata';
import { LastGoodStore, cacheScope } from './last-good';
import playlistFolders from '@/data/playlist-folders.json';
export type PlaylistTrack = {
  title: string; artist?: string; album?: string; albumArtist?: string; duration?: number;
  year?: number; persistentId?: string; inLibrary?: boolean; missing?: boolean;
};
export type Playlist = {id:string; name:string; folder:string; favourite?:boolean; favorite?:boolean; path:string; items:string[]};
export type PlaylistSnapshot = {exportedAt:string|null; folders:string[]; playlists:Playlist[]; tracks:Record<string,PlaylistTrack>; source?:string};
export const PLAYLIST_SNAPSHOT_EVENT = 'music-stats:playlist-snapshot';
export const PLAYLIST_FOLDERS = [
  "_New Music", "__AEPHANEMER", "__MONO", "__WINTERSUN",
  "00_COLLECTION", "01_CREATIVE", "02_PAIN", "03_SCREAM",
] as const;
const HIDDEN_PLAYLIST_FOLDERS = ['_Everlasting.Light'];
export function playlistMetricMode(folder:string,track:PlaylistTrack,libraryReady:boolean,owned:boolean) {
  if(!libraryReady)return 'waiting';
  return !owned || folder==='_New Music' ? 'community' : 'local';
}

let snapshot: Promise<PlaylistSnapshot> | undefined;
let snapshotRefresh: Promise<PlaylistSnapshot> | undefined;
let lastSnapshot: PlaylistSnapshot | undefined;
let playlistStorage: Storage | undefined;
try { playlistStorage=window.localStorage; } catch {}
const playlistSnapshotStore = new LastGoodStore(cacheScope(API_BASE,API_TOKEN)+':playlist-snapshot:v1',playlistStorage,1500000);
const PLAYLIST_SNAPSHOT_CACHE_KEY='latest';
function bundledPlaylistSnapshot() {
  return import('@/data/playlists.json').then(data=>data.default as PlaylistSnapshot);
}
export function usablePlaylistSnapshot(value:unknown): value is PlaylistSnapshot {
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const data=value as PlaylistSnapshot;
  if(!Array.isArray(data.folders)||!Array.isArray(data.playlists)||!data.tracks||typeof data.tracks!=='object'||Array.isArray(data.tracks))return false;
  const trackIds=new Set(Object.keys(data.tracks));
  if(!data.playlists.length||!trackIds.size)return false;
  let references=0;
  for(const playlist of data.playlists){
    if(!playlist||typeof playlist.id!=='string'||!playlist.id.trim()||typeof playlist.name!=='string'||!playlist.name.trim()||!Array.isArray(playlist.items))return false;
    for(const id of playlist.items){
      const track=typeof id==='string'?data.tracks[id]:undefined;
      if(!track||typeof track.title!=='string'||!track.title.trim())return false;
      references++;
    }
  }
  return references>0;
}
function savedPlaylistSnapshot() {
  const saved=playlistSnapshotStore.get(PLAYLIST_SNAPSHOT_CACHE_KEY)?.data;
  return usablePlaylistSnapshot(saved)?saved:undefined;
}
function snapshotTime(value:PlaylistSnapshot|undefined) {
  const parsed=Date.parse(value?.exportedAt || '');
  return Number.isFinite(parsed)?parsed:0;
}
function newerPlaylistSnapshot(a:PlaylistSnapshot|undefined,b:PlaylistSnapshot) {
  return a&&snapshotTime(a)>snapshotTime(b)?a:b;
}
async function serverPlaylistSnapshot() {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const to = setTimeout(() => ctl?.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(API_BASE + "/library/playlists", { headers: { Authorization: "Bearer " + API_TOKEN }, signal: ctl?.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    if (!usablePlaylistSnapshot(data)) throw new Error('invalid playlist snapshot');
    return data as PlaylistSnapshot;
  } finally { clearTimeout(to); }
}
const textKey = (value: unknown) => String(value || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g,' ');
const playlistIdKey = (value: unknown) => {
  const id=String(value || '').trim();
  if(!id)return '';
  try { return (/^\d+$/.test(id) ? BigInt(id).toString(16) : id).toUpperCase(); }
  catch { return id.toUpperCase(); }
};
function inferredFolder(playlist: Playlist) {
  const name = String(playlist.name || '').trim();
  if (/^M0/i.test(name)) return '03_SCREAM';
  if (/^[AMN]_/i.test(name)) return '_New Music';
  if (/^(?:0[1-9]|[1-9]\d)(?!\.)/i.test(name)) return '00_COLLECTION';
  return '';
}
function hiddenPlaylist(playlist: Playlist) {
  const name = String(playlist.name || '').trim();
  if (!name) return true;
  return /__/.test(name)
    || /^A_(?:Forgotten Rated|LAST PLAYED|NHAC VIET|RECENTLY ADDED)/i.test(name)
    || /^(?:\d+\s+)?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)_/i.test(name)
    || /^(?:WW|YY)\b/i.test(name)
    || playlistLibraryKeywordHidden(name);
}
function hiddenPlaylistFolder(folder:string) {
  const value=textKey(folder);
  return HIDDEN_PLAYLIST_FOLDERS.some(hidden=>value===textKey(hidden)||value.startsWith(textKey(hidden)+' / '));
}
function playlistVisibleInFolder(playlist:Playlist) {
  const folder=textKey(playlist.folder);
  if(folder===textKey('99_ARCHIVE')||folder.startsWith(textKey('99_ARCHIVE')+' / '))return textKey(playlist.name)===textKey('Test');
  return true;
}
function orderedFolders(playlists: Playlist[], folders: string[] = []) {
  const seen = new Set<string>();
  const add = (folder?: string) => {
    const value = String(folder || '').trim();
    if (value) seen.add(value);
  };
  PLAYLIST_FOLDERS.forEach(add);
  folders.forEach(add);
  playlists.forEach(p => add(p.folder));
  return [...seen].filter(folder => playlists.some(p => p.folder === folder));
}
function scopePlaylistSnapshot(data: PlaylistSnapshot, bundled?: PlaylistSnapshot): PlaylistSnapshot {
  const folderById = new Map(playlistFolders.playlists.map(playlist=>[playlistIdKey(playlist.id),playlist]));
  const folderByName = new Map<string, typeof playlistFolders.playlists[number] | null>();
  for (const playlist of playlistFolders.playlists) {
    const key=textKey(playlist.name);
    folderByName.set(key,folderByName.has(key)?null:playlist);
  }
  const bundledByName = new Map<string, Playlist | null>();
  for (const playlist of bundled?.playlists || []) {
    const key = textKey(playlist.name);
    bundledByName.set(key, bundledByName.has(key) ? null : playlist);
  }
  const playlists = data.playlists.filter(playlist => !hiddenPlaylist(playlist)).map(playlist => {
    const key=textKey(playlist.name);
    const mapped=folderById.get(playlistIdKey(playlist.id)) || folderByName.get(key);
    const bundledMatch=bundledByName.get(key);
    const folder=mapped?.folder || inferredFolder(playlist) || bundledMatch?.folder || playlist.folder || 'Apple Music';
    const path=mapped?.path || bundledMatch?.path || (folder===playlist.folder?playlist.path:folder);
    return { ...playlist, folder, path };
  }).filter(playlist=>!hiddenPlaylistFolder(playlist.folder)&&playlistVisibleInFolder(playlist));
  return { ...data, folders: orderedFolders(playlists,[...playlistFolders.folders,...data.folders]), playlists };
}
function refreshPlaylistSnapshot() {
  if(DATA_SOURCE !== 'Server')return Promise.resolve(null);
  return snapshotRefresh ||= Promise.all([serverPlaylistSnapshot(), bundledPlaylistSnapshot().catch(()=>undefined)])
    .then(([raw,bundled])=>{
      const data=scopePlaylistSnapshot(raw,bundled);
      if(!usablePlaylistSnapshot(data))throw new Error('empty scoped playlist snapshot');
      playlistSnapshotStore.set(PLAYLIST_SNAPSHOT_CACHE_KEY,raw);
      lastSnapshot=data;
      snapshot=Promise.resolve(data);
      if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(PLAYLIST_SNAPSHOT_EVENT));
      return data;
    })
    .finally(()=>{snapshotRefresh=undefined;});
}
export function invalidatePlaylistSnapshot() { snapshot = undefined; }
export function peekPlaylistSnapshot() {
  if(!lastSnapshot){
    const saved=savedPlaylistSnapshot();
    if(saved){
      const scoped=scopePlaylistSnapshot(saved);
      if(usablePlaylistSnapshot(scoped))lastSnapshot=scoped;
    }
  }
  return lastSnapshot || null;
}
export function loadPlaylistSnapshot() {
  return snapshot ||= (DATA_SOURCE === 'Server'
    ? bundledPlaylistSnapshot().then(data=>{
        const initial=scopePlaylistSnapshot(newerPlaylistSnapshot(savedPlaylistSnapshot(),data),data);
        if(!usablePlaylistSnapshot(initial))throw new Error('bundled playlist snapshot unavailable');
        void refreshPlaylistSnapshot().catch(()=>{});
        return initial;
      }).catch(()=>{
        const saved=savedPlaylistSnapshot();
        if(saved){
          const scoped=scopePlaylistSnapshot(saved);
          if(usablePlaylistSnapshot(scoped)){void refreshPlaylistSnapshot().catch(()=>{});return scoped;}
        }
        return refreshPlaylistSnapshot().then(data=>data || Promise.reject(new Error('playlist snapshot unavailable')));
      })
    : bundledPlaylistSnapshot().then(data=>scopePlaylistSnapshot(data)))
    .then(data=>{if(!usablePlaylistSnapshot(data))throw new Error('playlist snapshot unavailable');lastSnapshot=data;return data;})
    .catch(error=>{snapshot=undefined;throw error;});
}
const key = textKey;
export function playlistsContainingTrack(snapshot:PlaylistSnapshot|null|undefined,track:Pick<PlaylistTrack,'title'|'artist'|'album'|'albumArtist'|'persistentId'>) {
  if(!snapshot)return [];
  const persistentId=key(track.persistentId);
  const title=key(track.title),artist=key(track.artist || track.albumArtist),album=key(track.album);
  return snapshot.playlists.filter(playlist=>playlist.items.some(item=>{
    const candidate=snapshot.tracks[item];
    if(!candidate||candidate.missing)return false;
    if(persistentId&&key(candidate.persistentId)===persistentId)return true;
    if(!title||!artist||key(candidate.title)!==title||key(candidate.artist || candidate.albumArtist)!==artist)return false;
    return !album||key(candidate.album)===album;
  }));
}
export function playlistLibraryIndex(rows: any[]) {
  const pid = new Map<string, any[]>(), identity = new Map<string, any[]>();
  for (const row of rows) {
    if (row.in_library !== 1) continue;
    if (row.apple_pid) pid.set(row.apple_pid,[...(pid.get(row.apple_pid)||[]),row]);
    const k = [row.title,row.artist || row.album_artist,row.album].map(key).join('\u001f');
    identity.set(k,[...(identity.get(k)||[]),row]);
  }
  return (track:PlaylistTrack) => {
    if (track.missing) return undefined;
    const matches = track.persistentId ? pid.get(track.persistentId) : undefined;
    if (matches?.length === 1) return matches[0];
    const byName = identity.get([track.title,track.artist || track.albumArtist,track.album].map(key).join('\u001f'));
    return byName?.length === 1 ? byName[0] : undefined;
  };
}


export type PlaylistRankRow = { id:string; name:string; rank:number; metadata:MetaItem[]; v:string; avg:number; score:number; referenceScore:number; recency:number; trackCount:number; lastPlayedMs:number; hue:number; explanation:string; change?:number; comparison?:string; bestRank?:number };
export type PlaylistMetaRow = { id:string; metadata:MetaItem[]; explanation:string; avg:number; referenceScore:number; recency:number; trackCount:number; lastPlayedMs:number };

export function sortPlaylistsByRank(playlists:Playlist[],rankRows:Pick<PlaylistRankRow,'id'|'rank'>[],source:Playlist[]=playlists) {
  const rankById=new Map(rankRows.map(row=>[row.id,row.rank]));
  const sourceOrder=new Map(source.map((playlist,index)=>[playlist.id,index]));
  return [...playlists].sort((a,b)=>(rankById.get(a.id)??Infinity)-(rankById.get(b.id)??Infinity)||(sourceOrder.get(a.id)??Infinity)-(sourceOrder.get(b.id)??Infinity));
}

function foldedPlaylistText(value:unknown) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

export const PLAYLIST_KEYWORDS_EVENT = 'music-stats:playlist-keywords-changed';
export type PlaylistKeywordRule = { keyword:string; enabled:boolean; match?:'contains'|'exact'|'rawContains'|'word' };
const LIBRARY_HIDDEN_PLAYLIST_KEYWORDS = [
  'Top','Now','MP','MM','Rating','Reading','Archive','LM','0_',
  'New Songs','New Unplayed Song','Good Old Songs','Rated Songs','Songs to Review','Songdata','Songs Play',
  'Bo sung play artist','Bai Hat Yeu Thich','Bài Hát Yêu Thích','Lastest Scrobbles',
];
const PLAYLIST_KEYWORDS_KEY = 'music-stats:playlist-rank-keywords:v1';
export const DEFAULT_PLAYLIST_KEYWORDS: PlaylistKeywordRule[] = [
  {keyword:'_',enabled:true,match:'rawContains'},
  {keyword:'Test',enabled:true,match:'exact'},
  {keyword:'Rating STOP RATING',enabled:true,match:'contains'},
  {keyword:'Top Tracks last week',enabled:true,match:'exact'},
  {keyword:'Best',enabled:true,match:'contains'},
  {keyword:'SPL',enabled:true,match:'contains'},
  {keyword:'BXH',enabled:true,match:'contains'},
  {keyword:'POST ROCK MP',enabled:true,match:'contains'},
];
function playlistKeywordKey(keyword:string) { return foldedPlaylistText(keyword); }
function normalizePlaylistKeywordRules(value:unknown): PlaylistKeywordRule[] {
  const source=Array.isArray(value)?value:DEFAULT_PLAYLIST_KEYWORDS;
  const seen=new Set<string>();
  return source.flatMap((item:any)=>{
    const keyword=String(typeof item==='string'?item:item?.keyword || '').trim();
    const key=playlistKeywordKey(keyword);
    if(!key || seen.has(key))return [];
    seen.add(key);
    const match=item?.match==='exact'||item?.match==='rawContains'||item?.match==='word'||item?.match==='contains'?item.match:undefined;
    return [{keyword,enabled:item?.enabled!==false,match}];
  });
}
export function readPlaylistKeywordRules(): PlaylistKeywordRule[] {
  if(typeof window==='undefined')return DEFAULT_PLAYLIST_KEYWORDS;
  try {
    const raw=window.localStorage.getItem(PLAYLIST_KEYWORDS_KEY);
    if(!raw)return DEFAULT_PLAYLIST_KEYWORDS;
    const parsed=JSON.parse(raw);
    const saved=normalizePlaylistKeywordRules(parsed);
    const hasTypedRules=Array.isArray(parsed) && parsed.some((item:any)=>item && typeof item==='object' && 'keyword' in item);
    if(hasTypedRules)return saved;
    const seen=new Set(saved.map(rule=>playlistKeywordKey(rule.keyword)));
    return [...DEFAULT_PLAYLIST_KEYWORDS.filter(rule=>!seen.has(playlistKeywordKey(rule.keyword))),...saved];
  } catch { return DEFAULT_PLAYLIST_KEYWORDS; }
}
export function savePlaylistKeywordRules(rules:PlaylistKeywordRule[]) {
  const next=normalizePlaylistKeywordRules(rules);
  try { window.localStorage.setItem(PLAYLIST_KEYWORDS_KEY,JSON.stringify(next)); } catch {}
  invalidatePlaylistSnapshot();
  try { window.dispatchEvent(new Event(PLAYLIST_KEYWORDS_EVENT)); } catch {}
  pushPlaylistRankingSettings(next,readPlaylistRankExcludes());
  return next;
}
export function resetPlaylistKeywordRules() {
  try { window.localStorage.removeItem(PLAYLIST_KEYWORDS_KEY); } catch {}
  invalidatePlaylistSnapshot();
  try { window.dispatchEvent(new Event(PLAYLIST_KEYWORDS_EVENT)); } catch {}
  pushPlaylistRankingSettings(DEFAULT_PLAYLIST_KEYWORDS,readPlaylistRankExcludes());
  return DEFAULT_PLAYLIST_KEYWORDS;
}
function playlistKeywordExcluded(name:string) {
  const folded=foldedPlaylistText(name);
  return readPlaylistKeywordRules().some(rule=>{
    if(!rule.enabled)return false;
    const key=playlistKeywordKey(rule.keyword);
    if(!key)return false;
    if(/^[\p{L}\p{N}]{1,3}$/u.test(key))return new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(\\s|$)`,'u').test(folded);
    return folded.includes(key);
  });
}
function playlistLibraryKeywordHidden(name:string) {
  const folded=foldedPlaylistText(name);
  return LIBRARY_HIDDEN_PLAYLIST_KEYWORDS.some(keyword=>{
    const key=playlistKeywordKey(keyword);
    if(!key)return false;
    if(/^[\p{L}\p{N}]{1,3}$/u.test(key))return new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(\\s|$)`,'u').test(folded);
    return folded.includes(key);
  });
}

export const PLAYLIST_RANK_EXCLUDES_EVENT = 'music-stats:playlist-rank-excludes-changed';
const PLAYLIST_RANK_EXCLUDES_KEY = 'music-stats:playlist-rank-excludes:v1';
export function playlistRankExcludeKey(playlist:Pick<Playlist,'id'|'name'>) {
  return playlist.id || foldedPlaylistText(playlist.name);
}
export function readPlaylistRankExcludes() {
  try {
    const value=JSON.parse(window.localStorage.getItem(PLAYLIST_RANK_EXCLUDES_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter(item=>typeof item==='string') : []);
  } catch { return new Set<string>(); }
}
export function addPlaylistRankExclude(playlist:Pick<Playlist,'id'|'name'>) {
  const next=readPlaylistRankExcludes();
  next.add(playlistRankExcludeKey(playlist));
  try { window.localStorage.setItem(PLAYLIST_RANK_EXCLUDES_KEY,JSON.stringify([...next])); } catch {}
  try { window.dispatchEvent(new Event(PLAYLIST_RANK_EXCLUDES_EVENT)); } catch {}
  pushPlaylistRankingSettings(readPlaylistKeywordRules(),next);
  return next;
}

type PlaylistRankingSettings={keywords?:PlaylistKeywordRule[];excludes?:string[];updatedAt?:string}|null;
let playlistRankingSync:Promise<void>|undefined;
function dispatchPlaylistRankingEvents(keywordsChanged:boolean,excludesChanged:boolean) {
  if(keywordsChanged){invalidatePlaylistSnapshot();try{window.dispatchEvent(new Event(PLAYLIST_KEYWORDS_EVENT));}catch{}}
  if(excludesChanged)try{window.dispatchEvent(new Event(PLAYLIST_RANK_EXCLUDES_EVENT));}catch{}
}
function writePlaylistKeywordRulesLocal(rules:PlaylistKeywordRule[]) {
  const next=normalizePlaylistKeywordRules(rules);
  try { window.localStorage.setItem(PLAYLIST_KEYWORDS_KEY,JSON.stringify(next)); } catch {}
  return next;
}
function writePlaylistRankExcludesLocal(excludes:ReadonlySet<string>|string[]) {
  const next=[...(excludes instanceof Set ? excludes : new Set(excludes))].filter(item=>typeof item==='string'&&item.trim());
  try { window.localStorage.setItem(PLAYLIST_RANK_EXCLUDES_KEY,JSON.stringify(next)); } catch {}
  return new Set(next);
}
function hasCustomLocalPlaylistRankingSettings() {
  if(typeof window==='undefined')return false;
  try {
    if(readPlaylistRankExcludes().size)return true;
    if(!window.localStorage.getItem(PLAYLIST_KEYWORDS_KEY))return false;
    return JSON.stringify(readPlaylistKeywordRules())!==JSON.stringify(DEFAULT_PLAYLIST_KEYWORDS);
  } catch { return false; }
}
function applyPlaylistRankingSettings(settings:PlaylistRankingSettings) {
  if(!settings || typeof window==='undefined')return;
  let keywordsChanged=false,excludesChanged=false;
  if(Array.isArray(settings.keywords)) {
    const next=normalizePlaylistKeywordRules(settings.keywords);
    if(JSON.stringify(next)!==JSON.stringify(readPlaylistKeywordRules())) {
      writePlaylistKeywordRulesLocal(next);
      keywordsChanged=true;
    }
  }
  if(Array.isArray(settings.excludes)) {
    const current=[...readPlaylistRankExcludes()].sort();
    const next=[...new Set(settings.excludes.filter(item=>typeof item==='string'&&item.trim()))].sort();
    if(JSON.stringify(next)!==JSON.stringify(current)) {
      writePlaylistRankExcludesLocal(next);
      excludesChanged=true;
    }
  }
  dispatchPlaylistRankingEvents(keywordsChanged,excludesChanged);
}
async function fetchPlaylistRankingSettings(method:'GET'|'POST',body?:unknown):Promise<PlaylistRankingSettings> {
  if(DATA_SOURCE!=='Server')return null;
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const to = setTimeout(() => ctl?.abort(), FETCH_TIMEOUT_MS);
  try {
    const response=await fetch(API_BASE+'/settings/playlist-ranking',{
      method,
      headers:{Authorization:'Bearer '+API_TOKEN,...(method==='POST'?{'content-type':'application/json'}:{})},
      body:method==='POST'?JSON.stringify(body || {}):undefined,
      signal:ctl?.signal,
    });
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();
    return data?.settings ?? null;
  } finally { clearTimeout(to); }
}
function pushPlaylistRankingSettings(keywords:PlaylistKeywordRule[],excludes:ReadonlySet<string>) {
  if(!CAN_WRITE || DATA_SOURCE!=='Server')return;
  void fetchPlaylistRankingSettings('POST',{keywords,excludes:[...excludes]}).then(applyPlaylistRankingSettings).catch(()=>undefined);
}
export function syncPlaylistRankingSettings(force=false) {
  if(!force && playlistRankingSync)return playlistRankingSync;
  playlistRankingSync=(async()=>{
    const settings=await fetchPlaylistRankingSettings('GET').catch(()=>null);
    if(settings) {
      applyPlaylistRankingSettings(settings);
    } else if(CAN_WRITE && hasCustomLocalPlaylistRankingSettings()) {
      await fetchPlaylistRankingSettings('POST',{keywords:readPlaylistKeywordRules(),excludes:[...readPlaylistRankExcludes()]}).then(applyPlaylistRankingSettings);
    }
  })().catch(()=>undefined).finally(()=>{playlistRankingSync=undefined;});
  return playlistRankingSync;
}

const PLAYLIST_RANK_HISTORY_KEY = 'music-stats:playlist-rank-history:v1';
type PlaylistRankHistoryPoint = { id:string; name:string; rank:number };
type PlaylistRankHistorySnapshot = { period:string; rows:PlaylistRankHistoryPoint[] };
function canUseLocalStorage() { return typeof window !== 'undefined' && !!window.localStorage; }
function playlistRankPeriod(snapshot:PlaylistSnapshot|null) {
  const ym = /^\d{4}-\d{2}/.exec(String(snapshot?.exportedAt || ''))?.[0]
    || new Date(Date.now()+7*3600e3).toISOString().slice(0,7);
  return per(ym);
}
function readPlaylistRankHistory():PlaylistRankHistorySnapshot[] {
  if(!canUseLocalStorage())return [];
  try {
    const value=JSON.parse(window.localStorage.getItem(PLAYLIST_RANK_HISTORY_KEY) || '[]');
    if(!Array.isArray(value))return [];
    return value.flatMap((snapshot:any)=>{
      if(!snapshot || typeof snapshot.period!=='string' || !Array.isArray(snapshot.rows))return [];
      const rows=snapshot.rows.flatMap((row:any)=>typeof row?.id==='string' && typeof row?.name==='string' && Number.isInteger(row?.rank) && row.rank>0 ? [{id:row.id,name:row.name,rank:row.rank}] : []);
      return rows.length ? [{period:snapshot.period,rows}] : [];
    });
  } catch { return []; }
}
function writePlaylistRankHistory(history:PlaylistRankHistorySnapshot[]) {
  if(!canUseLocalStorage())return;
  try { window.localStorage.setItem(PLAYLIST_RANK_HISTORY_KEY,JSON.stringify(history.slice(-36))); } catch {}
}
function decoratePlaylistRankHistory(rows:PlaylistRankRow[], snapshot:PlaylistSnapshot|null, saveHistory:boolean):PlaylistRankRow[] {
  const period=playlistRankPeriod(snapshot);
  const history=readPlaylistRankHistory();
  const best=new Map<string,{rank:number;period:string}>();
  for(const snapshot of history) {
    if(snapshot.period===period)continue;
    for(const row of snapshot.rows) {
      const prev=best.get(row.id);
      if(!prev || row.rank<prev.rank)best.set(row.id,{rank:row.rank,period:snapshot.period});
    }
  }
  const decorated=rows.map(row=>{
    const point=best.get(row.id);
    const change=point && point.rank!==row.rank ? point.rank-row.rank : undefined;
    return {...row,change,bestRank:point?.rank,comparison:change==null?undefined:point?.period};
  });
  if(saveHistory && rows.length) {
    const current={period,rows:rows.map(row=>({id:row.id,name:row.name,rank:row.rank}))};
    writePlaylistRankHistory([...history.filter(snapshot=>snapshot.period!==period),current]);
  }
  return decorated;
}
function playlistRankUserExcluded(playlist:Pick<Playlist,'id'|'name'>, excluded?:ReadonlySet<string>) {
  return !!excluded?.has(playlistRankExcludeKey(playlist));
}

function playlistRankExcluded(name:string) {
  const raw=String(name || '');
  const folded=foldedPlaylistText(raw);
  return playlistKeywordExcluded(raw);
}

function playlistRankLevel(trackCount:number, avg:number) {
  if(trackCount>=5 && avg>=50)return 1;
  if(trackCount>20 && avg>30)return 2;
  if(trackCount>10 && avg>=20)return 3;
  if(trackCount>5 && trackCount<=10 && avg>=10)return 4;
  if((trackCount>2 && trackCount<=5 && avg>10) || (trackCount>=10 && avg>=10 && avg<20))return 5;
  return 0;
}

function playlistTrackRecencyFactor(lastPlayedMs:number,nowMs=Date.now()) {
  if(!Number.isFinite(lastPlayedMs))return 0.1;
  const days=Math.max(0,(nowMs-lastPlayedMs)/86400000);
  return days<30?1:days<90?0.55:days<180?0.35:days<365?0.2:0.1;
}

function playlistRecencyScore(recency:number) {
  return Math.pow(Math.max(0,Math.min(1,recency)),1.5);
}

function playlistCoverageFactor(trackCount:number) {
  return Math.sqrt(Math.min(Math.max(trackCount,0),20)/20);
}

function playlistRankExplanation(r:any) {
  const avg=r.avg.toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1})+'x';
  const score=r.score.toLocaleString('vi-VN',{maximumFractionDigits:1});
  const coverage=(r.coverage*100).toLocaleString('vi-VN',{maximumFractionDigits:0})+'%';
  const recency=(r.recency*100).toLocaleString('vi-VN',{maximumFractionDigits:0})+'%';
  return `Level ${r.level} chỉ dùng để phân loại và kiểm tra đủ điều kiện, không nhân vào điểm. ${vn(r.plays)} lượt / ${vn(r.trackCount)} bài = ${avg}. Điểm = Play Average × coverage × recency^1,5 = ${score}. Coverage ${coverage}, tính liên tục theo căn bậc hai của số bài và đạt tối đa từ 20 bài. Recency ${recency}, tính đều theo từng bài trong playlist; bài lâu chưa nghe kéo điểm xuống.`;
}

function playlistListeningExplanation(r:any) {
  const avg=r.avg.toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1})+'x';
  const last=Number.isFinite(r.lastPlayedMs) ? elapsedAgeLabel(r.lastPlayedMs/1000) : 'chưa có lần nghe';
  const score=r.referenceScore.toLocaleString('vi-VN',{maximumFractionDigits:1})+'đ';
  const recency=(r.recency*100).toLocaleString('vi-VN',{maximumFractionDigits:0})+'%';
  return `${vn(r.plays)} lượt / ${vn(r.trackCount)} bài hợp lệ = ${avg}. Điểm tham khảo ${score}; recency ${recency}; lần nghe gần nhất: ${last}.`;
}

function playlistStatMetadata(r:any, includeRanking:boolean):MetaItem[] {
  const listening=playlistListeningExplanation(r);
  const rank=includeRanking ? playlistRankExplanation(r) : listening;
  return [
    includeRanking && {title:'Level ranking',text:`L${r.level}`,detail:`Level ${r.level} chỉ dùng để phân loại và kiểm tra đủ điều kiện, không nhân vào điểm. ${rank}`,tone:'purple'},
    {title:includeRanking?'Điểm ranking':'Điểm tham khảo',text:(includeRanking?r.score:r.referenceScore).toLocaleString('vi-VN',{maximumFractionDigits:1})+'đ',detail:rank,tone:'gold'},
    {title:includeRanking?'Recency ranking':'Recency tham khảo',text:'R'+(r.recency*100).toLocaleString('vi-VN',{maximumFractionDigits:0})+'%',detail:`Recency tính đều theo từng bài trong playlist. ${rank}`,tone:'green'},
    {title:'Số bài',text:`${vn(r.trackCount)}♪`,detail:`${vn(r.trackCount)} bài hợp lệ trong playlist sau khi khớp với thư viện`,tone:'gray'},
    {title:'Play Average',text:r.avg.toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1})+'x',detail:listening,tone:'gold'},
    Number.isFinite(r.lastPlayedMs)&&{title:'Lần nghe cuối',text:'▷'+elapsedAgeLabel(r.lastPlayedMs/1000),detail:`Lần nghe gần nhất trong playlist. ${listening}`,tone:'gray',color:lastPlayedColor(r.lastPlayedMs/1000)},
  ].filter(Boolean) as MetaItem[];
}

function playlistStats(snapshot:PlaylistSnapshot|null, library:any[]|undefined) {
  if(!snapshot || !library?.length)return [];
  const findTrack=playlistLibraryIndex(library);
  return snapshot.playlists.map((playlist,index)=>{
    let trackCount=0, plays=0, seconds=0, lastPlayedMs=NaN, recencyTotal=0, recencyWeight=0;
    for(const id of playlist.items){
      const track=snapshot.tracks[id];
      if(!track)continue;
      const owned=findTrack(track);
      if(!owned)continue;
      const p=Number(owned.plays ?? owned.allPlays ?? 0) || 0;
      const duration=Number(owned.duration_s ?? track.duration ?? 0) || 0;
      trackCount++;
      plays+=p;
      seconds+=p*duration;
      const played=toMs(owned.last_played);
      if(Number.isFinite(played)&&(!Number.isFinite(lastPlayedMs)||played>lastPlayedMs))lastPlayedMs=played;
      recencyTotal+=playlistTrackRecencyFactor(played);
      recencyWeight+=1;
    }
    const avg=trackCount ? plays/trackCount : 0;
    const level=playlistRankLevel(trackCount,avg);
    const recency=recencyWeight ? recencyTotal/recencyWeight : 0.65;
    const coverage=playlistCoverageFactor(trackCount);
    const referenceScore=avg*coverage*playlistRecencyScore(recency);
    const score=level ? referenceScore : 0;
    return {playlist,index,trackCount,plays,hours:seconds/3600,avg,level,score,referenceScore,lastPlayedMs,recency,coverage};
  });
}

export function buildPlaylistMetaRows(snapshot:PlaylistSnapshot|null, library:any[]|undefined):PlaylistMetaRow[] {
  return playlistStats(snapshot,library).filter((r:any)=>r.trackCount>0).map((r:any)=>({
    id:r.playlist.id,
    explanation:playlistListeningExplanation(r),
    metadata:playlistStatMetadata(r,false),
    avg:r.avg,
    referenceScore:r.referenceScore,
    recency:r.recency,
    trackCount:r.trackCount,
    lastPlayedMs:r.lastPlayedMs,
  }));
}

export function buildPlaylistRankRows(snapshot:PlaylistSnapshot|null, library:any[]|undefined, limit=10, excluded?:ReadonlySet<string>, saveHistory=false):PlaylistRankRow[] {
  const rows=playlistStats(snapshot,library).filter((r:any)=>r.level && !playlistRankExcluded(r.playlist.name) && !playlistRankUserExcluded(r.playlist,excluded))
    .sort((a:any,b:any)=>b.score-a.score || b.hours-a.hours || b.avg-a.avg || a.index-b.index).slice(0,limit);
  const ranked=rows.map((r:any,k:number)=>({
    id:r.playlist.id,
    name:r.playlist.name,
    rank:k+1,
    v:r.avg.toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1})+'x',
    avg:r.avg,
    score:r.score,
    referenceScore:r.referenceScore,
    recency:r.recency,
    trackCount:r.trackCount,
    lastPlayedMs:r.lastPlayedMs,
    hue:r.index*137.508%360,
    explanation:playlistRankExplanation(r),
    metadata:playlistStatMetadata(r,true),
  }));
  return decoratePlaylistRankHistory(ranked,snapshot,saveHistory);
}

export function buildPlaylistPeriodRows(snapshot:PlaylistSnapshot|null, library:any[]|undefined, periodRows:any[]|undefined, limit=10, excluded?:ReadonlySet<string>):PlaylistRankRow[] {
  if(!snapshot || !library?.length || !periodRows?.length)return [];
  const findTrack=playlistLibraryIndex(library);
  const allTimeById=new Map(playlistStats(snapshot,library).map((row:any)=>[row.playlist.id,row]));
  const periodById=new Map(periodRows.map(row=>[String(row.track_id || ''),row]));
  const rows=snapshot.playlists.flatMap((playlist,index)=>{
    if(playlistRankExcluded(playlist.name) || playlistRankUserExcluded(playlist,excluded))return [];
    let plays=0,hours=0,trackCount=0;
    const seen=new Set<string>();
    for(const item of playlist.items){
      if(seen.has(item))continue;
      seen.add(item);
      const track=snapshot.tracks[item];
      if(!track)continue;
      const owned=findTrack(track);
      const id=String(owned?.libraryTrackId || owned?.id || '');
      const period=periodById.get(id);
      const count=Number(period?.plays) || 0;
      if(count<=0)continue;
      const duration=Number(period?.duration_s || owned?.duration_s || track.duration || 0) || 0;
      plays+=count;
      hours+=count*duration/3600;
      trackCount++;
    }
    if(!plays)return [];
    return [{playlist,index,plays,hours,trackCount}];
  }).sort((a,b)=>b.plays-a.plays || b.hours-a.hours || b.trackCount-a.trackCount || a.index-b.index).slice(0,limit);
  return rows.map((row,rank)=>{
    const explanation=`${vn(row.plays)} lượt · ${fmtH(row.hours)} · ${vn(row.trackCount)} bài đã nghe trong 15 ngày gần đây.`;
    const allTime=allTimeById.get(row.playlist.id);
    return {
      id:row.playlist.id,
      name:row.playlist.name,
      rank:rank+1,
      v:`${vn(row.plays)}x`,
      avg:row.trackCount?row.plays/row.trackCount:0,
      score:row.plays,
      referenceScore:row.plays,
      recency:1,
      trackCount:row.trackCount,
      lastPlayedMs:NaN,
      hue:row.index*137.508%360,
      explanation,
      metadata:allTime ? playlistStatMetadata(allTime,true) : [
        {title:'Lượt nghe 15 ngày',text:`${vn(row.plays)}x`,detail:explanation,tone:'gold'},
        {title:'Thời gian nghe 15 ngày',text:fmtH(row.hours),detail:explanation,tone:'gray'},
        {title:'Bài đã nghe 15 ngày',text:`${vn(row.trackCount)}♪`,detail:explanation,tone:'gray'},
      ],
    };
  });
}

export const PLAYLIST_SORTS = ['Thứ tự gốc', 'Tên bài', 'Nghệ sĩ', 'Album', 'Năm mới nhất', 'Dài nhất'] as const;
export type PlaylistSort = typeof PLAYLIST_SORTS[number];
export function sortPlaylistRows<T extends {index:number;track:PlaylistTrack}>(rows:T[],sort:PlaylistSort):T[] {
  const text=(a?:string,b?:string)=>(a || '').localeCompare(b || '', 'vi', {numeric:true,sensitivity:'base'});
  return [...rows].sort((a,b)=>{
    const x=a.track,y=b.track;
    const delta=sort==='Tên bài'?text(x.title,y.title):sort==='Nghệ sĩ'?text(x.artist,y.artist):sort==='Album'?text(x.album,y.album):sort==='Năm mới nhất'?(y.year||0)-(x.year||0):sort==='Dài nhất'?(y.duration||0)-(x.duration||0):0;
    return delta || a.index-b.index;
  });
}
