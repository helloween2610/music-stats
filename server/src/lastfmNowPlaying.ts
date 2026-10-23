import { keyOf, SourceError, type DiscoveryStore } from './discovery';

export type NowPlayingTrack={title:string;artist:string;album?:string;image?:string;url?:string};

const safeLastfmUrl=(value:unknown,images=false):string|undefined=>{
  try{
    const url=new URL(String(value));
    const hosts=images?['lastfm.freetls.fastly.net','lastfm-img.freetls.fastly.net','userserve-ak.last.fm']:['last.fm','www.last.fm'];
    if(url.protocol!=='https:' || !hosts.includes(url.hostname) || url.username || url.password || url.port)return;
    return url.href;
  }catch{return;}
};

export async function lastfmNowPlaying(user:string,apiKey:string,store:DiscoveryStore,fetcher:typeof fetch=fetch):Promise<{track:NowPlayingTrack|null;checkedAt:string}> {
  if(!user || !apiKey)throw new SourceError('Chưa cấu hình kết nối Last.fm.');
  const cacheKey='lastfm:now-playing:v1:'+await keyOf(user),cached=await store.get(cacheKey);
  if(cached && 'track' in cached)return cached;
  if(await store.get('cooldown:lastfm'))throw new SourceError('Last.fm đang giới hạn truy cập. Hãy thử lại sau.',60);
  if(!await store.acquire('lastfm',500))throw new SourceError('Last.fm đang bận. Hãy thử lại sau.',15);
  const params=new URLSearchParams({method:'user.getrecenttracks',user,api_key:apiKey,format:'json',limit:'1'});
  const response=await fetcher('https://ws.audioscrobbler.com/2.0/?'+params,{signal:AbortSignal.timeout(10_000)});
  if(response.status===429){await store.put('cooldown:lastfm',true,60);throw new SourceError('Last.fm đang giới hạn truy cập. Hãy thử lại sau.',60);}
  if(!response.ok)throw new SourceError('Chưa kết nối được Last.fm.',15);
  const body:any=await response.json();
  if(Number(body?.error)===29){await store.put('cooldown:lastfm',true,60);throw new SourceError('Last.fm đang giới hạn truy cập. Hãy thử lại sau.',60);}
  if(body?.error)throw new SourceError('Chưa tải được bài đang nghe từ Last.fm.',15);
  const list=body?.recenttracks?.track,first=Array.isArray(list)?list[0]:list;
  let track:NowPlayingTrack|null=null;
  if(String(first?.['@attr']?.nowplaying).toLowerCase()==='true'){
    const title=typeof first?.name==='string'?first.name.trim():'',artist=typeof first?.artist?.['#text']==='string'?first.artist['#text'].trim():'';
    if(!title || !artist)throw new SourceError('Last.fm trả dữ liệu bài đang nghe chưa hợp lệ.',15);
    const album=typeof first?.album?.['#text']==='string'?first.album['#text'].trim():'';
    const images=Array.isArray(first.image)?first.image:[];
    const image=images.map((row:any)=>safeLastfmUrl(row?.['#text'],true)).filter(Boolean).at(-1);
    track={title,artist,...(album?{album}:{}),...(image?{image}:{}),...(safeLastfmUrl(first.url)?{url:safeLastfmUrl(first.url)}:{})};
  }
  const result={track,checkedAt:new Date().toISOString()};
  await store.put(cacheKey,result,10);
  return result;
}
