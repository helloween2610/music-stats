import { normal, lyricTitle, sourceJson, type DiscoveryStore } from './discovery';
import { catalogKeys, catalogId, catalogEntityKey, catalogAlbumBase } from '../../shared/apple-catalog';
import { bandcampReleaseId } from './bandcamp';

export type AppleDetailQuery = { kind: 'song' | 'artist'; artist: string; title?: string; album?: string; libraryTitle?:boolean };
export function appleDetailUrl(value: unknown, kind: AppleDetailQuery['kind']): string | null {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.username || url.password || url.port) return null;
    if (kind === 'artist') {
      if (!/^\/[a-z]{2}\/artist\/(?:[^/]+\/)?\d+\/?$/.test(url.pathname)) return null;
      url.search = '';
    } else {
      if (!/^\/[a-z]{2}\/(?:album|song)\/(?:[^/]+\/)?\d+\/?$/.test(url.pathname)) return null;
      const songId = url.searchParams.get('i');
      if (url.pathname.includes('/album/') && !/^\d+$/.test(songId || '')) return null;
      url.search = ''; if (songId && /^\d+$/.test(songId)) url.searchParams.set('i', songId);
    }
    url.hash = ''; return url.href;
  } catch { return null; }
}
function appleAlbumBase(value: unknown) { return normal(catalogAlbumBase(String(value || ''))); }
function appleAlbumMatches(a: unknown, b: unknown) {
  const exactA=normal(a), exactB=normal(b);
  return exactA===exactB || !!appleAlbumBase(a) && appleAlbumBase(a)===appleAlbumBase(b);
}
function matchesAppleDetail(q:AppleDetailQuery,r:any):boolean {
  if(normal(r?.artistName)!==normal(q.artist))return false;
  if(q.kind==='artist')return r.wrapperType==='artist';
  if(r.kind!=='song' || q.album && !appleAlbumMatches(r.collectionName,q.album))return false;
  if(normal(r.trackName)===normal(q.title))return true;
  // Library tags sometimes omit Apple's remaster suffix. The exact album/edition
  // must still match, and an explicitly requested song version remains strict.
  if(!q.libraryTitle || !q.album || /remaster|live|version|edit/i.test(q.title || ''))return false;
  const withoutRemaster=String(r.trackName || '').replace(/\s*(?:\((?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\)|[-–]\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?)$/i,'');
  return normal(withoutRemaster)===normal(q.title);
}
export function chooseAppleDetail(q: AppleDetailQuery, rows: any[]): string | null {
  const candidates = rows.filter(r=>matchesAppleDetail(q,r));
  const urls = [...new Set(candidates.map(r=>appleDetailUrl(q.kind === 'artist' ? r.artistLinkUrl : r.trackViewUrl, q.kind)).filter(Boolean))];
  // Namesakes and multiple editions must not silently select the first result.
  return urls.length === 1 ? urls[0]! : null;
}

export type ApplePlaylistSong = {
  status:'found';
  url:string;
  storeId:string;
  title:string;
  artist:string;
  album:string;
  match:'exact'|'version';
};

export function chooseApplePlaylistSong(q:{artist:string;title:string},rows:any[]):ApplePlaylistSong|null {
  const artist=normal(q.artist),title=normal(q.title);
  const readable=(value:unknown)=>String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
  const readableTitle=readable(q.title);
  const songs=rows.filter(row=>row?.kind==='song' && normal(row.artistName)===artist && appleDetailUrl(row.trackViewUrl,'song'));
  const choose=(matches:any[],match:'exact'|'version')=>{
    const unique=new Map<string,ApplePlaylistSong>();
    const canonical=new Map<string,ApplePlaylistSong>();
    for(const row of matches){
      const url=appleDetailUrl(row.trackViewUrl,'song')!;
      const storeId=new URL(url).searchParams.get('i') || '';
      if(/^\d+$/.test(storeId)){
        const song={status:'found',url,storeId,title:String(row.trackName || ''),artist:String(row.artistName || ''),album:String(row.collectionName || ''),match} as ApplePlaylistSong;
        unique.set(storeId,song);
        if(match==='exact'&&normal(row.collectionName)===normal(row.trackName))canonical.set(storeId,song);
      }
    }
    return unique.size===1 ? [...unique.values()][0] : canonical.size===1 ? [...canonical.values()][0] : null;
  };
  const exact=choose(songs.filter(row=>normal(row.trackName)===title),'exact');
  if(exact)return exact;
  return choose(songs.filter(row=>{
    const candidate=readable(row.trackName);
    return candidate.startsWith(readableTitle) && /^[\s([\-–—:]/.test(candidate.slice(readableTitle.length));
  }),'version');
}

export function chooseApplePlaylistSongLine(raw:string,rows:any[]):ApplePlaylistSong|null {
  const source=normal(raw);
  if(!source)return null;
  const readable=(value:unknown)=>String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
  const choose=(matches:any[],match:'exact'|'version')=>{
    const unique=new Map<string,ApplePlaylistSong>();
    const canonical=new Map<string,ApplePlaylistSong>();
    for(const row of matches){
      const url=appleDetailUrl(row?.trackViewUrl,'song');
      if(row?.kind!=='song' || !url)continue;
      const storeId=new URL(url).searchParams.get('i') || '';
      if(/^\d+$/.test(storeId)){
        const song={status:'found',url,storeId,title:String(row.trackName || ''),artist:String(row.artistName || ''),album:String(row.collectionName || ''),match} as ApplePlaylistSong;
        unique.set(storeId,song);
        if(match==='exact'&&normal(row.collectionName)===normal(row.trackName))canonical.set(storeId,song);
      }
    }
    return unique.size===1 ? [...unique.values()][0] : canonical.size===1 ? [...canonical.values()][0] : null;
  };
  const songs=rows.filter(row=>row?.kind==='song' && appleDetailUrl(row.trackViewUrl,'song'));
  const exact=choose(songs.filter(row=>normal(`${row.trackName || ''} ${row.artistName || ''}`)===source),'exact');
  if(exact)return exact;
  return choose(songs.filter(row=>{
    const artist=normal(row.artistName),candidate=normal(row.trackName);
    if(!artist || !source.endsWith(artist))return false;
    const title=source.slice(0,-artist.length);
    if(!title || candidate===title || !candidate.startsWith(title))return false;
    const readableTitle=readable(row.trackName);
    const rawTitle=readable(raw).replace(new RegExp(`${readable(row.artistName).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*$`),'').trim();
    return readableTitle.startsWith(rawTitle) && /^[\s([\-–—:]/.test(readableTitle.slice(rawTitle.length));
  }),'version');
}

export async function resolveApplePlaylistSong(artist:string,title:string,store:DiscoveryStore,fetcher:typeof fetch=fetch):Promise<ApplePlaylistSong|null>{
  const cacheKey='apple-playlist-song:v1:'+JSON.stringify([artist,title]);
  const saved=await store.get(cacheKey);
  if(saved?.status==='found' && /^\d+$/.test(saved.storeId || '') && appleDetailUrl(saved.url,'song'))return saved;
  let unavailable=false;
  const term=[artist,title].filter(Boolean).join(' ');
  for(const country of ['vn','us'])try{
    const params=new URLSearchParams({term,country,media:'music',entity:'song',limit:'25'});
    const data=await sourceJson('https://itunes.apple.com/search?'+params,'itunes',store,fetcher);
    const found=chooseApplePlaylistSong({artist,title},data.results);
    if(found){await store.put(cacheKey,found,365*86400);return found;}
  }catch{unavailable=true;}
  if(unavailable)throw new Error('Apple Music unavailable');
  return null;
}

export async function resolveApplePlaylistSongLine(raw:string,store:DiscoveryStore,fetcher:typeof fetch=fetch):Promise<ApplePlaylistSong|null>{
  const cacheKey='apple-playlist-line:v1:'+raw;
  const saved=await store.get(cacheKey);
  if(saved?.status==='found' && /^\d+$/.test(saved.storeId || '') && appleDetailUrl(saved.url,'song'))return saved;
  let unavailable=false;
  for(const country of ['vn','us'])try{
    const params=new URLSearchParams({term:raw,country,media:'music',entity:'song',limit:'25'});
    const data=await sourceJson('https://itunes.apple.com/search?'+params,'itunes',store,fetcher);
    const found=chooseApplePlaylistSongLine(raw,data.results);
    if(found){await store.put(cacheKey,found,365*86400);return found;}
  }catch{unavailable=true;}
  if(unavailable)throw new Error('Apple Music unavailable');
  return null;
}
async function verifiedCatalogSong(id:string,q:AppleDetailQuery,store:DiscoveryStore,fetcher:typeof fetch){
  const found={status:'found',url:`https://music.apple.com/vn/song/${id}`,source:'library_export'};
  for(const country of ['vn','us'])try{
    const data=await sourceJson('https://itunes.apple.com/lookup?'+new URLSearchParams({id,country}),'itunes',store,fetcher);
    const url=chooseAppleDetail(q,data.results);
    if(url){
      const years = [...new Set(data.results.filter((r:any)=>
        matchesAppleDetail(q,r) && appleDetailUrl(r.trackViewUrl,'song') === url)
        .map((r:any)=>typeof r.releaseDate === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r.releaseDate) && Number.isFinite(Date.parse(r.releaseDate)) ? Number(r.releaseDate.slice(0,4)) : undefined)
        .filter((year:any)=>year>=1000 && year<=9999))];
      return {...found,url,...(years.length===1 ? {releaseYear:years[0]} : {})};
    }
  }catch{}
  return found;
}
export async function resolveAppleDetail(q: AppleDetailQuery, store: DiscoveryStore, fetcher: typeof fetch = fetch) {
  const cacheKey='apple-detail:verified:v2:'+JSON.stringify([q.kind,q.artist,q.title || '',q.album || '',q.libraryTitle ? 'library' : 'exact']);
  const saved=await store.get(cacheKey);
  if(saved?.status==='found' && appleDetailUrl(saved.url,q.kind))return saved;
  if(q.kind==='artist' && store.catalogLookup){
    const id=catalogId(await store.catalogLookup([catalogEntityKey('artist',q.artist)]));
    if(id){
      const found={status:'found',url:`https://music.apple.com/vn/artist/${id}`,source:'library_export'};
      await store.put(cacheKey,found,365*86400);return found;
    }
  }
  if(q.kind==='song' && q.title && q.album && store.catalogLookup){
    const keys=[...catalogKeys(q.artist,q.title,q.album)];
    if(q.libraryTitle)keys.push(...catalogKeys(q.artist,q.title,q.album,true));
    const id=catalogId(await store.catalogLookup([...new Set(keys)]));
    if(id){
      const found=await verifiedCatalogSong(id,q,store,fetcher);
      await store.put(cacheKey,found,365*86400);return found;
    }
  }
  // Personal library suffixes are not catalog edition names. Keep real qualifiers.
  if(q.kind==='song' && q.libraryTitle)q={...q,title:lyricTitle(q.title || ''),album:q.album ? lyricTitle(q.album) : undefined};
  let unavailable = false;
  const termParts=[q.artist,q.title,q.kind==='song'?q.album:undefined].filter((value):value is string=>!!value);
  const term = termParts.filter((value,index)=>termParts.findIndex(other=>normal(other)===normal(value))===index).join(' ');
  for(const country of ['vn','us']) {
  try {
    const params = new URLSearchParams({term, country, media:'music', entity:q.kind === 'artist' ? 'musicArtist' : 'song', limit:'25'});
    const result = await sourceJson('https://itunes.apple.com/search?' + params, 'itunes', store, fetcher);
    const url = chooseAppleDetail(q, result.results);
    if (url) {
      // Only a matched song on the requested album can supply its release year.
      const years = q.kind === 'song' && q.album ? [...new Set(result.results.filter((r:any)=>
        matchesAppleDetail(q,r) && appleDetailUrl(r.trackViewUrl,'song') === url)
        .map((r:any)=>typeof r.releaseDate === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r.releaseDate) && Number.isFinite(Date.parse(r.releaseDate)) ? Number(r.releaseDate.slice(0,4)) : undefined)
        .filter((year:any)=>year>=1000 && year<=9999))] : [];
      const found={status:'found', url, ...(years.length===1 ? {releaseYear:years[0]} : {})};
      // Apple catalog IDs are stable. Keep verified links for a year so repeat
      // opens do not depend on the search service being available again.
      await store.put(cacheKey,found,365*86400);
      return found;
    }
  } catch { unavailable = true; }
  }
  return {status:'search', reason:unavailable ? 'unavailable' : 'not_found', url:'https://music.apple.com/vn/search?' + new URLSearchParams({term})};
}

export const appleReleaseId=(value?:string)=>value?.match(/^itunes:([a-z]{2}):(\d+)$/);
export const validAlbumId=(value:string)=>!!appleReleaseId(value) || !!bandcampReleaseId(value) || /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);

// Preserve live/remaster/deluxe qualifiers; only Apple's format suffix is optional.
const albumName = (title: string) => normal(title.replace(/\s*[-–]\s*(?:single|ep)\s*$/i, ''));
const appleAlbumNameMatches = (candidate: string, requested: string) => albumName(candidate) === albumName(requested) || appleAlbumBase(candidate) === appleAlbumBase(requested);
export function appleMusicUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.username || url.password || url.port) return null;
    if (!/^\/[a-z]{2}\/album\/(?:[^/]+\/)?\d+\/?$/.test(url.pathname)) return null;
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return null; }
}
export function chooseAppleAlbum(artist: string, title: string, rows: any[]) {
  const matches = rows.filter(r => r?.collectionType === 'Album' && typeof r.collectionName === 'string'
    && normal(r.artistName) === normal(artist) && appleAlbumNameMatches(r.collectionName, title)
    && appleMusicUrl(r.collectionViewUrl));
  matches.sort((a,b) => Number(normal(b.collectionName) === normal(title)) - Number(normal(a.collectionName) === normal(title)));
  return matches[0];
}
export async function resolveAppleAlbum(artist: string, title: string, store: DiscoveryStore, fetcher: typeof fetch = fetch, releaseGroup?: string) {
  let unavailable = false;
  const cacheKey='apple-album:verified:v1:'+JSON.stringify([artist,title]);
  const saved=await store.get(cacheKey);
  if(saved?.status==='found' && appleMusicUrl(saved.url))return saved;
  // The album export has no artist field. Verify its candidate ID before using it.
  const albumEntityKeys=[catalogEntityKey('album',title)];
  const baseTitle=catalogAlbumBase(title);
  if(baseTitle && normal(baseTitle)!==normal(title))albumEntityKeys.push(catalogEntityKey('album',baseTitle));
  const imported=store.catalogLookup && catalogId(await store.catalogLookup([...new Set(albumEntityKeys)]));
  if(imported){
    for(const country of ['vn','us'])try{
      const data=await sourceJson('https://itunes.apple.com/lookup?'+new URLSearchParams({id:imported,country}),'itunes',store,fetcher);
      const match=chooseAppleAlbum(artist,title,data.results);
      if(match){
        const found={status:'found',url:appleMusicUrl(match.collectionViewUrl)!,source:'library_export'};
        await store.put(cacheKey,found,365*86400);return found;
      }
    }catch{unavailable=true;}
  }
  // Prefer an existing album relationship: it also covers preorders absent from search.
  const appleId=appleReleaseId(releaseGroup);
  if(appleId){
    try {
      const data=await sourceJson('https://itunes.apple.com/lookup?'+new URLSearchParams({id:appleId[2],country:appleId[1]}),'itunes',store,fetcher);
      const match=chooseAppleAlbum(artist,title,data.results);
      if(match)return {status:'found',url:appleMusicUrl(match.collectionViewUrl)!};
    } catch {unavailable=true;}
  }
  if (releaseGroup && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(releaseGroup)) {
    try {
      const params = new URLSearchParams({'release-group':releaseGroup, inc:'url-rels artist-credits', fmt:'json', limit:'100'});
      const data = await sourceJson('https://musicbrainz.org/ws/2/release?' + params, 'mb-releases', store, fetcher);
      const links: string[] = [];
      for (const release of data.releases) {
        if (typeof release.title !== 'string' || albumName(release.title) !== albumName(title)
          || !(release['artist-credit'] || []).some((c:any)=>normal(c.artist?.name) === normal(artist))) continue;
        for (const rel of release.relations || []) {
          const url = appleMusicUrl(rel.url?.resource); if (url) links.push(url);
        }
      }
      const url = links.find(link=>new URL(link).pathname.startsWith('/vn/')) || links[0];
      if (url) return {status:'found',url};
    } catch { unavailable = true; }
  }
  const params = new URLSearchParams({ term: `${artist} ${title}`, country: 'vn', media: 'music', entity: 'album', limit: '25' });
  try {
    const result = await sourceJson('https://itunes.apple.com/search?' + params, 'itunes', store, fetcher);
    const match = chooseAppleAlbum(artist, title, result.results);
    if (match) return { status: 'found', url: appleMusicUrl(match.collectionViewUrl)! };
  } catch { unavailable = true; }
  return { status: 'search', reason: unavailable ? 'unavailable' : 'not_found', url: 'https://music.apple.com/vn/search?' + new URLSearchParams({term: `${artist} ${title}`}) };
}
