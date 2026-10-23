import { mergeReleases, validReleaseCursor, type Release } from '../../shared/releases';
import { bandcampReleases } from './bandcamp';
export type { Release } from '../../shared/releases';
// Shared by the Worker and the local browser preview. No library writes or sync jobs.
export type Track = { id: string; title: string; artist?: string | null; album_artist?: string | null; album?: string | null; genre?:string | null; duration_s?: number | null; year?:number|null;date_added?:string|null;last_played?:string|null;my_rating?:number|null;in_library?: number; plays?: number };
export interface DiscoveryStore {
  catalogLookup?(keys:string[]):Promise<string|null>;
  list?(prefix:string):Promise<any[]>;
  get(key: string): Promise<any | null>;
  put(key: string, value: unknown, seconds: number): Promise<void>;
  acquire(provider: string, intervalMs: number): Promise<boolean>;
}
export class SourceError extends Error { constructor(message: string, public retryAfter = 30) { super(message); } }
const UA = 'MusicStats/2.0 (https://stats.helloween2610.workers.dev)';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const normal = (s: unknown) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const lyricTitle = (s: string) => s.replace(/\s+\d+\.\d+(?=\s*(?:\(|$))/g, '').trim();
const baseTitle = (s: string) => normal(lyricTitle(s).replace(/\s*[([][^\])]*(?:remaster|live|version|edit)[^\])]*[\])]/gi, ''));
const quote = (s: string) => '"' + s.replace(/[\\"]/g, '\\$&') + '"';
export async function keyOf(s: string) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,'0')).join(''); }

type JsonProvider='mb'|'mb-releases'|'mb-release-group'|'mb-artists'|'mb-entity'|'bandcamp'|'bandcamp-search'|'bandcamp-details'|'lrclib'|'itunes';
const validSourceResult=(provider:JsonProvider,result:any)=>provider === 'lrclib' ? Array.isArray(result)
  : provider === 'itunes' ? Array.isArray(result?.results) && typeof result.resultCount === 'number'
  : provider === 'bandcamp' ? Number.isSafeInteger(result?.id) && Array.isArray(result?.discography)
  : provider === 'bandcamp-search' ? Array.isArray(result?.auto?.results)
  : provider === 'bandcamp-details' ? Number.isSafeInteger(result?.id) && ['a','t'].includes(result?.type) && typeof result?.title==='string' && Array.isArray(result?.tracks)
  : provider === 'mb-artists' ? Array.isArray(result?.artists) && typeof result.count === 'number'
  : provider === 'mb-release-group' ? typeof result?.id === 'string' && typeof result?.title === 'string'
  : provider === 'mb-entity' ? typeof result?.id === 'string' && Array.isArray(result?.relations)
  : provider === 'mb-releases' ? Array.isArray(result?.releases) && typeof result['release-count'] === 'number'
  : Array.isArray(result?.['release-groups']) && typeof result.count === 'number';

async function bandcampReaderJson(url:string,fetcher:typeof fetch){
  const response=await fetcher('https://r.jina.ai/'+url,{headers:{'User-Agent':UA,Accept:'text/plain'},signal:AbortSignal.timeout(20_000)});
  if(!response.ok){console.warn('Bandcamp reader unavailable',{status:response.status});throw new SourceError('Chưa kết nối được Bandcamp. Hãy thử lại sau.');}
  const text=await response.text(),marker='Markdown Content:',at=text.indexOf(marker);
  if(at<0)throw new SourceError('Bandcamp trả kết quả chưa hợp lệ.');
  return JSON.parse(text.slice(at+marker.length).trim());
}

async function itunesReaderJson(url:string,fetcher:typeof fetch){
  const response=await fetcher('https://r.jina.ai/'+url,{headers:{'User-Agent':UA,Accept:'text/plain'},signal:AbortSignal.timeout(20_000)});
  if(!response.ok){
    const raw=response.headers.get('Retry-After');
    const seconds=Math.max(60,Number(raw)||(raw?Math.ceil((Date.parse(raw)-Date.now())/1000):0)||60);
    const error=new SourceError('Chưa kết nối được Apple Music. Hãy thử lại sau.',seconds);
    (error as SourceError & {status?:number}).status=response.status;
    throw error;
  }
  const text=await response.text(),marker='Markdown Content:',at=text.indexOf(marker);
  if(at<0)throw new SourceError('Apple Music trả kết quả chưa hợp lệ.');
  return JSON.parse(text.slice(at+marker.length).trim());
}

