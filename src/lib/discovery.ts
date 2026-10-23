import { mergeReleases, type Release } from '../../../../shared/releases';
export type { Release } from '../../../../shared/releases';
import { API_BASE, API_TOKEN, BROWSER_PREVIEW } from '@/config';
import { ago, hhmmdm } from '@/lib/fmt';
import { LastGoodStore, cacheScope } from './last-good';
let discoveryStorage: Storage | undefined;
try { discoveryStorage = window.localStorage; } catch {}
// Independent budget: large chart caches must not evict a partially loaded release feed.
const discoveryCache = new LastGoodStore(cacheScope(API_BASE, API_TOKEN) + ':discovery', discoveryStorage, 500000);
const lastfmTrackCache = new LastGoodStore(cacheScope(API_BASE, API_TOKEN) + ':lastfm-track-hard-v1', discoveryStorage, 2000000);
let lastfmTrackRefreshVersion=0;
const lastfmTrackListeners=new Set<()=>void>();
export const subscribeLastfmTrackRefresh=(listener:()=>void)=>{lastfmTrackListeners.add(listener);return()=>{lastfmTrackListeners.delete(listener);};};
export const lastfmTrackRefreshSnapshot=()=>lastfmTrackRefreshVersion;
export type LastfmTrackQuery={artist:string;title:string;trackId?:string};
const lastfmTrackPath=(query:LastfmTrackQuery)=>{
  const params=new URLSearchParams({artist:query.artist.trim(),title:query.title.trim()});
  return query.trackId && /^TR\d+$/.test(query.trackId) ? '/lastfm/'+query.trackId : '/lastfm?'+params;
};
const lastfmTrackKey=(query:LastfmTrackQuery)=>'discovery:lastfm-track:v1:'+lastfmTrackPath(query);
export function refreshLastfmTrackStats(queries?:LastfmTrackQuery[]) {
  const keys=queries?.map(lastfmTrackKey).filter(Boolean);
  const shouldRemove=(key:string)=>keys?.length ? keys.includes(key) : key.startsWith('discovery:lastfm-track:v1:');
  lastfmTrackCache.removeWhere(shouldRemove);
  discoveryCache.removeWhere(shouldRemove);
  lastfmTrackRefreshVersion++;
  lastfmTrackListeners.forEach(listener=>listener());
}

