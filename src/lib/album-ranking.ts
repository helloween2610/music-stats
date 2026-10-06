import {allTimeAlbumRanks} from './album-groups';
import { periodAlbumRanking } from './albums';

const iso=(date:Date)=>date.toISOString().slice(0,10);
export function albumHistoryDates(scope:string,asOf:string):string[] {
  const end=/^\d{4}$/.test(scope)?`${scope}-12-31`:/^\d{4}-\d{2}$/.test(scope)?iso(new Date(Date.UTC(Number(scope.slice(0,4)),Number(scope.slice(5,7)),0))):asOf;
  asOf=asOf<end?asOf:end;
  const year=Number(asOf.slice(0,4)),month=Number(asOf.slice(5,7));
  if(/^\d{4}-\d{2}$/.test(scope)){
    const end=iso(new Date(Date.UTC(Number(scope.slice(0,4)),Number(scope.slice(5,7)),0)));
    return [7,14,21,28].map(day=>`${scope}-${String(day).padStart(2,'0')}`).filter(date=>date<asOf&&date<=end);
  }
  const start=/^\d{4}$/.test(scope)?`${scope}-01-01`:scope==='all'?'2025-01-01':'2024-04-01';
  return Array.from({length:12},(_,i)=>iso(new Date(Date.UTC(year,month-12+i,0))))
    .filter(date=>date>=start&&date<asOf);
}
export function albumPlayPaths(scope:string,asOf:string):string[] {
  if(scope==='all')return [`/ratings?asOf=${asOf}`];
  const scopes=scope==='ft0424'?Array.from({length:Math.max(0,Number(asOf.slice(0,4))-2023)},(_,i)=>String(2024+i)):[scope];
  return scopes.map(value=>`/overview?scope=${value}&asOf=${asOf}&limit=5000`);
}
export function mergeAlbumPlayResponses(responses:any[]){
  const rows=new Map<string,any>();
  for(const response of responses)for(const song of response.rows || response.songs || []){
    const row=rows.get(song.track_id)||{track_id:song.track_id,plays:0};
    row.plays+=song.plays;rows.set(song.track_id,row);
  }
  return [...rows.values()];
}
export function rankedAlbums(plays:any[],tracks:any[],sort:string,allTime=false){
  if(allTime && sort!=='Lượt')return (allTimeAlbumRanks(tracks,plays) || []).map(row=>({
    ...row,name:row.album,artist:row.album_artist,tracks:row.listenedTracks,key:row.album_artist+'\u001f'+row.album,
  }));
  const rows=periodAlbumRanking(plays,tracks);
  if(sort==='Lượt')rows.sort((a,b)=>b.plays-a.plays || b.seconds-a.seconds || a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name));
  return rows.map((row,i)=>({...row,rank:i+1,key:row.artist+'\u001f'+row.name}));
}
export function rankChange(previous:number|undefined,current:number,limit:number):number|'new'{
  return previous==null || previous>limit ? 'new' : previous-current;
}