async function itunesTranslatedJson(url:string,fetcher:typeof fetch){
  const target=new URL(url),params=new URLSearchParams(target.search);
  // en -> en keeps catalog strings unchanged; Google only acts as independent
  // network egress when Apple's public endpoint limits Cloudflare addresses.
  params.set('_x_tr_sl','en');params.set('_x_tr_tl','en');params.set('_x_tr_hl','en');
  const proxy=`https://${target.hostname.replace(/\./g,'-')}.translate.goog${target.pathname}?${params}`;
  const response=await fetcher(proxy,{headers:{'User-Agent':UA,Accept:'application/json'},signal:AbortSignal.timeout(20_000)});
  if(!response.ok){
    const error=new SourceError('Chưa kết nối được Apple Music. Hãy thử lại sau.');
    (error as SourceError & {status?:number}).status=response.status;throw error;
  }
  return response.json();
}

function appleWebRows(value:any){
  const items:any[]=[] , stack:any[]=[value];
  while(stack.length){
    const current=stack.pop();
    if(Array.isArray(current)){stack.push(...current);continue;}
    if(!current || typeof current!=='object')continue;
    if(['songs','albums','artists'].includes(current.itemKind) && typeof current.title==='string')items.push(current);
    stack.push(...Object.values(current));
  }
  const descriptor=(item:any)=>item?.contentDescriptor;
  const artist=(item:any)=>{
    const subtitle=String(item?.subtitle||'').replace(/\u202f/g,' ');
    return subtitle.match(/^(?:Song|Album)\s*·\s*(.+)$/i)?.[1]?.trim() || '';
  };
  const collectionId=(value:unknown)=>{
    try{return new URL(String(value)).pathname.match(/^\/[a-z]{2}\/album\/(?:[^/]+\/)?(\d+)\/?$/)?.[1]||'';}catch{return '';}
  };
  const albums=new Map<string,{title:string;artist:string}>();
  for(const item of items)if(item.itemKind==='albums'){
    const id=collectionId(descriptor(item)?.url);if(id)albums.set(id,{title:item.title,artist:artist(item)});
  }
  const rows:any[]=[] , seen=new Set<string>();
  for(const item of items){
    const url=descriptor(item)?.url;if(typeof url!=='string')continue;
    let row:any;
    if(item.itemKind==='songs'){
      const id=collectionId(url),album=albums.get(id);
      row={kind:'song',artistName:artist(item),trackName:item.title,collectionName:album?.title,trackViewUrl:url};
    }else if(item.itemKind==='albums')row={collectionType:'Album',artistName:artist(item),collectionName:item.title,collectionViewUrl:url};
    else row={wrapperType:'artist',artistName:item.title,artistLinkUrl:url};
    const key=JSON.stringify(row);if(!seen.has(key)){seen.add(key);rows.push(row);}
  }
  return {resultCount:rows.length,results:rows};
}