const EXCLUSIONS_KEY=cacheScope(API_BASE,API_TOKEN)+':release-exclusions:v1';
const FILTER_ENABLED_KEY=cacheScope(API_BASE,API_TOKEN)+':release-filter-enabled:v1';
const artistKey=(name:string)=>name.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
let excludedArtists:string[]=[];
let filterEnabled=true;
try { const saved=JSON.parse(discoveryStorage?.getItem(EXCLUSIONS_KEY) || '[]'); if(Array.isArray(saved))excludedArtists=saved.filter(n=>typeof n==='string'); } catch {}
try { const saved=discoveryStorage?.getItem(FILTER_ENABLED_KEY); if(saved!==null)filterEnabled=saved!=='0'; } catch {}
export const releaseExclusions=()=>excludedArtists;
export const isReleaseExcluded=(name:string)=>excludedArtists.some(n=>artistKey(n)===artistKey(name));
export const releaseFilterEnabled=()=>filterEnabled;
const activeExclusions=()=>filterEnabled?excludedArtists:[];
const isReleaseFiltered=(name:string)=>activeExclusions().some(n=>artistKey(n)===artistKey(name));
const exclusionParams=()=>activeExclusions().length?'&exclude='+encodeURIComponent(JSON.stringify(activeExclusions())):'';
const applyReleaseFilter=(rows:Release[])=>rows.filter(r=>!isReleaseFiltered(r.artist));
export function setReleaseFilterEnabled(enabled:boolean) {
  filterEnabled=enabled;
  discoveryStorage?.setItem(FILTER_ENABLED_KEY,enabled?'1':'0');
  publish({rows:applyReleaseFilter(feed.rows),failed:[],error:undefined});
  const {busy,error,...saved}=feed;saveReleaseFeed(saved);
  void loadReleases(true);
}
export function setReleaseExcluded(name:string,excluded:boolean) {
  const next=excluded?[...excludedArtists.filter(n=>artistKey(n)!==artistKey(name)),name]:excludedArtists.filter(n=>artistKey(n)!==artistKey(name));
  discoveryStorage?.setItem(EXCLUSIONS_KEY,JSON.stringify(next));
  excludedArtists=next;
  publish({rows:applyReleaseFilter(feed.rows),failed:[],error:undefined});
  const {busy,error,...saved}=feed;saveReleaseFeed(saved);
  void loadReleases(true);
}
export type ReleaseArtistList={artists:string[];baseCount:number;total:number;watchlist:string[];excluded:string[];recentDays:90|180;updatedAt?:string};
export async function loadReleaseArtistList():Promise<ReleaseArtistList> {
  const result=await discoveryGet('/release-artists');
  if(!Array.isArray(result.artists)||!result.artists.every((n:unknown)=>typeof n==='string'))throw Error('Danh sách nghệ sĩ chưa hợp lệ.');
  const watchlist=Array.isArray(result.watchlist)?result.watchlist.filter((n:unknown)=>typeof n==='string'):[];
  const excluded=Array.isArray(result.excluded)?result.excluded.filter((n:unknown)=>typeof n==='string'):[];
  return {artists:result.artists,baseCount:Number(result.baseCount)||result.artists.length-watchlist.length,total:Number(result.total)||result.artists.length,watchlist,excluded,recentDays:Number(result.recentDays)===180?180:90,updatedAt:typeof result.updatedAt==='string'?result.updatedAt:undefined};
}
export async function loadReleaseArtists():Promise<string[]> { return (await loadReleaseArtistList()).artists; }
export type ReleaseScanSettings={watchlist:string[];excluded:string[];recentDays?:90|180;updatedAt?:string};
const settingsApiBase=()=>BROWSER_PREVIEW && import.meta.env.DEV ? '/__api' : API_BASE;
export async function loadReleaseScanSettings():Promise<ReleaseScanSettings>{
  const response=await fetch(settingsApiBase()+'/settings/release-scan',{headers:{Authorization:'Bearer '+API_TOKEN}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new DiscoveryError(data.error || 'Chưa tải được cấu hình quét.');
  const settings=data.settings || {};
  return {watchlist:Array.isArray(settings.watchlist)?settings.watchlist.filter((n:unknown)=>typeof n==='string'):[],excluded:Array.isArray(settings.excluded)?settings.excluded.filter((n:unknown)=>typeof n==='string'):[],recentDays:Number(settings.recentDays)===180?180:90,updatedAt:typeof settings.updatedAt==='string'?settings.updatedAt:undefined};
}
export async function saveReleaseScanSettings(settings:ReleaseScanSettings):Promise<ReleaseScanSettings>{
  const response=await fetch(settingsApiBase()+'/settings/release-scan',{method:'POST',headers:{Authorization:'Bearer '+API_TOKEN,'content-type':'application/json'},body:JSON.stringify(settings)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new DiscoveryError(data.error==='unauthorized'?'Token hiện tại chưa có quyền lưu watchlist server.':data.error || 'Chưa lưu được cấu hình quét.');
  const saved=data.settings || {},recentDays=Number(saved.recentDays)===180?180:90;
  publish({recentDays});
  void loadReleases(true);
  return {watchlist:Array.isArray(saved.watchlist)?saved.watchlist.filter((n:unknown)=>typeof n==='string'):[],excluded:Array.isArray(saved.excluded)?saved.excluded.filter((n:unknown)=>typeof n==='string'):[],recentDays,updatedAt:typeof saved.updatedAt==='string'?saved.updatedAt:undefined};
}

export type AlbumRecommendationSeed={artist:string;title:string;albumId?:string;hours:number;plays:number};
export type AlbumRecommendation={id:string;title:string;artist:string;date?:string;type:string;url:string;cover:string;score:number;matchedTags:string[];similarTo:AlbumRecommendationSeed;source:'Last.fm'|'MusicBrainz'};
export async function loadAlbumRecommendations(signal?:AbortSignal, force=false):Promise<{seeds:AlbumRecommendationSeed[];rows:AlbumRecommendation[];source:string}> {
  const key='discovery:album-recommendations:v5', saved=discoveryCache.get(key);
  if(!force && saved && Date.now()-saved.at<6*3600*1000)return saved.data;
  if(force)discoveryCache.removeWhere(path=>path===key);
  const data=await discoveryGet('/album-recommendations' + (force ? '?refresh=1' : ''),signal);
  const validSeed=(seed:any)=>seed && typeof seed.artist==='string' && typeof seed.title==='string' && Number.isFinite(seed.hours) && Number.isFinite(seed.plays);
  const validRow=(row:any)=>{
    try {
      const url=new URL(row.url), cover=row.cover?new URL(row.cover):null;
      const allowedUrl = row.source === 'Last.fm'
        ? ['last.fm','www.last.fm'].includes(url.hostname)
        : url.hostname === 'musicbrainz.org';
      const allowedCover = !cover || ['coverartarchive.org','lastfm.freetls.fastly.net','lastfm-img.freetls.fastly.net','userserve-ak.last.fm'].includes(cover.hostname);
      return typeof row.id==='string' && typeof row.title==='string' && typeof row.artist==='string' && typeof row.type==='string'
        && (row.source==='Last.fm' || row.source==='MusicBrainz')
        && Number.isFinite(row.score) && Array.isArray(row.matchedTags) && row.matchedTags.every((tag:unknown)=>typeof tag==='string')
        && validSeed(row.similarTo) && url.protocol==='https:' && allowedUrl
        && (!cover || cover.protocol==='https:' && allowedCover);
    } catch { return false; }
  };
  if(!Array.isArray(data.seeds) || !data.seeds.every(validSeed) || !Array.isArray(data.rows) || !data.rows.every(validRow))throw new DiscoveryError('Danh sách album gợi ý chưa hợp lệ.');
  discoveryCache.set(key,data);
  return data;
}

export type Lyrics = { status: 'found' | 'not_found' | 'instrumental'; text?: string; source: string };
export type AppleAlbum = { status: 'found' | 'search'; url: string; reason?: 'unavailable' | 'not_found'; releaseYear?:number };
export type AppleDetailQuery = {kind:'song'|'artist'|'album'; artist:string; title?:string; album?:string; releaseId?:string; trackId?:string};
export type ApplePlaylistSong = {status:'found';url:string;storeId:string;title:string;artist:string;album:string;match:'exact'|'version'};
export function appleDetailSearch(q: AppleDetailQuery): string {
  return 'https://music.apple.com/vn/search?' + new URLSearchParams({term:[q.artist,q.kind !== 'artist' ? q.title : ''].filter(Boolean).join(' ')});
}
let detailQueue:Promise<unknown>=Promise.resolve();
const detailPending = new Map<string,Promise<AppleAlbum>>();
let catalogGeneration=0;
export function invalidateAppleLinks(){
  catalogGeneration++;
  detailPending.clear();
  discoveryCache.removeWhere(key=>key.startsWith('discovery:apple'));
}
export async function loadAppleDetail(q: AppleDetailQuery): Promise<AppleAlbum> {
  // A release already carries Apple's verified catalog identity; no second search needed.
  if(q.kind==='album' && q.releaseId){
    const known=findReleaseAlbum(q.artist,q.title || '');
    if(known?.id===q.releaseId){
      try {
        const url=new URL(known.url);
        const id=q.releaseId.match(/^itunes:([a-z]{2}):(\d+)$/);
        if(id && url.protocol==='https:' && url.hostname==='music.apple.com' && !url.username && !url.password && !url.port
          && new RegExp('^/'+id[1]+'/album/(?:[^/]+/)?'+id[2]+'/?$').test(url.pathname)){
          url.search='';url.hash='';return {status:'found',url:url.href};
        }
      } catch {}
    }
  }
  const params = new URLSearchParams({kind:q.kind,artist:q.artist});
  if (q.kind !== 'artist') { if(q.title)params.set('title',q.title); if(q.album)params.set('album',q.album); }
  if (q.kind === 'album' && q.releaseId) params.set('id',q.releaseId);
  if(q.kind==='song' && /^TR\d+$/.test(q.trackId || '')){params.set('library','1');params.set('trackId',q.trackId!);}
  const key = 'discovery:apple-detail:v3:' + params;
  const saved = discoveryCache.get(key);
  if (saved?.data.status==='found' && Date.now()-saved.at < 30*86400*1000) return saved.data;
  const pending = detailPending.get(key); if (pending) return pending;
  const generation=catalogGeneration;
  const request = detailQueue.then(()=>discoveryGet('/apple-music?' + params)).then(data=>{
    const url = new URL(data.url);
    if (!['found','search'].includes(data.status) || url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.username || url.password || url.port) throw Error('Invalid Apple Music link');
    if(data.status!=='found')throw Error(data.reason==='unavailable' ? 'Chưa lấy được liên kết Apple Music. Hãy thử lại.' : 'Chưa tìm thấy đúng phiên bản này trên Apple Music.');
    if (data.reason !== 'unavailable' && generation===catalogGeneration) discoveryCache.set(key,data);
    return data as AppleAlbum;
  }).finally(()=>{if(detailPending.get(key)===request)detailPending.delete(key);});
  detailQueue=request.catch(()=>{});
  detailPending.set(key,request); return request;
}
export async function loadApplePlaylistSong(artist:string,title:string):Promise<ApplePlaylistSong>{
  const params=new URLSearchParams({artist,title});
  const data=await discoveryGet('/apple-playlist-song?'+params);
  const url=new URL(data.url);
  if(data.status!=='found' || !/^\d+$/.test(data.storeId || '') || typeof data.title!=='string' || typeof data.artist!=='string' || typeof data.album!=='string'
    || !['exact','version'].includes(data.match) || url.protocol!=='https:' || url.hostname!=='music.apple.com' || url.username || url.password || url.port
    || url.searchParams.get('i')!==data.storeId)throw new DiscoveryError(data.error || 'Chưa tìm thấy đúng bài này trên Apple Music.');
  return data as ApplePlaylistSong;
}
export async function loadApplePlaylistSongLine(raw:string):Promise<ApplePlaylistSong>{
  const params=new URLSearchParams({raw});
  const data=await discoveryGet('/apple-playlist-song?'+params);
  const url=new URL(data.url);
  if(data.status!=='found' || !/^\d+$/.test(data.storeId || '') || typeof data.title!=='string' || typeof data.artist!=='string' || typeof data.album!=='string'
    || !['exact','version'].includes(data.match) || url.protocol!=='https:' || url.hostname!=='music.apple.com' || url.username || url.password || url.port
    || url.searchParams.get('i')!==data.storeId)throw new DiscoveryError(data.error || 'Chưa nhận dạng được tên bài và nghệ sĩ.');
  return data as ApplePlaylistSong;
}
export async function loadAppleAlbum(release: Release): Promise<AppleAlbum> {
  const key = 'discovery:apple:v2:' + JSON.stringify([release.id, release.artist, release.title]);
  const saved = discoveryCache.get(key);
  if (saved && Date.now() - saved.at < (saved.data.status === 'found' ? 86400 : 3600) * 1000) return saved.data;
  const data = await discoveryGet('/apple-music?' + new URLSearchParams({id: release.id, artist: release.artist, title: release.title}));
  const url = new URL(data.url);
  if (!['found','search'].includes(data.status) || url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.username || url.password || url.port) throw Error('Invalid Apple Music link');
  if (data.reason !== 'unavailable') discoveryCache.set(key, data);
  return data;
}
export class DiscoveryError extends Error {
  constructor(message: string, public retryAt = Date.now() + 30000) { super(message); }
}
export type LastfmTrackStats = {status:'found'|'not_found';scrobbles?:number;listeners?:number;updatedAt:string};
let lastfmQueue:Promise<unknown>=Promise.resolve();
let nextLastfmRequest=0;
export function loadLastfmTrack(query:LastfmTrackQuery,signal:AbortSignal):Promise<LastfmTrackStats> {
  const path=lastfmTrackPath(query);
  const key=lastfmTrackKey(query);
  const cached=()=>{
    const hard=lastfmTrackCache.get(key);
    if(hard?.data.status==='found')return hard.data as LastfmTrackStats;
    const hit=discoveryCache.get(key);
    return hit && Date.now()-hit.at < (hit.data.status==='found'?86400:3600)*1000 ? hit.data as LastfmTrackStats : null;
  };
  const hit=cached();if(hit)return Promise.resolve(hit);
  const request=lastfmQueue.then(async()=>{
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    const saved=cached();if(saved)return saved;
    const wait=nextLastfmRequest-Date.now();
    if(wait>0)await new Promise<void>((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},wait);
      signal.addEventListener('abort',abort,{once:true});
    });
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    try {
      const data=await discoveryGet(path,signal);
      if(!['found','not_found'].includes(data.status) || !Number.isFinite(Date.parse(data.updatedAt)) ||
        (data.status==='found' && ![data.scrobbles,data.listeners].every(n=>Number.isSafeInteger(n)&&n>=0))) throw Error('Invalid Last.fm counters');
      if(data.status==='found')lastfmTrackCache.set(key,data);
      else discoveryCache.set(key,data);
      return data as LastfmTrackStats;
    } catch(e) {
      if(e instanceof DiscoveryError)nextLastfmRequest=Math.max(nextLastfmRequest,e.retryAt);
      throw e;
    } finally {nextLastfmRequest=Math.max(nextLastfmRequest,Date.now()+550);}
  });
  lastfmQueue=request.catch(()=>{});
  return request;
}
export async function discoveryGet(path: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 60000);
  try {
    // /__discovery is a Vite development middleware. A production browser build is
    // static, so it must call the deployed Worker directly (which already permits
    // cross-origin requests). Using the dev proxy in production made every
    // discovery request, including Last.fm now-playing, resolve to the Site's 404.
    const base = BROWSER_PREVIEW && import.meta.env.DEV ? '/__discovery' : API_BASE + '/discovery';
    const response = await fetch(base + path, {
      headers: { Authorization: 'Bearer ' + API_TOKEN }, signal: controller.signal,
    });
    const text = await response.text();
    let data: any;
    try { data = text ? JSON.parse(text) : null; }
    catch { throw new DiscoveryError('Server trả về dữ liệu không hợp lệ. Hãy thử lại sau.'); }
    if (!response.ok) throw new DiscoveryError(data.error || 'Chưa tải được dữ liệu.', Date.now() + Math.max(30, Number(response.headers.get('Retry-After')) || 30) * 1000);
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export type NowPlayingTrack={title:string;artist:string;album?:string;image?:string;url?:string;libraryTrackId?:string;persistentId?:string;duration_s?:number;year?:number;date_added?:string;last_played?:string;my_rating?:number;plays?:number;allTimeRank?:number;allTimeChange?:number;allTimeComparison?:string};
export async function loadNowPlaying(signal?:AbortSignal):Promise<NowPlayingTrack|null> {
  const mock=BROWSER_PREVIEW && new URLSearchParams(window.location.search).get('nowPlaying')==='mock';
  const data=await discoveryGet('/now-playing'+(mock?'?mock=1':''),signal);
  if(!data || !('track' in data) || data.track===null)return null;
  const track=data.track;
  if(typeof track.title!=='string' || !track.title.trim() || typeof track.artist!=='string' || !track.artist.trim()
    || (track.album!=null && typeof track.album!=='string') || (track.libraryTrackId!=null && !/^TR\d+$/.test(track.libraryTrackId))
    || [track.duration_s,track.year,track.my_rating,track.plays].some(n=>n!=null && !Number.isFinite(n)))throw new DiscoveryError('Bài đang nghe chưa hợp lệ.');
  if(track.image){
    const image=new URL(track.image);
    if(image.protocol!=='https:' || !['lastfm.freetls.fastly.net','lastfm-img.freetls.fastly.net','userserve-ak.last.fm'].includes(image.hostname)
      || image.username || image.password || image.port)throw new DiscoveryError('Ảnh bài đang nghe chưa hợp lệ.');
  }
  return track as NowPlayingTrack;
}
export const vnDate = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
// Partial dates must not claim an album has already come out during its current month/year.
export function releasePhase(date: string, today: string): 'recent' | 'upcoming' | 'unknown' {
  const last = date.length === 4 ? date + '-12-31' : date.length === 7
    ? date + '-' + new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0)).getUTCDate() : date;
  const first = date.length === 4 ? date + '-01-01' : date.length === 7 ? date + '-01' : date;
  return last <= today ? 'recent' : first > today ? 'upcoming' : 'unknown';
}
export function releaseInWindow(date: string, mode: string, today: string, recentDays=90) {
  if (releasePhase(date,today) !== mode) return false;
  const start = new Date(Date.parse(today+'T00:00:00Z')-Math.max(1,Math.min(180,recentDays))*86400000).toISOString().slice(0,10);
  const end = (Number(today.slice(0,4))+1)+today.slice(4);
  const last = date.length===4 ? date+'-12-31' : date.length===7 ? date+'-'+new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0)).getUTCDate() : date;
  const first = date.length===4 ? date+'-01-01' : date.length===7 ? date+'-01' : date;
  return mode==='recent' ? last>=start : first<=end;
}
export function releaseDate(date: string) {
  const parts = date.split('-');
  return parts.length === 3 ? parts.reverse().join('/') : parts.length === 2 ? `Tháng ${Number(parts[1])}/${parts[0]}` : `Năm ${date}`;
}
export function releaseGroup(date: string, mode: string, today: string) {
  if (date.length < 10) return 'Chưa có ngày cụ thể';
  if (mode === 'recent') {
    const age = Math.round((Date.parse(today) - Date.parse(date)) / 86400000);
    return age < 7 ? '7 ngày qua' : date.slice(0,7) === today.slice(0,7) ? 'Tháng này' : `Tháng ${Number(date.slice(5,7))}/${date.slice(0,4)}`;
  }
  return date.slice(0,7) === today.slice(0,7) ? 'Tháng này' : `Tháng ${Number(date.slice(5,7))}/${date.slice(0,4)}`;
}

