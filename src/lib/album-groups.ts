// User-approved album groups. Original track metadata and play records stay intact.
const groups = [{artist:'In Flames', title:'The Jester Race', editions:['The Jester Race (Black Ash-Inheritance Version)']}];
const normalized=(value:string)=>value.normalize('NFC').trim().toLowerCase();
export function canonicalAlbum(artist:string,title:string):string {
  const group=groups.find(g=>normalized(g.artist)===normalized(artist) && [g.title,...g.editions].some(t=>normalized(t)===normalized(title)));
  return group?.title || title;
}
export const groupedAlbumKey=(artist:string,title:string)=>artist+'\u001f'+canonicalAlbum(artist,title);
export const hasGroupedAlbums=(tracks:any[])=>tracks.some(t=>!!t.album && canonicalAlbum(t.album_artist || t.artist || '',t.album || '')!==t.album);
export const excludedRankedAlbum=(title:string,genre='')=>
  /^0$/.test(title.trim())
  || /Archive|Sopor Aeternus Collect|Valkyrja|Gone - A Collection|Walking Cloud|One Step More|Rays Of Darkness/i.test(title)
  || /NHAC|PIANO|CLASSICAL INSTRU\./i.test(genre);

// Same level/hour rules as the album chart, using full per-track counts so merging
// neither adds rounded hours nor takes the better rank of the two old editions.
export function groupedAllTimeAlbumRanks(tracks:any[],stats:any[]):any[]|null {
  return hasGroupedAlbums(tracks) ? allTimeAlbumRanks(tracks,stats) : null;
}

// Shared by cover badges and the All time list, including libraries without merged editions.
export function allTimeAlbumRanks(tracks:any[],stats:any[]):any[]|null {
  const plays=new Map(stats.map(r=>[r.track_id,r.plays]));
  if(tracks.some(t=>!plays.has(t.id)))return null;
  const albums=new Map<string,any>();
  for(const t of tracks){
    if(t.album_artist==null || t.album==null)continue;
    const key=groupedAlbumKey(t.album_artist,t.album);
    const row=albums.get(key) || {album_artist:t.album_artist,album:canonicalAlbum(t.album_artist,t.album),tracks:0,listenedTracks:0,plays:0,duration:0,seconds:0,excluded:false};
    const duration=t.duration_s || 0;
    const count=plays.get(t.id) || 0;
    row.tracks++;row.duration+=duration;row.seconds+=duration*count;row.plays+=count;
    if(count>0)row.listenedTracks++;
    row.excluded ||= excludedRankedAlbum(t.album, t.genre || '');
    albums.set(key,row);
  }
  const ranked=[...albums.values()].map(r=>({...r,hours:r.seconds/3600,level:r.seconds>=86400?3:r.duration>=2700&&r.seconds>=18000?2:(r.duration>900&&r.duration<2700&&r.seconds>=7200)||(r.duration>=2700&&r.seconds<18000)?1:0}))
    .filter(r=>r.seconds>0&&!r.excluded&&r.level).sort((a,b)=>b.level-a.level || b.seconds-a.seconds);
  let rank=0;
  return ranked.map((r,i)=>{if(!i || r.level!==ranked[i-1].level || r.seconds!==ranked[i-1].seconds)rank=i+1;return {...r,rank};});
}