async function itunesWebJson(url:string,fetcher:typeof fetch){
  const target=new URL(url),term=target.searchParams.get('term');
  if(!term)throw new SourceError('Yêu cầu này không có trang tìm kiếm Apple Music.');
  const country=(target.searchParams.get('country')||'vn').toLowerCase();
  const page=`https://music.apple.com/${country}/search?`+new URLSearchParams({term});
  const response=await fetcher(page,{headers:{'User-Agent':UA,Accept:'text/html'},signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw new SourceError('Chưa tải được trang Apple Music.');
  const html=await response.text(),match=html.match(/<script[^>]*\bid=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if(!match)throw new SourceError('Trang Apple Music trả kết quả chưa hợp lệ.');
  const result=appleWebRows(JSON.parse(match[1]));
  if(!validSourceResult('itunes',result))throw new SourceError('Trang Apple Music trả kết quả chưa hợp lệ.');
  return result;
}

async function itunesBridgeJson(url:string,fetcher:typeof fetch){
  try{return await itunesWebJson(url,fetcher);}
  catch(error){console.warn('Apple Music web search unavailable',{error:error instanceof Error?error.message:String(error)});}
  try{
    const result=await itunesTranslatedJson(url,fetcher);
    if(validSourceResult('itunes',result))return result;
  }catch(error){console.warn('Apple Music translate bridge unavailable',{error:error instanceof Error?error.message:String(error)});}
  return itunesReaderJson(url,fetcher);
}

async function itunesSourceJson(url:string,key:string,store:DiscoveryStore,fetcher:typeof fetch){
  const saved=await store.get(key);if(saved)return saved;
  const directCooldown=await store.get('cooldown:itunes');
  if(!directCooldown){
    let acquired=false;
    for(let i=0;i<12;i++){
      const shared=await store.get(key);if(shared)return shared;
      if(await store.get('cooldown:itunes'))break;
      if(await store.acquire('itunes',5000)){acquired=true;break;}
      await wait(1100);
    }
    if(acquired){
      let response:Response|undefined,result:any;
      try{
        response=await fetcher(url,{headers:{'User-Agent':UA,Accept:'application/json'},signal:AbortSignal.timeout(12_000)});
        if(response.ok)result=await response.json();
      }catch(error){console.warn('Direct iTunes request failed',{error:error instanceof Error?error.message:String(error)});}
      if(validSourceResult('itunes',result)){
        await store.put(key,result,7*86400);return result;
      }
      if(response){
        console.warn('Direct iTunes source unavailable',{status:response.status});
        const raw=response.headers.get('Retry-After');
        const seconds=Math.max(60,Number(raw)||(raw?Math.ceil((Date.parse(raw)-Date.now())/1000):0)||60);
        if(response.status===429||response.status===503)await store.put('cooldown:itunes',{seconds},seconds);
      }
    }
  }

  // Apple often rate-limits shared Cloudflare egress even for one user. The
  // reader fetches the same public iTunes JSON through independent egress; all
  // matching and URL validation still happen locally before a link is returned.
  const relayBucket='itunes-reader',relayCooldown=await store.get('cooldown:'+relayBucket);
  if(relayCooldown)throw new SourceError('Nguồn Apple Music đang giới hạn truy cập. Hãy thử lại sau.',relayCooldown.seconds);
  let acquired=false;
  for(let i=0;i<8;i++){
    const shared=await store.get(key);if(shared)return shared;
    const paused=await store.get('cooldown:'+relayBucket);
    if(paused)throw new SourceError('Nguồn Apple Music đang giới hạn truy cập. Hãy thử lại sau.',paused.seconds);
    if(await store.acquire(relayBucket,2000)){acquired=true;break;}
    await wait(500);
  }
  if(!acquired)throw new SourceError('Nguồn Apple Music đang bận. Hãy thử lại sau.');
  try{
    const result=await itunesBridgeJson(url,fetcher);
    if(!validSourceResult('itunes',result))throw new SourceError('Apple Music trả kết quả chưa hợp lệ.');
    await store.put(key,result,7*86400);return result;
  }catch(error){
    const source=error instanceof SourceError?error:new SourceError('Chưa kết nối được Apple Music. Hãy thử lại sau.');
    const status=(source as SourceError & {status?:number}).status;
    if(status===429||status===503)await store.put('cooldown:'+relayBucket,{seconds:source.retryAfter},source.retryAfter);
    throw source;
  }
}

async function bandcampTranslatedJson(url:string,fetcher:typeof fetch){
  const target=new URL(url),params=new URLSearchParams(target.search);
  params.set('_x_tr_sl','auto');params.set('_x_tr_tl','en');params.set('_x_tr_hl','en');
  const proxy=`https://${target.hostname.replace(/\./g,'-')}.translate.goog${target.pathname}?${params}`;
  const response=await fetcher(proxy,{headers:{'User-Agent':UA,Accept:'application/json'},signal:AbortSignal.timeout(20_000)});
  if(!response.ok){console.warn('Bandcamp JSON bridge unavailable',{status:response.status});throw new SourceError('Chưa kết nối được Bandcamp. Hãy thử lại sau.');}
  return response.json();
}

export async function sourceJson(url: string, provider: JsonProvider, store: DiscoveryStore, fetcher: typeof fetch, request?:{method:'POST';body:string}) {
  const key = 'source:' + await keyOf(url+(request?'\n'+request.body:''));
  const saved = await store.get(key);
  if (saved) return saved;
  if(provider==='itunes' && !request)return itunesSourceJson(url,key,store,fetcher);
  const bucket = provider.startsWith('mb') ? 'mb' : provider.startsWith('bandcamp') ? 'bandcamp' : provider;
  const cooldown = await store.get('cooldown:' + bucket);
  if (cooldown) throw new SourceError('Nguồn dữ liệu đang giới hạn truy cập. Hãy thử lại sau.', cooldown.seconds);
  let acquired = false;
  for (let i=0;i<(bucket==='itunes'?12:5);i++) {
    // Another tab may have filled this cache while this request waited its turn.
    const shared=await store.get(key); if(shared)return shared;
    const paused=await store.get('cooldown:' + bucket);
    if(paused)throw new SourceError('Nguồn dữ liệu đang giới hạn truy cập. Hãy thử lại sau.',paused.seconds);
    if (await store.acquire(bucket, bucket === 'mb' ? 2000 : bucket === 'bandcamp' ? 3000 : bucket === 'itunes' ? 5000 : 500)) { acquired = true; break; }
    await wait(1100);
  }
  if (!acquired) throw new SourceError('Nguồn dữ liệu đang bận. Hãy thử lại sau.');
  let result:any,res:Response|undefined;
  const readerEligible=(provider==='bandcamp' || provider==='bandcamp-details') && !request;
  const proxyOnly=readerEligible && !!await store.get('bandcamp-proxy:v1');
  if(proxyOnly){
    try{result=await bandcampTranslatedJson(url,fetcher);}
    catch{result=await bandcampReaderJson(url,fetcher);}
  }
  else {
    try{
      res=await fetcher(url, { headers: { 'User-Agent': bucket==='bandcamp'?'Bandcamp/3.1.0 (Android 15)':UA, Accept: 'application/json',...(request?{'Content-Type':'application/json'}:{}) },
        ...(request?{method:request.method,body:request.body}:{}),signal: AbortSignal.timeout(12_000) });
      if(res.ok)result=await res.json();
    }catch(error){if(!readerEligible)throw error;}
    if(readerEligible && !validSourceResult(provider,result)){
      try{result=await bandcampTranslatedJson(url,fetcher);}
      catch{result=await bandcampReaderJson(url,fetcher);}
      await store.put('bandcamp-proxy:v1',{enabled:true},86400);
    }
  }
  if(res && !res.ok && !readerEligible) {
    console.warn('Discovery source unavailable', { provider, status: res.status });
    const raw = res.headers.get('Retry-After');
    const seconds = Math.max(bucket === 'itunes' ? 60 : 30, Number(raw) || (raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : 0) || 30);
    if (res.status === 429 || res.status === 503) await store.put('cooldown:' + bucket, { seconds }, seconds);
    throw new SourceError('Chưa kết nối được nguồn dữ liệu. Hãy thử lại sau.', seconds);
  }
  const valid=validSourceResult(provider,result);
  if (!valid) {
    console.warn('Discovery source returned invalid data',{provider,keys:result&&typeof result==='object'?Object.keys(result).slice(0,12):[],idType:typeof result?.id});
    throw new SourceError('Nguồn dữ liệu trả kết quả chưa hợp lệ.');
  }
  await store.put(key, result, bucket === 'mb' || bucket === 'bandcamp' ? 86400 : provider === 'itunes' ? 3600 : 7 * 86400);
  return result;
}

export function chooseLyrics(track: Track, results: any[]) {
  const candidates = results.filter(r => r && typeof r.artistName === 'string' && typeof r.trackName === 'string' && normal(r.artistName) === normal(track.artist) && baseTitle(r.trackName) === baseTitle(track.title));
  const live = (s: string) => /\blive\b/i.test(s);
  candidates.sort((a,b) => {
    const score = (r: any) => (normal(r.albumName) === normal(track.album) ? 10000 : 0)
      + (live(r.trackName + ' ' + r.albumName) === live(track.title + ' ' + track.album) ? 1000 : 0)
      + (r.plainLyrics?.trim() ? 100 : 0) - Math.min(99, Math.abs((r.duration || 0) - (track.duration_s || 0)));
    return score(b) - score(a);
  });
  return candidates[0];
}
export async function lyrics(track: Track, store: DiscoveryStore, fetcher: typeof fetch = fetch) {
  if (!track.artist) return { status: 'not_found', source: 'LRCLIB' };
  const params = new URLSearchParams({ artist_name: track.artist, track_name: lyricTitle(track.title) });
  let data = await sourceJson('https://lrclib.net/api/search?' + params, 'lrclib', store, fetcher);
  if (!Array.isArray(data)) throw new SourceError('Nguồn lyrics trả dữ liệu chưa hợp lệ.');
  let match = chooseLyrics(track, data);
  if (!match && /[([]/.test(params.get('track_name')!)) {
    params.set('track_name', lyricTitle(track.title).replace(/\s*[([][^\])]*(?:remaster|live|version|edit)[^\])]*[\])]/gi, '').trim());
    data = await sourceJson('https://lrclib.net/api/search?' + params, 'lrclib', store, fetcher);
    if (!Array.isArray(data)) throw new SourceError('Nguồn lyrics trả dữ liệu chưa hợp lệ.');
    match = chooseLyrics(track, data);
  }
  if (!match) return { status: 'not_found', source: 'LRCLIB' };
  const text = String(match.plainLyrics || '').trim();
  return { status: text ? 'found' : match.instrumental ? 'instrumental' : 'not_found', text: text.slice(0,100000), source: 'LRCLIB', sourceUrl: 'https://lrclib.net', album: match.albumName, matchedTitle: match.trackName };
}

export function releaseTracks(tracks:Track[],excluded:string[]=[],watchlist:string[]=[]) {
  const keys=new Set(excluded.map(normal));
  const rows=tracks.filter(t=>!keys.has(normal(t.album_artist || t.artist)));
  const manual=new Set<string>();
  for(const name of watchlist.map(n=>n.trim()).filter(Boolean)){
    const key=normal(name);
    if(!key || keys.has(key) || manual.has(key))continue;
    // Manual watchlist is an explicit scan request. Add a marker row even when
    // the artist already exists in the library but is below the automatic
    // listening-time threshold used by libraryArtists().
    rows.push({id:'WATCH:'+key,title:'Manual watchlist',artist:name,album_artist:name,album:null,genre:null,duration_s:3600,in_library:1,plays:1} as Track);
    manual.add(key);
  }
  return rows;
}
export function libraryArtists(tracks: Track[]) {
  const seconds = new Map<string, number>();
  for (const t of tracks) {
    const key = normal(t.album_artist || t.artist);
    seconds.set(key, (seconds.get(key) || 0) + Math.max(0, Number(t.duration_s) || 0) * Math.max(0, Number(t.plays) || 0));
  }
  const melodeath=new Set(tracks.filter(t=>t.in_library!==0 && normal(t.genre)==='melodeathmetal').map(t=>normal(t.album_artist || t.artist)));
  const map = new Map<string, { name: string; albums: string[]; manual?: boolean }>();
  for (const t of tracks) {
    if (t.in_library === 0) continue;
    const name = (t.album_artist || t.artist || '').trim();
    if (!name || ((seconds.get(normal(name)) || 0) <= 1800 && !melodeath.has(normal(name))) || /^(various artists|unknown artist)$/i.test(name)) continue;
    const k = normal(name), entry = map.get(k) || { name, albums: [] };
    if (String(t.id || '').startsWith('WATCH:')) entry.manual = true;
    if (t.album && !entry.albums.includes(t.album)) entry.albums.push(t.album);
    map.set(k, entry);
  }
  return [...map.values()].sort((a,b) => (seconds.get(normal(b.name)) || 0)-(seconds.get(normal(a.name)) || 0) || a.name.localeCompare(b.name, 'en'));
}
export function dateBounds(date: string) {
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (year < 1900 || month != null && (month < 1 || month > 12)) return null;
  const last = month ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 31;
  if (day != null && (day < 1 || day > last)) return null;
  return { lo: date.length === 4 ? date + '-01-01' : date.length === 7 ? date + '-01' : date,
    hi: date.length === 4 ? date + '-12-31' : date.length === 7 ? date + '-' + last : date };
}
export function upcomingDate(date: string, today: string, end: string) {
  const bounds = dateBounds(date);
  return !!bounds && bounds.hi >= today && bounds.lo <= end;
}
export async function musicBrainzUpcoming(tracks: Track[], cursor: string, store: DiscoveryStore, fetcher: typeof fetch = fetch, today = new Date(Date.now()+7*3600000).toISOString().slice(0,10), recentDays=90) {
  const artists = libraryArtists(tracks), [start, page] = /^\d+~\d+$/.test(cursor) ? cursor.split('~').map(Number) : [0,0];
  if (start > artists.length || page > 10000) throw new SourceError('Trang dữ liệu không hợp lệ.');
  const batch = artists.slice(start, start + 8), end = (Number(today.slice(0,4))+1) + today.slice(4);
  const from = new Date(Date.parse(today+'T00:00:00Z') - Math.max(1,Math.min(180,recentDays))*86400000).toISOString().slice(0,10);
  if (!batch.length) return { rows: [], checked: artists.length, total: artists.length, next: null, asOf: today, end, unverified: 0 };
  const query = `(${batch.map(a=>'artistname:'+quote(a.name)).join(' OR ')}) AND (primarytype:album OR primarytype:ep OR primarytype:single) AND status:official AND firstreleasedate:[${from.slice(0,7)}-01 TO ${end}]`;
  const search = (q: string, offset = 0) => sourceJson('https://musicbrainz.org/ws/2/release-group/?' + new URLSearchParams({ query: q, fmt: 'json', limit: '100', offset: String(offset) }), 'mb', store, fetcher);
  const data = await search(query, page);
  if (!Array.isArray(data['release-groups']) || typeof data.count !== 'number') throw new SourceError('MusicBrainz trả dữ liệu chưa hợp lệ.');
  const rows: Release[] = []; let unverified = 0;
  for (const group of data['release-groups']) {
    if (!upcomingDate(group['first-release-date'] || '', from, end)) continue;
    if (!['Album','EP','Single'].includes(group['primary-type'])) continue;
    let matched: { name: string; albums: string[] } | undefined;
    for (const credit of group['artist-credit'] || []) {
      const artist = batch.find(a=>normal(a.name) === normal(credit.artist?.name));
      if (!artist) continue;
      // Verify one familiar album against this MBID, avoiding same-name artists.
      const checkKey = 'artist:' + await keyOf(JSON.stringify([credit.artist.id, artist.albums]));
      let verified = artist.manual ? {ok:true} : await store.get(checkKey);
      if (verified === null && artist.albums.length) {
        const known = artist.albums.slice(0,3).map(s=>s.replace(/\s*[-–(].*(?:edition|remaster|reissue).*$/i,'').trim());
        const check = await search(`arid:${credit.artist.id} AND (${known.map(a=>'releasegroup:'+quote(a)).join(' OR ')})`);
        verified = { ok: (check['release-groups'] || []).some((g: any) => known.some(a=>normal(a)===normal(g.title))) };
        await store.put(checkKey, verified, 30*86400);
      }
      if (verified?.ok) { matched = artist; break; }
    }
    if (!matched) { unverified++; continue; }
    if (!/^[\da-f-]{36}$/i.test(group.id)) continue;
    rows.push({ id: group.id, title: group.title, artist: matched.name, date: group['first-release-date'], type: (group['secondary-types'] || []).includes('Live') ? 'Live' : (group['secondary-types'] || []).includes('Compilation') ? 'Compilation' : group['primary-type'], owned: matched.albums.some(a=>normal(a)===normal(group.title)), url: 'https://musicbrainz.org/release-group/'+group.id, cover: 'https://coverartarchive.org/release-group/'+group.id+'/front-250', sources:['MusicBrainz'] });
  }
  const more = page + data['release-groups'].length < data.count && data['release-groups'].length > 0;
  const checked = more ? start : Math.min(start+batch.length, artists.length);
  return { rows, checked, total: artists.length, next: more ? `${start}~${page+data['release-groups'].length}` : checked < artists.length ? `${checked}~0` : null, asOf: today, end, unverified };
}

export async function upcoming(tracks:Track[],cursor:string,store:DiscoveryStore,fetcher:typeof fetch=fetch,today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),recentDays=90) {
  // Older app builds persisted `i:start~artist` while the release feed still
  // interleaved Apple requests. Resume at the following MusicBrainz batch
  // without contacting iTunes.
  const legacy=cursor.match(/^i:(\d+)~\d+$/);
  if(legacy)cursor=`${Number(legacy[1])+8}~0`;
  if(!validReleaseCursor(cursor))throw new SourceError('Trang dữ liệu không hợp lệ.');
  const bandcamp=cursor.startsWith('b:'),[start,page]=cursor.replace(/^b:/,'').split('~').map(Number);
  const artists=libraryArtists(tracks),total=artists.length;
  const end=(Number(today.slice(0,4))+1)+today.slice(4),batchEnd=Math.min(start+8,total);
  if(start>total || page>10000 || bandcamp && (page>=8 || start+page>=total))throw new SourceError('Trang dữ liệu không hợp lệ.');
  const bandcampNext=bandcamp
    ? start+page+1<batchEnd?`b:${start}~${page+1}`:batchEnd<total?`${batchEnd}~0`:null
    : batchEnd>start?`b:${start}~0`:null;
  try {
    if(bandcamp){
      const from=new Date(Date.parse(today+'T00:00:00Z')-Math.max(1,Math.min(180,recentDays))*86400000).toISOString().slice(0,10);
      const result=await bandcampReleases(artists[start+page],from,end,store,fetcher);
      return {...result,checked:start+page+1,total,next:bandcampNext,asOf:today,end};
    }
    const result=await musicBrainzUpcoming(tracks,cursor,store,fetcher,today,recentDays);
    const sameBatch=result.next && result.next.split('~')[0]===String(start);
    return {...result,checked:start,next:sameBatch?result.next:bandcampNext};
  } catch(error) {
    // Retain the failed page for retry while continuing with later artists.
    return {rows:[],checked:bandcamp?start+page+1:start,total,next:bandcampNext,asOf:today,end,unverified:0,
      failed:{cursor,source:bandcamp?'Bandcamp':'MusicBrainz',retryAfter:error instanceof SourceError?error.retryAfter:30}};
  }
}

// Search can resolve one eligible artist immediately, independent of the scan cursor.
export async function artistUpcoming(tracks:Track[],query:string,store:DiscoveryStore,fetcher:typeof fetch=fetch,today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),recentDays=90) {
  const artists=libraryArtists(tracks),q=normal(query);
  const exact=artists.find(a=>normal(a.name)===q),matches=q.length>=3?artists.filter(a=>normal(a.name).includes(q)):[];
  const artist=exact || (matches.length===1?matches[0]:undefined);
  if(!artist)return {artist:null,rows:[],failed:[],asOf:today};
  const ownTracks=tracks.filter(t=>normal(t.album_artist || t.artist)===normal(artist.name));
  const from=new Date(Date.parse(today+'T00:00:00Z')-Math.max(1,Math.min(180,recentDays))*86400000).toISOString().slice(0,10),end=(Number(today.slice(0,4))+1)+today.slice(4);
  const results=await Promise.allSettled([musicBrainzUpcoming(ownTracks,'0~0',store,fetcher,today,recentDays),bandcampReleases(artist,from,end,store,fetcher)]);
  const rows:Release[]=[],failed:string[]=[];
  results.forEach((result,index)=>{
    if(result.status==='fulfilled')rows.push(...result.value.rows);
    else { const source=index===0?'MusicBrainz':'Bandcamp';failed.push(source);console.warn('Targeted release source failed',{source,message:result.reason instanceof Error?result.reason.message:String(result.reason)}); }
  });
  return {artist:artist.name,rows:mergeReleases(rows),failed,asOf:today};
}