type FailedReleasePage={cursor:string;source:string;retryAfter:number};
export type ReleaseScanInfo={cycleStartedAt?:string;updatedAt?:string;completedAt?:string;cursor?:string|null};
type Feed = { failed:FailedReleasePage[]; rows: Release[]; checked: number; total: number; next: string | null; asOf: string; unverified: number; recentDays:90|180; scan?: ReleaseScanInfo|null; busy: boolean; error?: DiscoveryError };
const CACHE = 'discovery:releases:v6';
// Keep the release list separately so song/lyrics caches cannot evict it.
const releaseCache = new LastGoodStore(cacheScope(API_BASE, API_TOKEN) + ':release-feed', discoveryStorage, 500000);
const cached = releaseCache.get(CACHE) || discoveryCache.get(CACHE);
let hasSavedReleaseFeed = Array.isArray(cached?.data?.rows);
let feed: Feed = hasSavedReleaseFeed
  ? { ...cached!.data, rows:applyReleaseFilter(mergeReleases(cached!.data.rows)), failed:[], next:null, recentDays:Number(cached!.data.recentDays)===180?180:90, busy: false }
  : { failed:[], rows: [], checked: 0, total: 0, next: null, asOf: vnDate(), unverified: 0, recentDays:90, scan:null, busy: false };
