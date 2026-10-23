import { canonicalAlbum, excludedRankedAlbum, groupedAlbumKey } from './album-groups';
import { releaseDate, type Release } from './discovery';
import { metadataIndex, collectionMetadata, trackMetadata, ratingTone, artistTone, releaseTone } from './metadata';
import { ini, vn, fmtH, dmy } from './fmt';

const US='\u001f';
type Any=any;
const syntheticReleaseId=(id:string)=>id.startsWith('playlist-recommend:') || id.startsWith('saved:');
export const albumId=(artist:string,title:string)=>JSON.stringify([artist,canonicalAlbum(artist,title)]);
export function parseAlbumId(id:string|null):{artist:string;title:string}|null {
  try {
    const value=JSON.parse(id || '');
    return Array.isArray(value) && value.length===2 && value.every(x=>typeof x==='string') && value[1].trim()
      ? {artist:value[0],title:canonicalAlbum(value[0],value[1])} : null;
  } catch { return null; }
}
export const albumKey=(track:Any)=>groupedAlbumKey(track.album_artist || track.artist || '',track.album || '');
const positive=(n:Any)=>Number.isFinite(n) && n>0 ? n : 0;
const order=(n:Any)=>positive(n) || Number.MAX_SAFE_INTEGER;

export const unreleasedTrack=(date:string|undefined,today:string)=>!!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date && date>today;

// Build the complete album ranking from the period's songs; the overview preview only contains ten albums.
export function periodAlbumRanking(songs:Any[],tracks:Any[]) {
  const byId=new Map(tracks.map(t=>[t.id,t]));
  const albums=new Map<string,Any>();
  for(const song of songs){
    const track=byId.get(song.track_id);
    if(!track?.album || !(song.plays>0))continue;
    const artist=track.album_artist || track.artist || '',key=groupedAlbumKey(artist,track.album);
    const album=albums.get(key) || {name:canonicalAlbum(artist,track.album),artist,plays:0,seconds:0,tracks:0,excluded:false};
    album.plays+=song.plays;
    album.seconds+=song.plays*positive(track.duration_s);
    album.tracks++;
    album.excluded ||= excludedRankedAlbum(track.album, track.genre || '');
    albums.set(key,album);
  }
  return [...albums.values()].filter(a=>!a.excluded).sort((a,b)=>b.seconds-a.seconds || a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name))
    .map((a,index)=>({...a,hours:a.seconds/3600,rank:index+1}));
}

