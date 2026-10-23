import { keyOf, normal, sourceJson, upcomingDate, type DiscoveryStore } from './discovery';
import type { Release } from '../../shared/releases';

type Artist={name:string;albums:string[]};
type Band={origin:string;bandId:number};
export const bandcampReleaseId=(value?:string)=>value?.match(/^bandcamp:(album|track):(\d+)$/);
const quote=(value:string)=>'"'+value.replace(/[\\"]/g,'\\$&')+'"';
const exactDate=(value:unknown):string|undefined=>{
  if(typeof value!=='string')return;
  const date=new Date(value),iso=Number.isFinite(date.getTime())?date.toISOString().slice(0,10):'';
  return /^\d{4}-\d{2}-\d{2}$/.test(iso)?iso:undefined;
};
const safeBandcampOrigin=(value:unknown):string|null=>{
  try{
    const url=new URL(String(value));
    if(url.protocol!=='https:' || url.username || url.password || url.port || !url.hostname.endsWith('.bandcamp.com'))return null;
    return url.origin;
  }catch{return null;}
};
const safeItemUrl=(value:unknown,origin:string,type:'album'|'track'):string|null=>{
  try{
    const url=new URL(String(value));
    if(url.origin!==origin || !new RegExp('^/'+type+'/[^/?#]+/?$').test(url.pathname))return null;
    url.search='';url.hash='';return url.href;
  }catch{return null;}
};
const isoDuration=(value:unknown):number|undefined=>{
  const match=typeof value==='string' && value.match(/^P(?:([0-9]+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if(!match)return;
  const seconds=Number(match[1]||0)*86400+Number(match[2]||0)*3600+Number(match[3]||0)*60+Number(match[4]||0);
  return seconds>0?Math.round(seconds):undefined;
};
const property=(rows:any[],name:string)=>Array.isArray(rows)?rows.find(row=>row?.name===name)?.value:undefined;

async function bandcampPageAlbumTracks(artist:string,title:string,id:string,url:string,bandId:number,store:DiscoveryStore,fetcher:typeof fetch){
  const parsed=bandcampReleaseId(id);if(!parsed || parsed[1]!=='album')return null;
  const cacheKey='bandcamp-page-tracks:v1:'+id,cached=await store.get(cacheKey);
  if(cached?.source==='Bandcamp' && Array.isArray(cached.tracks))return cached;
  const target=new URL(url),params=new URLSearchParams({_x_tr_sl:'auto',_x_tr_tl:'en',_x_tr_hl:'en'});
  const proxy=`https://${target.hostname.replace(/\./g,'-')}.translate.goog${target.pathname}?${params}`;
  const response=await fetcher(proxy,{headers:{'User-Agent':'MusicStats/2.0 (https://stats.helloween2610.workers.dev)','Accept':'text/html'},signal:AbortSignal.timeout(20_000)});
  if(!response.ok)return null;
  const html=await response.text(),match=html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>\s*([\s\S]*?)\s*<\/script>/i);
  if(!match)return null;
  let schema:any;try{schema=JSON.parse(match[1]);}catch{return null;}
  const origin=safeBandcampOrigin(url),sourceUrl=origin&&safeItemUrl(schema?.['@id'],origin,'album');
  const release=(schema?.albumRelease || []).find((row:any)=>Number(property(row?.additionalProperty,'item_id'))===Number(parsed[2]));
  if(schema?.['@type']!=='MusicAlbum' || !sourceUrl || sourceUrl!==url || normal(schema.name)!==normal(title)
    || normal(schema.byArtist?.name)!==normal(artist) || Number(property(release?.additionalProperty,'selling_band_id'))!==bandId)return null;
  const elements=schema.track?.itemListElement;
  if(!Array.isArray(elements) || !elements.length || Number(schema.track?.numberOfItems)!==elements.length)return null;
  const tracks=elements.map((row:any,index:number)=>{
    const item=row?.item,trackId=Number(property(item?.additionalProperty,'track_id')),trackNumber=Number(row?.position);
    return {id:String(trackId),title:item?.name,artist,disc:1,trackNumber,duration_s:isoDuration(item?.duration),index};
  });
  if(!tracks.every((track:any)=>/^\d+$/.test(track.id) && Number(track.id)>0 && typeof track.title==='string' && track.title.trim()
    && Number.isInteger(track.trackNumber) && track.trackNumber>0))return null;
  tracks.sort((a:any,b:any)=>a.trackNumber-b.trackNumber || a.index-b.index);
  const result={tracks:tracks.map(({index,...track}:any)=>track),source:'Bandcamp' as const,sourceUrl};
  await store.put(cacheKey,result,6*3600);return result;
}
async function searchBandcamp(text:string,filter:'a'|'b'|'t',store:DiscoveryStore,fetcher:typeof fetch){
  const body=JSON.stringify({search_text:text,search_filter:filter,full_page:false,fan_id:null});
  const data=await sourceJson('https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic','bandcamp-search',store,fetcher,{method:'POST',body});
  return data.auto.results as any[];
}

async function verifiedBandcampBands(artist:Artist,store:DiscoveryStore,fetcher:typeof fetch):Promise<Band[]> {
  const cacheKey='bandcamp-artist:v2:'+await keyOf(JSON.stringify([artist.name,artist.albums.slice().sort()]));
  const cached=await store.get(cacheKey);
  if(Array.isArray(cached?.bands))return cached.bands;
  const search=await sourceJson('https://musicbrainz.org/ws/2/artist/?'+new URLSearchParams({query:'artist:'+quote(artist.name),fmt:'json',limit:'25'}),'mb-artists',store,fetcher);
  const candidates=(search.artists || []).filter((row:any)=>typeof row.id==='string' && normal(row.name)===normal(artist.name)).slice(0,5);
  const known=artist.albums.slice(0,5).map(title=>title.replace(/\s*[-–(].*(?:edition|remaster|reissue).*$/i,'').trim()).filter(Boolean);
  const verified:string[]=[];
  for(const candidate of candidates){
    if(!known.length)continue;
    const check=await sourceJson('https://musicbrainz.org/ws/2/release-group/?'+new URLSearchParams({query:`arid:${candidate.id} AND (${known.map(title=>'releasegroup:'+quote(title)).join(' OR ')})`,fmt:'json',limit:'25'}),'mb',store,fetcher);
    if((check['release-groups'] || []).some((row:any)=>known.some(title=>normal(title)===normal(row.title))))verified.push(candidate.id);
  }
  if(verified.length!==1){await store.put(cacheKey,{bands:[]},7*86400);return [];}
  const entity=await sourceJson(`https://musicbrainz.org/ws/2/artist/${verified[0]}?inc=url-rels&fmt=json`,'mb-entity',store,fetcher);
  const origins=[...new Set<string>((entity.relations || []).filter((relation:any)=>relation.type==='bandcamp')
    .map((relation:any)=>safeBandcampOrigin(relation.url?.resource)).filter(Boolean))].slice(0,3);
  const results=await searchBandcamp(artist.name,'b',store,fetcher),bands:Band[]=[];
  for(const row of results){
    const origin=safeBandcampOrigin(row?.item_url_root),bandId=Number(row?.id);
    if(row?.type==='b' && normal(row.name)===normal(artist.name) && origin && origins.includes(origin) && Number.isSafeInteger(bandId) && bandId>0
      && !bands.some(band=>band.bandId===bandId))bands.push({origin,bandId});
  }
  await store.put(cacheKey,{bands},bands.length?30*86400:7*86400);
  return bands;
}

export async function bandcampReleases(artist:Artist,from:string,end:string,store:DiscoveryStore,fetcher:typeof fetch=fetch) {
  const bands=await verifiedBandcampBands(artist,store,fetcher),rows:Release[]=[];
  for(const band of bands){
    const data=await sourceJson('https://api.bandcamp.com/api/mobile/24/band_details?'+new URLSearchParams({band_id:String(band.bandId),platform:'android'}),'bandcamp',store,fetcher);
    for(const item of data.discography || []){
      const type=item?.item_type as 'album'|'track',itemId=Number(item?.item_id),date=exactDate(item?.release_date);
      if(!['album','track'].includes(type) || !Number.isSafeInteger(itemId) || itemId<=0 || Number(item?.band_id)!==band.bandId || !date || !upcomingDate(date,from,end))continue;
      const credited=String(item.artist_name || item.band_name || data.name || '');
      if(normal(credited)!==normal(artist.name))continue;
      const title=String(item.title || '').trim();if(!title || title.length>500)continue;
      const code=type==='album'?'a':'t',matches=await searchBandcamp(artist.name+' '+title,code,store,fetcher);
      const candidates=[...new Set(matches.filter((row:any)=>row?.type===code && Number(row.id)===itemId && Number(row.band_id)===band.bandId
        && normal(row.name)===normal(title) && normal(row.band_name)===normal(artist.name) && safeBandcampOrigin(row.item_url_root)===band.origin)
        .map((row:any)=>safeItemUrl(row.item_url_path,band.origin,type)).filter(Boolean))];
      if(candidates.length!==1)continue;
      const url=candidates[0]!,artId=Number(item.art_id),cover=Number.isSafeInteger(artId)&&artId>0?`https://f4.bcbits.com/img/a${artId}_10.jpg`:'';
      const id=`bandcamp:${type}:${itemId}`;
      await store.put('bandcamp-item:v2:'+id,{url,bandId:band.bandId},90*86400);
      rows.push({id,title,artist:artist.name,date,type:type==='track'?'Single':/\bEP\b/i.test(title)?'EP':'Album',
        owned:artist.albums.some(album=>normal(album)===normal(title)),url,cover,sources:['Bandcamp']});
    }
  }
  return {rows,unverified:bands.length?0:1};
}

export async function bandcampAlbumTracks(artist:string,title:string,id:string,store:DiscoveryStore,fetcher:typeof fetch=fetch) {
  const parsed=bandcampReleaseId(id);if(!parsed)return null;
  const saved=await store.get('bandcamp-item:v2:'+id),url=saved?.url,bandId=Number(saved?.bandId);
  if(typeof url!=='string' || !Number.isSafeInteger(bandId) || bandId<=0)return null;
  const origin=safeBandcampOrigin(url);if(!origin || !safeItemUrl(url,origin,parsed[1] as 'album'|'track'))return null;
  if(parsed[1]==='album'){
    try{const page=await bandcampPageAlbumTracks(artist,title,id,url,bandId,store,fetcher);if(page)return page;}catch{}
  }
  const code=parsed[1]==='album'?'a':'t';
  const data=await sourceJson('https://api.bandcamp.com/api/mobile/24/tralbum_details?'+new URLSearchParams({band_id:String(bandId),tralbum_id:parsed[2],tralbum_type:code,platform:'android'}),'bandcamp-details',store,fetcher);
  if(Number(data.id)!==Number(parsed[2]) || data.type!==code || normal(data.title)!==normal(title)
    || normal(data.tralbum_artist || data.band?.name)!==normal(artist) || Number(data.band?.band_id)!==bandId)return null;
  const sourceUrl=safeItemUrl(data.bandcamp_url,origin,parsed[1] as 'album'|'track');if(!sourceUrl)return null;
  const tracks=(data.tracks || []).map((row:any,index:number)=>({id:String(row.track_id),title:row.title,artist:String(row.band_name || artist),disc:1,
    trackNumber:Number(row.track_num)||index+1,duration_s:typeof row.duration==='number'&&Number.isFinite(row.duration)&&row.duration>0?Math.round(row.duration):undefined}));
  if(!tracks.length || !tracks.every((track:any)=>/^\d+$/.test(track.id)&&typeof track.title==='string'&&track.title.trim()
    && normal(track.artist)===normal(artist)&&Number.isInteger(track.trackNumber)&&track.trackNumber>0))return null;
  tracks.sort((a:any,b:any)=>a.trackNumber-b.trackNumber);
  return {tracks,source:'Bandcamp' as const,sourceUrl};
}

// Album pages opened from arbitrary songs do not have a saved Bandcamp id.
// Resolve one exact album result on demand, then reuse the same validated
// track-list loader used by scheduled release discovery.
export async function findBandcampAlbumTracks(artist:string,title:string,store:DiscoveryStore,fetcher:typeof fetch=fetch) {
  const matches=await searchBandcamp(artist+' '+title,'a',store,fetcher);
  const candidates=matches.filter((row:any)=>row?.type==='a' && normal(row.name)===normal(title) && normal(row.band_name)===normal(artist))
    .map((row:any)=>{
      const itemId=Number(row.id),bandId=Number(row.band_id),origin=safeBandcampOrigin(row.item_url_root);
      const url=origin ? safeItemUrl(row.item_url_path,origin,'album') : null;
      return Number.isSafeInteger(itemId) && itemId>0 && Number.isSafeInteger(bandId) && bandId>0 && url
        ? {id:`bandcamp:album:${itemId}`,bandId,url} : null;
    }).filter(Boolean) as {id:string;bandId:number;url:string}[];
  const unique=[...new Map(candidates.map(row=>[row.id,row])).values()];
  if(unique.length!==1)return null;
  const match=unique[0];
  await store.put('bandcamp-item:v2:'+match.id,{url:match.url,bandId:match.bandId},90*86400);
  return bandcampAlbumTracks(artist,title,match.id,store,fetcher);
}
