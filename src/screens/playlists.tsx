import { canonicalAlbum } from '@/lib/album-groups';
import { SongListeningMetrics } from '@/components/song-listening-metrics';
import { ShortcutTarget, songShortcut } from '@/components/shortcuts';
import { ArtworkRank } from '@/components/artwork-rank';
import { useEffect, useMemo, useState } from 'react';
import type { Ctx, VM } from '@/vm';
import { Chips, EmptyState, Thumb } from '@/components/ui';
import { AppleMusicArtwork } from '@/components/apple-music-artwork';
import { LastfmTrackMetrics } from '@/components/lastfm-track-metrics';
import { MusicMetadata, SongTitle } from '@/components/music-metadata';
import { durationLabel, releaseTone } from '@/lib/metadata';
import { fmtH, ini, vn } from '@/lib/fmt';
import { PLAYLIST_SORTS, sortPlaylistRows, type PlaylistSort, loadPlaylistSnapshot, playlistLibraryIndex, playlistMetricMode, type PlaylistSnapshot, type PlaylistTrack } from '@/lib/playlists';

type P = {vm:VM; c:Ctx};
function useSnapshot() {
  const [data,setData]=useState<PlaylistSnapshot|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;setError(false);
    loadPlaylistSnapshot().then(value=>{if(active)setData(value);}).catch(()=>{if(active)setError(true);});
    return ()=>{active=false;};
  },[attempt]);
  return {data,error,retry:()=>setAttempt(n=>n+1)};
}
const folded=(value:string)=>value.normalize('NFC').toLocaleLowerCase('vi');
function SnapshotDate({value}:{value:string|null}) {
  return <div className="playlist-note t3">Dữ liệu XML{value ? ' · '+new Date(value).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}) : ''}</div>;
}
export function PlaylistsScreen({c}:P) {
  const {data,error,retry}=useSnapshot();
  const query=c.p.q, folder=c.p.playlistFolder;
  const setQuery=(q:string)=>c.set(()=>({q}));
  const setFolder=(playlistFolder:string)=>c.set(()=>({playlistFolder}));
  if(error)return <EmptyState note="" title="Chưa tải được playlist" action={{label:'Thử lại',onTap:retry}} />;
  if(!data)return <div className="playlist-note t3" role="status">Đang tải playlist…</div>;
  const rows=data.playlists.filter(p=>(folder==='Favourite'?p.favourite:folder==='Tất cả'||p.folder===folder)&&folded(p.name+' '+p.path).includes(folded(query)));
  return <>
    <div className="search" style={{margin:'12px 16px 0'}}><input aria-label="Tìm playlist" placeholder="Tìm playlist" value={query} onChange={e=>setQuery(e.target.value)} /></div>
    <Chips compact items={['Tất cả','Favourite',...data.folders].map(label=>({label,active:folder===label,onTap:()=>setFolder(label)}))} />
    <SnapshotDate value={data.exportedAt} />
    {(folder==='Favourite'?['Favourite']:[...new Set([...data.folders,...rows.map(p=>p.folder)])]).map(name=>{
      const group=name==='Favourite'?rows:rows.filter(p=>p.folder===name); if(!group.length)return null;
      return <section key={name} className="playlist-group"><div className="cap">{name} · {group.length} playlist</div><div className="playlist-grid">
        {group.map(p=><button key={p.id} className="playlist-tile" style={{background:`hsl(${data.playlists.indexOf(p)*137.508%360} 26% 14%)`,borderColor:`hsl(${data.playlists.indexOf(p)*137.508%360} 22% 24%)`}} title={p.path+' / '+p.name} onClick={()=>c.go('playlist',p.id)}>
          <span className="playlist-tile-name">{p.name.split('_').map((part,i)=><span key={i}>{i>0&&<>_<wbr/></>}{part}</span>)}</span>
          <span className="playlist-tile-count t3">{p.items.length} bài</span>
        </button>)}
      </div></section>;
    })}
    {!rows.length&&<EmptyState note="" title="Không có playlist phù hợp" />}
  </>;
}
export function PlaylistScreen({vm,c}:P) {
  const {data,error,retry}=useSnapshot();
  const query=c.p.q, limit=c.p.listLimit;
  const sort=PLAYLIST_SORTS.includes(c.p.playlistSort as PlaylistSort)?c.p.playlistSort as PlaylistSort:'Thứ tự gốc';
  const setQuery=(q:string)=>c.set(()=>({q}));
  const setSort=(playlistSort:PlaylistSort)=>c.set(()=>({playlistSort}));
  const setLimit=(value:number|((n:number)=>number))=>c.set(p=>({listLimit:typeof value==='function'?value(p.listLimit):value}));
  const findTrack=useMemo(()=>playlistLibraryIndex(vm.playlistLibrary||[]),[vm.playlistLibrary]);
  const playlist=data?.playlists.find(p=>p.id===c.id);
  if(error)return <EmptyState note="" title="Chưa tải được playlist" action={{label:'Thử lại',onTap:retry}} />;
  if(!data)return <div className="playlist-note t3" role="status">Đang tải playlist…</div>;
  if(!playlist)return <EmptyState note="" title="Không tìm thấy playlist trong bản XML này" />;
  const rows=sortPlaylistRows(playlist.items.map((id,index)=>({id,index,track:data.tracks[id]})).filter(({track})=>folded([track.title,track.artist,track.album].join(' ')).includes(folded(query))),sort);
  return <>
    <div className="sec">{playlist.name}</div>
    <div className="playlist-note playlist-summary t2">{playlist.path} · {vn(playlist.items.length)} bài{data.exportedAt && <span className="t3"> · XML {new Date(data.exportedAt).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</span>}</div>
    <div className="search" style={{margin:'4px 16px 14px'}}><input aria-label="Tìm bài trong playlist" placeholder="Bài hát, nghệ sĩ, album" value={query} onChange={e=>{setQuery(e.target.value);setLimit(50);}} /></div>
    <Chips compact items={PLAYLIST_SORTS.map(label=>({label,active:sort===label,onTap:()=>{setSort(label);setLimit(50);}}))}/>
    <div className="card playlist-song-list">
      {rows.slice(0,limit).map(({id,index,track})=><PlaylistSong key={id+':'+index} track={track} folder={playlist.folder} index={index} owned={findTrack(track)} libraryReady={!!vm.playlistLibrary} artwork={vm.playlistArtwork||{}} c={c} />)}
    </div>
    {!rows.length&&<EmptyState note="" title={query?'Không có bài phù hợp':'Playlist chưa có bài trong XML'} />}
    {rows.length>limit&&<button className="btn-wide" onClick={()=>setLimit(n=>n+50)}>Xem thêm · còn {vn(rows.length-limit)} bài</button>}
  </>;
}
function PlaylistSong({track,folder,index,owned,libraryReady,artwork,c}:{track:PlaylistTrack;folder:string;index:number;owned?:any;libraryReady:boolean;artwork:Record<string,string>;c:Ctx}) {
  const mode=playlistMetricMode(folder,track,libraryReady,!!owned);
  const outsideLibrary=libraryReady && !owned;
  const plays=owned?.allPlays, duration=owned?.duration_s || track.duration;
  const metadata = [
    ...(track.duration ? [{text:durationLabel(track.duration),title:'Độ dài bài hát',tone:'gray' as const}] : []),
    ...(track.year ? [{text:String(track.year),title:'Năm phát hành',tone:releaseTone(track.year)}] : []),
  ];
  const content=<>
    <div className="song-artwork"><Thumb ini={ini(track.title)} img={owned ? artwork[owned.id] : undefined} size={52}/><ArtworkRank rank={owned?.allTimeRank} change={owned?.allTimeChange} comparison={owned?.allTimeComparison} /></div>
    <div className="song-copy"><div className="sub13 ell">{track.artist}</div><SongTitle title={track.title} tone={outsideLibrary?'muted':'gray'} items={metadata}/>
      <div className="song-album-line"><div className="song-album ell" title={track.album}>{canonicalAlbum(track.albumArtist || track.artist || '',track.album || '')}</div><MusicMetadata items={metadata}/></div>
    </div>
    {mode!=='local' ? <LastfmTrackMetrics artist={track.artist||track.albumArtist||''} title={track.title} trackId={owned?.id} disabled={mode==='waiting'} outsideLibrary={outsideLibrary} />
      : <SongListeningMetrics plays={plays==null?'—':vn(plays)+'x'} listening={plays!=null && (duration || plays===0)?fmtH(plays*(duration||0)/3600):'—'} duration={duration} />}
  </>;
  if(owned)return <ShortcutTarget entity={songShortcut({...track,tid:owned.id,albumArtist:owned.album_artist || track.albumArtist})}><button className="row song-row similar-track" onClick={()=>c.go('song',owned.id)} aria-label={'Mở bài hát: '+track.title}>{content}</button></ShortcutTarget>;
  if(track.missing)return <div className="row song-row">{content}</div>;
  return <AppleMusicArtwork className="row song-row similar-track" query={{kind:'song',artist:track.artist||track.albumArtist||'',title:track.title,album:track.album}} notify={c.ptoast} lazy>{content}</AppleMusicArtwork>;
}