export function albumView(id:string|null,rows:Any[],stats:Any,supplemental:Any,ranks:Any[],artwork:Any,today:string,go:(screen:any,id:string)=>void) {
  const identity=parseAlbumId(id);
  if(!identity)return null;
  const key=identity.artist+US+identity.title;
  const index=metadataIndex(rows,stats,supplemental);
  const tracks=Object.values(index.tracks).filter((t:Any)=>albumKey(t)===key) as Any[];
  if(!tracks.length)return null;
  tracks.sort((a,b)=>(positive(a.disc)||1)-(positive(b.disc)||1) || order(a.trackNumber)-order(b.trackNumber) || a.id.localeCompare(b.id));
  const group=index.albums[key];
  const known=tracks.every(t=>t.allPlays != null);
  const plays=known ? tracks.reduce((n,t)=>n+positive(t.allPlays),0) : null;
  const seconds=known ? tracks.reduce((n,t)=>n+positive(t.allPlays)*positive(t.duration_s),0) : null;
  const rank=ranks.find(r=>r.album_artist+US+r.album===key)?.rank;
  const years=[...new Set(tracks.map(t=>positive(t.year)).filter(Boolean))].sort();
  const releaseDates=[...new Set(tracks.map(t=>t.releaseDate?.slice(0,10)).filter(date=>typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date))];
  const genres=[...new Set(tracks.map(t=>t.genre).filter(Boolean))];
  const duration=tracks.reduce((n,t)=>n+positive(t.duration_s),0);
  const sameSongKey=(t:Any)=>`${String(t.album_artist || t.artist || '').normalize('NFC').trim().toLowerCase()}${String(t.title || '').normalize('NFC').trim().toLowerCase().replace(/\s+\d+\.\d+(?=\s*(?:\(|$))/g,'').replace(/\s+/g,' ')}`;
  const playSources=new Map<string,Any>();
  for(const candidate of Object.values(index.tracks) as Any[]){
    if(candidate.gone || !(candidate.allPlays>0))continue;
    const k=sameSongKey(candidate), current=playSources.get(k);
    if(!current || (candidate.allPlays || 0)>(current.allPlays || 0))playSources.set(k,candidate);
  }
  const withBorrowedStats=(t:Any)=>{
    const source=playSources.get(sameSongKey(t));
    if(!source || source.id===t.id || (t.allPlays || 0)>0)return t;
    const td=positive(t.duration_s), sd=positive(source.duration_s);
    if(td && sd && Math.abs(td-sd)>8)return t;
    return {...t, allPlays:source.allPlays, statsTrackId:source.id, lastPlayed:source.lastPlayed || t.lastPlayed};
  };
  return {
    id,key,title:identity.title,artist:identity.artist,ini:ini(identity.title),rank:rank || null,
    img:artwork?.albums?.[key] || tracks.map(t=>artwork?.tracks?.[t.id]).find(Boolean),
    goArtist:()=>go('artist',identity.artist),
    metadata:collectionMetadata(group,today,true),
    metrics:[{value:plays==null?'—':vn(plays),label:'Lượt nghe'},{value:seconds==null?'—':fmtH(seconds/3600),label:'Thời gian nghe'},{value:rank?'#'+rank:'—',label:'Hạng All time'}],
    info:[
      {k:'Trong thư viện',v:vn(group.libraryTracks)+' bài'},
      {k:'Đã nghe',v:known?`${group.listened}/${group.totalTracks} bài`:'—'},
      {k:'Độ dài các bài',v:fmtH(duration/3600)},
      ...(releaseDates.length===1
        ? [{k:'Ngày phát hành',v:dmy(releaseDates[0] as string),tone:releaseTone(Number((releaseDates[0] as string).slice(0,4)))}]
        : years.length ? [{k:'Năm phát hành',v:years.join(' · '),tone:releaseTone(years[0] as number)}] : []),
      ...(new Set(tracks.map(t=>t.album)).size>1?[{k:'Phiên bản đã gộp',v:[...new Set(tracks.map(t=>t.album))].join(' · ')}]:[]),
      ...(genres.length?[{k:'Thể loại',v:genres.join(' · ')}]:[]),
      ...(group.added?[{k:'Thêm vào thư viện',v:dmy(group.added)}]:[]),
    ],
    discs:[...new Set(tracks.map(t=>positive(t.disc)||1))],
    songs:tracks.map(raw=>{const t=withBorrowedStats(raw);return {
      tid:raw.id,statsTrackId:t.statsTrackId,title:raw.title,duration_s:raw.duration_s,releaseDate:raw.releaseDate?.slice(0,10),artist:raw.artist || identity.artist,album:canonicalAlbum(raw.album_artist || identity.artist,raw.album),originalAlbum:raw.album,albumArtist:raw.album_artist || identity.artist,ini:ini(raw.title),img:artwork?.tracks?.[raw.id] || artwork?.albums?.[key],
      disc:positive(raw.disc)||1,trackNumber:positive(raw.trackNumber)||null,gone:raw.in_library===0,
      titleTone:ratingTone(raw.my_rating || 0),artistTone:artistTone(index.artists[raw.album_artist || raw.artist]?.allHours || 0),metadata:trackMetadata(raw,today),
      metric:t.allPlays==null?'—':vn(t.allPlays)+' lượt',listening:t.allPlays==null?undefined:fmtH(t.allPlays*positive(raw.duration_s)/3600),timeFirst:true,
      onTap:()=>go('song',raw.id),
    }}),
  };
}

// Release metadata remains useful even before any of its tracks enter the library.
export function releaseAlbumView(release:Release,go:(screen:any,id:string)=>void) {
  const releaseId=syntheticReleaseId(release.id)?undefined:release.id;
  return {
    id:albumId(release.artist,release.title),key:release.artist+US+release.title,
    title:release.title,artist:release.artist,ini:ini(release.title),img:release.cover,releaseId,
    goArtist:()=>go('artist',release.artist),
    metadata:[{text:releaseDate(release.date),title:'Ngày phát hành'},{text:release.type,title:'Loại phát hành'}],
    metrics:[],discs:[],songs:[],
    info:[{k:release.date.length===4?'Năm phát hành':'Ngày phát hành',v:releaseDate(release.date),tone:releaseTone(Number(release.date.slice(0,4)))},{k:'Loại phát hành',v:release.type}],
  };
}

// A song can name an album that has no tracks in the local library yet. Keep
// that identity routable so the album screen can request the complete catalog.
export function catalogAlbumView(artist:string,title:string,go:(screen:any,id:string)=>void) {
  return {
    id:albumId(artist,title),key:artist+US+title,title,artist,ini:ini(title),catalogOnly:true,
    goArtist:()=>go('artist',artist),metadata:[],metrics:[],discs:[],songs:[],info:[],
  };
}

// Keep catalogue ordering; only merge an unambiguous song from this exact album.
export function mergeAlbumTracks(catalog:import('./discovery').AlbumCatalogTrack[],local:Any[]) {
  const name=(value:string)=>value.normalize('NFC').toLowerCase().trim().replace(/\s+\d+\.\d+(?=\s*(?:\(|$))/g,'').replace(/\s+/g,' ');
  return catalog.map(track=>{
    const matches=local.filter(song=>!song.gone && name(song.title)===name(track.title) && name(song.artist)===name(track.artist));
    const numbered=matches.filter(song=>song.disc===track.disc && song.trackNumber===track.trackNumber);
    const match=numbered.length===1 ? numbered[0] : matches.length===1 ? matches[0] : undefined;
    return {...track,local:match};
  });
}
