import { normal, sourceJson, SourceError, type DiscoveryStore } from './discovery';
import { bandcampAlbumTracks, bandcampReleaseId, findBandcampAlbumTracks } from './bandcamp';

export type AlbumTrack = {id:string;title:string;artist:string;disc:number;trackNumber:number;duration_s?:number;releaseDate?:string};
export type AlbumTracks = {tracks:AlbumTrack[];source:'MusicBrainz'|'Bandcamp';sourceUrl:string};
const credit=(rows:any[])=> (rows || []).map(c=>(c.name || c.artist?.name || '')+(c.joinphrase || '')).join('');
const name=(value:string)=>normal(value.replace(/\s*[-–]\s*(?:single|ep)\s*$/i,''));
const exactReleaseDate=(value:unknown):string|undefined=>{
  const date=typeof value==='string'?value.slice(0,10):'';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date ? date : undefined;
};
const duration=(ms:any)=>typeof ms==='number' && Number.isFinite(ms) && ms>0 ? Math.round(ms/1000) : undefined;
const mbid=(value:unknown)=>typeof value==='string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
const quote=(value:string)=>'"'+value.replace(/[\\"]/g,'\\$&')+'"';

export function musicBrainzAlbumTracks(artist:string,title:string,releases:any[]):AlbumTracks|null {
  const editions=releases.filter(r=>r.status==='Official' && name(r.title || '')===name(title)
    && normal(credit(r['artist-credit']))===normal(artist))
    .sort((a,b)=>Number(b.media?.some((m:any)=>m.format==='Digital Media'))-Number(a.media?.some((m:any)=>m.format==='Digital Media'))
      || String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id)));
  for(const release of editions){
    const media=release.media;
    if(!Array.isArray(media) || !media.length || !media.every(m=>Array.isArray(m.tracks) && m.tracks.length>0 && m.tracks.length===m['track-count']))continue;
    const tracks:AlbumTrack[]=media.flatMap((m:any)=>m.tracks.map((t:any)=>({
      id:String(t.id || `${release.id}:${m.position}:${t.position}`),title:t.title || t.recording?.title,
      artist:credit(t['artist-credit'] || t.recording?.['artist-credit']) || artist,
      disc:m.position,trackNumber:t.position,duration_s:duration(t.length ?? t.recording?.length),releaseDate:exactReleaseDate(t.recording?.['first-release-date']),
    })));
    if(!tracks.every(t=>typeof t.title==='string' && t.title.trim() && Number.isInteger(t.disc) && t.disc>0 && Number.isInteger(t.trackNumber) && t.trackNumber>0))continue;
    tracks.sort((a,b)=>a.disc-b.disc || a.trackNumber-b.trackNumber);
    return {tracks,source:'MusicBrainz',sourceUrl:'https://musicbrainz.org/release/'+release.id};
  }
  return null;
}

async function findMusicBrainzGroup(artist:string,title:string,store:DiscoveryStore,fetcher:typeof fetch) {
  const query=`releasegroup:${quote(title)} AND artist:${quote(artist)}`;
  const data=await sourceJson('https://musicbrainz.org/ws/2/release-group/?'+new URLSearchParams({query,fmt:'json',limit:'25'}),'mb',store,fetcher);
  const ids=[...new Set<string>((data['release-groups'] || []).filter((row:any)=>mbid(row.id) && name(row.title || '')===name(title)
    && (row['artist-credit'] || []).some((entry:any)=>normal(entry.artist?.name || entry.name)===normal(artist))).map((row:any)=>row.id))];
  return ids.length===1?ids[0]:undefined;
}

export async function albumTracks(artist:string,title:string,group:string|undefined,store:DiscoveryStore,fetcher:typeof fetch=fetch):Promise<AlbumTracks|null> {
  if(group && bandcampReleaseId(group)){
    try{return await bandcampAlbumTracks(artist,title,group,store,fetcher);}
    catch{throw new SourceError('Chưa tải được danh sách bài hát. Hãy thử lại sau.');}
  }
  let musicBrainzFailed=false;
  try{
    const releaseGroup=mbid(group)?group:await findMusicBrainzGroup(artist,title,store,fetcher);
    if(releaseGroup){
      const params=new URLSearchParams({'release-group':releaseGroup,inc:'recordings artist-credits',fmt:'json',limit:'100'});
      const data=await sourceJson('https://musicbrainz.org/ws/2/release?'+params,'mb-releases',store,fetcher);
      const result=musicBrainzAlbumTracks(artist,title,data.releases);
      if(result)return result;
    }
  }catch{musicBrainzFailed=true;}
  try{
    const result=await findBandcampAlbumTracks(artist,title,store,fetcher);
    if(result)return result;
  }catch{
    throw new SourceError('Chưa tải được danh sách bài hát. Hãy thử lại sau.');
  }
  if(musicBrainzFailed)throw new SourceError('Chưa tải được danh sách bài hát. Hãy thử lại sau.');
  return null;
}