function saveReleaseFeed(snapshot: Omit<Feed, 'busy' | 'error'>) {
  hasSavedReleaseFeed = true;
  releaseCache.set(CACHE, snapshot);
}
if (hasSavedReleaseFeed) { const {busy,error,...snapshot}=feed; saveReleaseFeed(snapshot); }
// Show the local copy immediately, then refresh only from the server snapshot.
// Provider scans are scheduled on the Worker and are never started by the app.
export async function openReleases() {
  return loadReleases();
}
let snapshotPending:Promise<void>|undefined;
function restoreServerReleases() {
  if(snapshotPending)return snapshotPending;
  snapshotPending=discoveryGet('/upcoming?snapshot=1'+exclusionParams()).then(result=>{
    if(!Array.isArray(result.rows) || !Number.isFinite(result.checked) || !Number.isFinite(result.total))throw Error('Invalid release snapshot');
    publish({rows:applyReleaseFilter(mergeReleases([...feed.rows,...result.rows])),checked:result.checked,total:result.total,
      next:null,asOf:typeof result.asOf==='string'?result.asOf:vnDate(),failed:[],unverified:Number(result.unverified)||0,recentDays:result.recentDays==null?feed.recentDays:Number(result.recentDays)===180?180:90,
      scan:result.scan&&typeof result.scan==='object'?result.scan:null});
    const {busy,error,...saved}=feed;saveReleaseFeed(saved);
  }).finally(()=>{snapshotPending=undefined;});
  return snapshotPending;
}
const listeners = new Set<() => void>();
const releaseAlbumCacheKey=(artist:string,title:string)=>'discovery:album:'+JSON.stringify([artist,title]);
const releaseIdentityKey=(artist:string,title:string)=>JSON.stringify([artist,title].map(value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')));
export type SavedReleaseSource='other'|'recommend'|'playlistRecommend'|'recent'|'upcoming';
export type SavedReleaseAlbum=Release & { savedSource?:SavedReleaseSource; savedAt?:string };
const SAVED_RELEASES_KEY=cacheScope(API_BASE,API_TOKEN)+':saved-release-albums:v1';
const SAVED_RELEASE_EXCLUDES_KEY=cacheScope(API_BASE,API_TOKEN)+':saved-release-excludes:v1';
const savedReleaseListeners=new Set<()=>void>();
const isSavedReleaseSource=(value:unknown):value is SavedReleaseSource=>['other','recommend','playlistRecommend','recent','upcoming'].includes(String(value));
function isRelease(value:unknown):value is Release {
  const row=value as Partial<Release>;
  return !!row && typeof row==='object' && ['id','title','artist','date','type','url','cover'].every(key=>typeof (row as Record<string,unknown>)[key]==='string') && typeof row.owned==='boolean';
}
function readSavedReleaseAlbums():SavedReleaseAlbum[] {
  try {
    const saved=JSON.parse(discoveryStorage?.getItem(SAVED_RELEASES_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(isRelease).map(row=>({
      ...row,
      savedSource:isSavedReleaseSource((row as SavedReleaseAlbum).savedSource)?(row as SavedReleaseAlbum).savedSource:'other',
      savedAt:typeof (row as SavedReleaseAlbum).savedAt==='string'?(row as SavedReleaseAlbum).savedAt:undefined,
    })) : [];
  } catch { return []; }
}
let savedReleaseRows=readSavedReleaseAlbums();
let savedReleaseExcludedKeys:string[]=[];
try {
  const saved=JSON.parse(discoveryStorage?.getItem(SAVED_RELEASE_EXCLUDES_KEY) || '[]');
  if(Array.isArray(saved))savedReleaseExcludedKeys=saved.filter(key=>typeof key==='string');
} catch {}
function writeSavedReleaseAlbums() {
  try { discoveryStorage?.setItem(SAVED_RELEASES_KEY,JSON.stringify(savedReleaseRows)); } catch {}
  savedReleaseListeners.forEach(listener=>listener());
}
function writeSavedReleaseExcludes() {
  try { discoveryStorage?.setItem(SAVED_RELEASE_EXCLUDES_KEY,JSON.stringify(savedReleaseExcludedKeys)); } catch {}
  savedReleaseListeners.forEach(listener=>listener());
}
export function rememberReleaseAlbum(release:Release) {
  discoveryCache.set(releaseAlbumCacheKey(release.artist,release.title),release);
}
export function findReleaseAlbum(artist:string,title:string):Release|undefined {
  return feed.rows.find(r=>r.artist===artist && r.title===title)
    || savedReleaseRows.find(r=>releaseIdentityKey(r.artist,r.title)===releaseIdentityKey(artist,title))
    || discoveryCache.get(releaseAlbumCacheKey(artist,title))?.data;
}
export const savedReleaseAlbums=()=>savedReleaseRows;
export const savedReleaseExclusions=()=>savedReleaseExcludedKeys;
export const subscribeSavedReleases=(listener:()=>void)=>{savedReleaseListeners.add(listener);return()=>{savedReleaseListeners.delete(listener);};};
export const isReleaseSaved=(release:Pick<Release,'artist'|'title'>)=>savedReleaseRows.some(row=>releaseIdentityKey(row.artist,row.title)===releaseIdentityKey(release.artist,release.title));
export const isSavedReleaseExcluded=(release:Pick<Release,'artist'|'title'>)=>savedReleaseExcludedKeys.includes(releaseIdentityKey(release.artist,release.title));
export function setSavedReleaseExcluded(release:Pick<Release,'artist'|'title'>,excluded:boolean) {
  const key=releaseIdentityKey(release.artist,release.title);
  savedReleaseExcludedKeys=excluded?[key,...savedReleaseExcludedKeys.filter(item=>item!==key)]:savedReleaseExcludedKeys.filter(item=>item!==key);
  writeSavedReleaseExcludes();
}
export function setReleaseSaved(release:Release,saved:boolean,source:SavedReleaseSource='other') {
  const key=releaseIdentityKey(release.artist,release.title);
  const existing=savedReleaseRows.filter(row=>releaseIdentityKey(row.artist,row.title)!==key);
  savedReleaseRows=saved ? [{...release,savedSource:source,savedAt:new Date().toISOString()},...existing] : existing;
  if(saved)rememberReleaseAlbum(release);
  writeSavedReleaseAlbums();
}

export function releaseScanLabel(scan?:ReleaseScanInfo|null) {
  const value=scan?.completedAt || scan?.updatedAt || scan?.cycleStartedAt;
  if(!value)return '';
  const prefix=scan?.completedAt ? 'Cập nhật' : scan?.updatedAt ? 'Đang quét, cập nhật' : 'Bắt đầu quét';
  return `${prefix} ${ago(value)} (${hhmmdm(value)})`;
}
export const releaseSnapshot = () => feed;
export const subscribeReleases = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(patch: Partial<Feed>) { feed = { ...feed, ...patch }; listeners.forEach(f=>f()); }
export async function loadReleases(_refresh = false) {
  if (feed.busy || (feed.error?.retryAt || 0) > Date.now()) return;
  publish({busy:true,error:undefined});
  try {
    await restoreServerReleases();
  } catch (error) {
    publish({error:error instanceof DiscoveryError?error:new DiscoveryError('Chưa tải được dữ liệu đã lưu trên server. Danh sách cũ vẫn được giữ lại.')});
  } finally { publish({busy:false}); }
}
export async function loadLyrics(id: string, signal: AbortSignal): Promise<Lyrics> {
  const key = 'discovery:lyrics:' + id, saved = discoveryCache.get(key);
  if (saved && Date.now() - saved.at < (saved.data.status === 'not_found' ? 1 : 7) * 86400000) return saved.data;
  const data = await discoveryGet('/lyrics/' + encodeURIComponent(id), signal);
  if (!['found','not_found','instrumental'].includes(data.status) || data.status === 'found' && typeof data.text !== 'string') throw Error('Invalid lyrics');
  discoveryCache.set(key, data);
  return data;
}

export type SimilarTrack = { title: string; artist: string; url: string; match: number; libraryTrackId?: string; scrobbles?: number; listeners?: number; album?: string; image?: string; duration_s?: number };
export async function loadSimilarTracks(id: string, signal: AbortSignal): Promise<SimilarTrack[]> {
  const key = 'discovery:similar:v3:' + id, saved = discoveryCache.get(key);
  if (saved && Date.now() - saved.at < 300 * 1000) return saved.data;
  const data = await discoveryGet('/similar/' + encodeURIComponent(id), signal);
  if (!Array.isArray(data.tracks) || !data.tracks.every((r: SimilarTrack) => {
    try {
      const url = new URL(r.url);
      return typeof r.title === 'string' && typeof r.artist === 'string' && Number.isFinite(r.match)
        && (r.libraryTrackId == null || /^TR\d+$/.test(r.libraryTrackId))
        && [r.scrobbles, r.listeners, r.duration_s].every(n => n == null || Number.isSafeInteger(n) && n >= 0)
        && (r.album == null || typeof r.album === 'string')
        && (r.image == null || (() => { try { const image = new URL(r.image); return image.protocol === 'https:' && ['lastfm.freetls.fastly.net', 'lastfm-img.freetls.fastly.net', 'userserve-ak.last.fm'].includes(image.hostname) && !image.username && !image.password && !image.port; } catch { return false; } })())
        && url.protocol === 'https:' && ['last.fm', 'www.last.fm'].includes(url.hostname) && !url.username && !url.password && !url.port;
    } catch { return false; }
  })) throw Error('Invalid similar tracks');
  if (!data.partial) discoveryCache.set(key, data.tracks);
  return data.tracks;
}


export type SimilarAlbum = { title: string; artist: string; url: string; match: number; image?: string; scrobbles?: number; listeners?: number };
export async function loadSimilarAlbums(artist: string, title: string, signal?: AbortSignal): Promise<SimilarAlbum[]> {
  const params = new URLSearchParams({ artist, album: title });
  const key = 'discovery:similar-albums:v1:' + params, saved = discoveryCache.get(key);
  if (saved && Date.now() - saved.at < 86400 * 1000) return saved.data;
  const data = await discoveryGet('/similar-albums?' + params, signal);
  if (!Array.isArray(data.albums) || !data.albums.every((r: SimilarAlbum) => {
    try {
      const url = new URL(r.url);
      return typeof r.title === 'string' && typeof r.artist === 'string' && Number.isFinite(r.match)
        && [r.scrobbles, r.listeners].every(n => n == null || Number.isSafeInteger(n) && n >= 0)
        && (r.image == null || (() => { try { const image = new URL(r.image); return image.protocol === 'https:' && ['lastfm.freetls.fastly.net', 'lastfm-img.freetls.fastly.net', 'userserve-ak.last.fm'].includes(image.hostname) && !image.username && !image.password && !image.port; } catch { return false; } })())
        && url.protocol === 'https:' && ['last.fm', 'www.last.fm'].includes(url.hostname) && !url.username && !url.password && !url.port;
    } catch { return false; }
  })) throw new DiscoveryError('Chưa tải được album tương tự.');
  discoveryCache.set(key, data.albums);
  return data.albums;
}

export type AlbumCatalogTrack={id:string;title:string;artist:string;disc:number;trackNumber:number;duration_s?:number;releaseDate?:string};
export type AlbumCatalog={tracks:AlbumCatalogTrack[];source:string;sourceUrl:string};
export async function loadAlbumTracks(artist:string,title:string,releaseId?:string,signal?:AbortSignal):Promise<AlbumCatalog|null> {
  const params=new URLSearchParams({artist,title});
  if(releaseId)params.set('id',releaseId);
  const key='discovery:album-tracks:v5:'+params, saved=discoveryCache.get(key);
  if(saved && Date.now()-saved.at<86400000)return saved.data;
  const data=await discoveryGet('/album-tracks?'+params,signal);
  if(data===null)return null;
  if(!Array.isArray(data.tracks) || !data.tracks.length || !data.tracks.every((r:any)=>
    typeof r.id==='string' && typeof r.title==='string' && typeof r.artist==='string'
    && Number.isInteger(r.disc) && r.disc>0 && Number.isInteger(r.trackNumber) && r.trackNumber>0
    && (r.duration_s==null || Number.isFinite(r.duration_s) && r.duration_s>=0)))throw new DiscoveryError('Danh sách bài hát chưa hợp lệ.');
  const source=new URL(data.sourceUrl);
  const validHost=source.hostname==='musicbrainz.org' || source.hostname.endsWith('.bandcamp.com');
  if(source.protocol!=='https:' || !validHost || !['MusicBrainz','Bandcamp'].includes(data.source))throw new DiscoveryError('Nguồn album chưa hợp lệ.');
  discoveryCache.set(key,data);return data;
}
