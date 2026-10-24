import { canonicalAlbum } from '@/lib/album-groups';
import { applyArtworkRanks } from '@/lib/artwork-ranks';
import { fetchJson } from '@/lib/api';
import { SongListeningMetrics } from '@/components/song-listening-metrics';
import { songShortcut } from '@/components/shortcuts';
import { ShortcutSheetNav, useSheetMotion, useSheetSwipeDismiss } from '@/components/shortcut-sheet-controls';
import { ArtworkRank } from '@/components/artwork-rank';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Ctx, VM } from '@/vm';
import { Chips, EmptyState, Thumb } from '@/components/ui';
import { AppleMusicArtwork } from '@/components/apple-music-artwork';
import { LastfmScrobbleRefreshButton, LastfmTrackMetrics } from '@/components/lastfm-track-metrics';
import { MusicMetadata, SongTitle } from '@/components/music-metadata';
import { SongListRow } from './main';
import { durationLabel, elapsedAgeLabel, lastPlayedColor, releaseTone } from '@/lib/metadata';
import { fmtH, fmtWhen, ini, toMs, vn } from '@/lib/fmt';
import { PLAYLIST_KEYWORDS_EVENT, PLAYLIST_RANK_EXCLUDES_EVENT, PLAYLIST_SNAPSHOT_EVENT, addPlaylistRankExclude, buildPlaylistMetaRows, buildPlaylistRankRows, invalidatePlaylistSnapshot, peekPlaylistSnapshot, readPlaylistRankExcludes, syncPlaylistRankingSettings, type Playlist, type PlaylistMetaRow, type PlaylistRankRow, loadPlaylistSnapshot, playlistLibraryIndex, playlistMetricMode, type PlaylistSnapshot, type PlaylistTrack } from '@/lib/playlists';
import { consumeWidgetPlaylistSelectionInNativeApp, loadNativePlaylistLastPlayedInNativeApp, loadPebblePlaylistFavoriteIdsInNativeApp, openPlaylistInMusicNativeApp, playPlaylistInNativeApp, setPlaylistPebbleFavoriteInNativeApp } from '@/lib/ios-bridge';
import { longPress } from '@/lib/long-press';
import { lockTextSelection } from '@/lib/selection-lock';
import { IOS_APP } from '@/config';

type P = {vm:VM; c:Ctx};
function useSnapshot() {
  const [data,setData]=useState<PlaylistSnapshot|null>(()=>peekPlaylistSnapshot()),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const sync=()=>{invalidatePlaylistSnapshot();setAttempt(n=>n+1);};
    const refresh=()=>void loadPlaylistSnapshot().then(value=>setData(value)).catch(()=>{});
    window.addEventListener(PLAYLIST_KEYWORDS_EVENT,sync);
    window.addEventListener(PLAYLIST_SNAPSHOT_EVENT,refresh);
    window.addEventListener('storage',sync);
    void syncPlaylistRankingSettings();
    return()=>{window.removeEventListener(PLAYLIST_KEYWORDS_EVENT,sync);window.removeEventListener(PLAYLIST_SNAPSHOT_EVENT,refresh);window.removeEventListener('storage',sync);};
  },[]);
  useEffect(()=>{
    let active=true;setError(false);
    loadPlaylistSnapshot().then(value=>{if(active)setData(value);}).catch(()=>{if(active&&!peekPlaylistSnapshot())setError(true);});
    return ()=>{active=false;};
  },[attempt]);
  return {data,error,retry:()=>setAttempt(n=>n+1)};
}
const folded=(value:string)=>value.normalize('NFC').toLocaleLowerCase('vi');

const PLAYLIST_LIST_SORTS = ['Thứ tự gốc','Pebble','Hạng','Điểm','Recency','Tên','Số bài','Average','Nghe gần đây'] as const;
type PlaylistListSort = typeof PLAYLIST_LIST_SORTS[number];
const pebblePlaylistNameKey = (playlist:Playlist) => `name:${String(playlist.name || '').normalize('NFC').trim().toLocaleLowerCase('vi')}`;
const playlistIsPebble = (playlist:Playlist, favoriteIds?:ReadonlySet<string>|null) => favoriteIds ? favoriteIds.has(playlist.id) || favoriteIds.has(pebblePlaylistNameKey(playlist)) : !!(playlist.favorite || playlist.favourite);
function sortPlaylistCards(rows:Playlist[], sort:PlaylistListSort, source:Playlist[], rankById:Map<string,PlaylistRankRow>, metaById:Map<string,PlaylistMetaRow>, favoriteIds?:ReadonlySet<string>|null) {
  const originalIndex=(playlist:Playlist)=>source.indexOf(playlist);
  const meta=(playlist:Playlist)=>rankById.get(playlist.id) || metaById.get(playlist.id);
  const score=(playlist:Playlist)=>rankById.get(playlist.id)?.score ?? metaById.get(playlist.id)?.referenceScore ?? 0;
  const recency=(playlist:Playlist)=>meta(playlist)?.recency ?? -1;
  const avg=(playlist:Playlist)=>meta(playlist)?.avg ?? -1;
  const trackCount=(playlist:Playlist)=>meta(playlist)?.trackCount ?? playlist.items.length;
  const last=(playlist:Playlist)=>meta(playlist)?.lastPlayedMs ?? -Infinity;
  const pebble=(playlist:Playlist)=>playlistIsPebble(playlist,favoriteIds);
  const text=(a:string,b:string)=>a.localeCompare(b,'vi',{numeric:true,sensitivity:'base'});
  return [...rows].sort((a,b)=>{
    const delta=sort==='Hạng'
      ? ((rankById.get(a.id)?.rank ?? Infinity)-(rankById.get(b.id)?.rank ?? Infinity)) || score(b)-score(a)
      : sort==='Pebble'
        ? Number(pebble(b))-Number(pebble(a))
        : sort==='Điểm'
        ? score(b)-score(a)
        : sort==='Recency'
          ? recency(b)-recency(a) || score(b)-score(a)
          : sort==='Tên'
            ? text(a.name,b.name)
            : sort==='Số bài'
              ? trackCount(b)-trackCount(a)
              : sort==='Average'
                ? avg(b)-avg(a)
                : sort==='Nghe gần đây'
                  ? last(b)-last(a)
                  : 0;
    return delta || originalIndex(a)-originalIndex(b);
  });
}

function SnapshotDate({data}:{data:PlaylistSnapshot}) {
  const label = /ios|iphone|music library/i.test(data.source || '') ? 'Dữ liệu Apple Music trên iPhone' : 'Dữ liệu playlist';
  return <span>{label}{data.exportedAt ? ' · '+new Date(data.exportedAt).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}) : ''}</span>;
}
export function PlaylistsScreen({vm,c}:P) {
  const {data,error,retry}=useSnapshot();
  const [menu,setMenu]=useState<Playlist|null>(null);
  const [rankExcludes,setRankExcludes]=useState(()=>readPlaylistRankExcludes());
  const [favoriteIds,setFavoriteIds]=useState<Set<string>|null>(null);
  useEffect(()=>{
    const sync=()=>setRankExcludes(readPlaylistRankExcludes());
    window.addEventListener(PLAYLIST_RANK_EXCLUDES_EVENT,sync);
    window.addEventListener('storage',sync);
    return()=>{window.removeEventListener(PLAYLIST_RANK_EXCLUDES_EVENT,sync);window.removeEventListener('storage',sync);};
  },[]);
  const query=c.p.q;
  const listSort:PlaylistListSort='Thứ tự gốc';
  const setQuery=(q:string)=>c.set(()=>({q}));
  const setFolder=(playlistFolder:string)=>c.set(()=>({playlistFolder}));
  const rankLibrary=vm.nowPlayingLibrary?.length ? vm.nowPlayingLibrary : vm.playlistLibrary;
  const rankRows=useMemo(()=>data?buildPlaylistRankRows(data,rankLibrary,data.playlists.length,rankExcludes,true):[],[data,rankLibrary,rankExcludes]);
  const rankById=useMemo(()=>new Map(rankRows.map(row=>[row.id,row])),[rankRows]);
  const metaRows=useMemo(()=>data?buildPlaylistMetaRows(data,rankLibrary):[],[data,rankLibrary]);
  const metaById=useMemo(()=>new Map(metaRows.map(row=>[row.id,row])),[metaRows]);
  useEffect(()=>{
    if(!data)return;
    let active=true;
    const fallback=new Set(data.playlists.filter(playlist=>playlistIsPebble(playlist,null)).map(playlist=>playlist.id));
    setFavoriteIds(fallback);
    loadPebblePlaylistFavoriteIdsInNativeApp().then(ids=>{if(active&&ids)setFavoriteIds(ids);}).catch(()=>{});
    return()=>{active=false;};
  },[data]);
  const setPebbleFavorite=(playlist:Playlist, enabled:boolean)=>{
    setFavoriteIds(current=>{
      const next=new Set(current || data?.playlists.filter(item=>playlistIsPebble(item,null)).map(item=>item.id) || []);
      if(enabled){next.add(playlist.id);next.add(pebblePlaylistNameKey(playlist));}
      else {next.delete(playlist.id);next.delete(pebblePlaylistNameKey(playlist));}
      return next;
    });
  };
  if(error)return <EmptyState note="" title="Chưa tải được playlist" action={{label:'Thử lại',onTap:retry}} />;
  if(!data)return <div className="playlist-note t3" role="status">Đang tải playlist…</div>;
  const visibleFolders = data.folders.filter(label=>data.playlists.some(p=>p.folder===label));
  const chipLabels = ['Tất cả',...visibleFolders];
  const folder = chipLabels.includes(c.p.playlistFolder) ? c.p.playlistFolder : 'Tất cả';
  const searching=query.trim().length>0;
  const rows=sortPlaylistCards(data.playlists.filter(p=>folded(`${p.name} ${p.path} ${p.folder}`).includes(folded(query))),listSort,data.playlists,rankById,metaById,favoriteIds);
  const groupNames = visibleFolders.filter(name=>rows.some(p=>p.folder===name));
  return <>
    <div className="search" style={{margin:'12px 16px 0'}}><input aria-label="Tìm playlist" placeholder="Tìm playlist" value={query} onChange={e=>setQuery(e.target.value)} /></div>
    <div className="playlist-toolbar"><div className="playlist-note t3"><SnapshotDate data={data} /></div></div>
    <div className="playlist-folder-grid">
      {groupNames.map(name=>{
        const group=rows.filter(p=>p.folder===name),expanded=searching||folder===name;
        return <section key={name} className={'playlist-folder'+(expanded?' expanded':'')}>
          <button type="button" className="playlist-folder-toggle" aria-expanded={expanded} onClick={()=>setFolder(expanded?'Tất cả':name)}>
            <span className="playlist-folder-name">{name}</span>
            <span className="playlist-folder-meta"><span className="num">{group.length}</span><span aria-hidden="true">{expanded?'⌃':'⌄'}</span></span>
          </button>
          {expanded&&<div className="playlist-grid">
            {group.map(p=><PlaylistTile key={p.id} playlist={p} rank={rankById.get(p.id)} meta={metaById.get(p.id)} hue={data.playlists.indexOf(p)*137.508%360} pebble={playlistIsPebble(p,favoriteIds)} open={()=>c.go('playlist',p.id)} menu={()=>setMenu(p)}/>)}
          </div>}
        </section>;
      })}
    </div>
    {!rows.length&&<EmptyState note="" title="Không có playlist phù hợp" />}
    {menu&&<PlaylistMenu playlist={menu} pebble={playlistIsPebble(menu,favoriteIds)} c={c} close={()=>setMenu(null)} onPebbleChange={enabled=>setPebbleFavorite(menu,enabled)} onExclude={()=>{setRankExcludes(addPlaylistRankExclude(menu));c.ptoast('Đã exclude playlist khỏi ranking.');setMenu(null);}}/>}
  </>;
}
function PlaylistTile({playlist,rank,meta,hue,pebble,open,menu}:{playlist:Playlist;rank?:PlaylistRankRow;meta?:PlaylistMetaRow;hue:number;pebble:boolean;open:()=>void;menu:()=>void}) {
  const gesture=useRef<ReturnType<typeof longPress>>();
  const latest=useRef(menu); latest.current=menu;
  if(!gesture.current)gesture.current=longPress(()=>latest.current());
  useEffect(()=>()=>gesture.current?.cancel(),[]);
  const displayMeta = rank || meta;
  const title=displayMeta ? `${playlist.path} / ${playlist.name}
${displayMeta.explanation}` : playlist.path+' / '+playlist.name;
  return <button className={'playlist-tile'+(rank?' has-rank':'')+(pebble?' pebble-favorite':'')} style={{background:`hsl(${hue} 26% 14%)`,borderColor:`hsl(${hue} 22% 24%)`}} title={title}
    aria-haspopup="dialog"
    aria-label={rank?`${playlist.name}. Hạng ${rank.rank}${rank.change?rank.change>0?`; tăng ${rank.change} bậc so với best trước đó #${rank.bestRank}${rank.comparison?' '+rank.comparison:''}`:`; giảm ${Math.abs(rank.change)} bậc so với best trước đó #${rank.bestRank}${rank.comparison?' '+rank.comparison:''}`:''}. ${rank.explanation}`:playlist.name}
    onPointerDown={e=>{if(!e.isPrimary||e.button!==0){gesture.current!.cancel();return;}gesture.current!.start(e.clientX,e.clientY);}}
    onPointerMove={e=>gesture.current!.move(e.clientX,e.clientY)}
    onPointerUp={()=>gesture.current!.end()}
    onPointerCancel={()=>gesture.current!.cancel()}
    onPointerLeave={()=>gesture.current!.cancel()}
    onClickCapture={e=>{if(gesture.current!.consumeClick()){e.preventDefault();e.stopPropagation();}}}
    onContextMenu={e=>{e.preventDefault();e.stopPropagation();gesture.current!.blockClick();menu();}}
    onKeyDown={e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();menu();}}}
    onClick={open}>
    {rank&&<span className={'playlist-rank-badge num'+(rank.change?' with-change':'')} aria-hidden="true"><span>{rank.rank}</span>{rank.change&&<span className={'playlist-rank-change '+(rank.change>0?'up':'down')}>{rank.change>0?'▲':'▼'}<strong>{Math.abs(rank.change)}</strong></span>}</span>}
    <span className="playlist-tile-name">{playlist.name.split('_').map((part,i)=><span key={i}>{i>0&&<>_<wbr/></>}{part}</span>)}</span>
    {displayMeta ? <div className="playlist-rank-meta">
      <MusicMetadata items={displayMeta.metadata.slice(0,3)}/>
      <MusicMetadata items={displayMeta.metadata.slice(3)}/>
    </div> : <span className="playlist-tile-count t3">{playlist.items.length} bài</span>}
  </button>;
}
function PlaylistMenu({playlist,pebble,c,close:onDismiss,onPebbleChange,onExclude}:{playlist:Playlist;pebble:boolean;c:Ctx;close:()=>void;onPebbleChange:(enabled:boolean)=>void;onExclude:()=>void}) {
  const {close,exit,motionProps}=useSheetMotion(onDismiss);
  const swipeDismiss=useSheetSwipeDismiss(close);
  const panel=useRef<HTMLDivElement>(null);
  const ignoreClicksUntil=useRef(0);
  const actionIntent=useRef(false);
  const [busy,setBusy]=useState('');
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    const unlockSelection=lockTextSelection();
    ignoreClicksUntil.current=Date.now()+650;
    panel.current?.focus({preventScroll:true});
    return()=>{unlockSelection();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  async function run(kind:'pebble'|'music'|'play'|'next') {
    const intended=actionIntent.current;actionIntent.current=false;
    if(!intended || Date.now()<ignoreClicksUntil.current)return;
    if(busy)return;
    setBusy(kind);
    try {
      const nextPebble=!pebble;
      const ok=kind==='pebble'
        ? await setPlaylistPebbleFavoriteInNativeApp(playlist.id,nextPebble)
        : kind==='music'
          ? await openPlaylistInMusicNativeApp(playlist.id)
          : await playPlaylistInNativeApp(playlist.id,kind);
      if(!ok)throw new Error(kind==='pebble'?'Chỉ sửa Pebble được trên iPhone.':'Chỉ điều khiển Apple Music được trên iPhone.');
      if(kind==='pebble')onPebbleChange(nextPebble);
      c.ptoast(kind==='pebble'
        ? (nextPebble?'Đã thêm playlist vào Pebble.':'Đã loại playlist khỏi Pebble.')
        : kind==='music'?'Đang mở playlist trong Apple Music.'
        : kind==='play'?'Đang phát playlist.':'Đã thêm playlist vào phát tiếp theo.');
      close();
    } catch(error) {
      c.ptoast(error instanceof Error?error.message:'Chưa thực hiện được.');
    } finally {
      setBusy('');
    }
  }
  const actionEvents={
    onPointerDown:(event:PointerEvent)=>{if(event.isPrimary && event.button===0)actionIntent.current=true;},
    onKeyDown:(event:KeyboardEvent)=>{if(event.key==='Enter'||event.key===' ')actionIntent.current=true;},
  };
  return createPortal(<div {...motionProps} className="shortcut-backdrop" onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <div {...swipeDismiss} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={'Playlist actions: '+playlist.name} className="shortcut-sheet" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}}}>
      <ShortcutSheetNav canBack back={close} close={close}/>
      <button type="button" className="shortcut-heading shortcut-heading-link" onClick={()=>exit(()=>{onDismiss();c.go('playlist',playlist.id);})}><strong>{playlist.name}</strong><span className="t3">{playlist.path} · {vn(playlist.items.length)} bài</span></button>
      <button type="button" disabled={!!busy} {...actionEvents} onClick={()=>void run('pebble')}>{busy==='pebble'?(pebble?'Đang loại…':'Đang thêm…'):(pebble?'Loại khỏi Pebble':'Thêm vào Pebble')} <span>{pebble?'−':'＋'}</span></button>
      <button type="button" disabled={!!busy} {...actionEvents} onClick={()=>void run('play')}>{busy==='play'?'Đang phát…':'Phát playlist'} <span aria-hidden="true">▶</span></button>
      <button type="button" disabled={!!busy} {...actionEvents} onClick={()=>void run('next')}>{busy==='next'?'Đang thêm…':'Phát tiếp theo'} <span aria-hidden="true">↳</span></button>
      <button type="button" disabled={!!busy} {...actionEvents} onClick={()=>void run('music')}>{busy==='music'?'Đang mở…':'Open in Music'} <span>↗</span></button>
      <button type="button" disabled={!!busy} {...actionEvents} onClick={()=>{const intended=actionIntent.current;actionIntent.current=false;if(!intended||Date.now()<ignoreClicksUntil.current)return;exit(()=>{onDismiss();c.go('topPlaylists');});}}>Go to Top playlist <span>▦</span></button>
      <button type="button" disabled={!!busy} {...actionEvents} onClick={()=>{const intended=actionIntent.current;actionIntent.current=false;if(!intended||Date.now()<ignoreClicksUntil.current)return;onExclude();}}>Exclude khỏi ranking <span>⊘</span></button>
      <button type="button" className="shortcut-close" onClick={close}>Đóng</button>
    </div>
  </div>,document.body);
}

export function WidgetPlaylistActionMenu({playlist,c,close:onDismiss}:{playlist:Playlist;c:Ctx;close:()=>void}) {
  const {close,exit,motionProps}=useSheetMotion(onDismiss);
  const swipeDismiss=useSheetSwipeDismiss(close);
  const [busy,setBusy]=useState('');
  async function run(kind:'play'|'next'|'music') {
    if(busy)return;
    setBusy(kind);
    try {
      const ok=kind==='music'
        ? await openPlaylistInMusicNativeApp(playlist.id)
        : await playPlaylistInNativeApp(playlist.id,kind);
      if(!ok)throw new Error('Chỉ điều khiển Apple Music được trên iPhone.');
      c.ptoast(kind==='play'?'Đang phát playlist.':kind==='next'?'Đã thêm playlist vào phát tiếp theo.':'Đang mở playlist trong Apple Music.');
      close();
    } catch(error) {
      c.ptoast(error instanceof Error?error.message:'Chưa thực hiện được.');
    } finally {
      setBusy('');
    }
  }
  return createPortal(<div {...motionProps} className="shortcut-backdrop" onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <div {...swipeDismiss} role="dialog" aria-modal="true" aria-label={'Playlist actions: '+playlist.name} className="shortcut-sheet">
      <ShortcutSheetNav canBack back={close} close={close}/>
      <button type="button" className="shortcut-heading shortcut-heading-link" onClick={()=>exit(()=>{onDismiss();c.go('playlist',playlist.id);})}><strong>{playlist.name}</strong><span className="t3">{playlist.path} · {vn(playlist.items.length)} bài</span></button>
      <button type="button" disabled={!!busy} onClick={()=>void run('play')}>{busy==='play'?'Đang phát…':'Phát playlist'} <span aria-hidden="true">▶</span></button>
      <button type="button" disabled={!!busy} onClick={()=>void run('next')}>{busy==='next'?'Đang thêm…':'Phát tiếp theo'} <span aria-hidden="true">↳</span></button>
      <button type="button" disabled={!!busy} onClick={()=>exit(()=>{onDismiss();c.go('playlist',playlist.id);})}>Mở chi tiết playlist <span aria-hidden="true">›</span></button>
      <button type="button" disabled={!!busy} onClick={()=>void run('music')}>{busy==='music'?'Đang mở…':'Open in Music'} <span aria-hidden="true">↗</span></button>
      <button type="button" className="shortcut-close" onClick={close}>Đóng</button>
    </div>
  </div>,document.body);
}

export function WidgetPlaylistDeepLink({c}:{c:Ctx}) {
  const go=useRef(c.go);go.current=c.go;
  useEffect(()=>{
    if(!IOS_APP)return;
    let active=true;
    let retryTimer:ReturnType<typeof setTimeout>|undefined;
    const check=async(attempt=0)=>{
      try {
        const id=await consumeWidgetPlaylistSelectionInNativeApp();
        if(!active||!id)return;
        go.current('playlist',id);
      } catch {
        if(active&&attempt<4)retryTimer=setTimeout(()=>void check(attempt+1),300);
      }
    };
    const refresh=()=>void check();
    retryTimer=setTimeout(refresh,350);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;clearTimeout(retryTimer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[]);
  return null;
}
export function PlaylistScreen({vm,c}:P) {
  const {data,error,retry}=useSnapshot();
  const [nativeLastPlayed,setNativeLastPlayed]=useState<Record<string,string>>({});
  const limit=c.p.listLimit;
  const setLimit=(value:number|((n:number)=>number))=>c.set(p=>({listLimit:typeof value==='function'?value(p.listLimit):value}));
  const findTrack=useMemo(()=>playlistLibraryIndex(vm.playlistLibrary||[]),[vm.playlistLibrary]);
  const playlist=data?.playlists.find(p=>p.id===c.id);
  const rows=playlist?.items.flatMap((id,index)=>data?.tracks[id]?[{id,index,track:data.tracks[id]}]:[]) || [];
  const historyIds=[...new Set(rows.slice(0,limit).map(({track})=>findTrack(track)?.id).filter((id):id is string=>!!id))].sort().slice(0,80);
  const historyPath=historyIds.length?`/history/song-ranks?ids=${encodeURIComponent(historyIds.join(','))}&months=60&generation=${encodeURIComponent(vm.currentSongRankGeneration||'unknown')}`:'';
  const rankHistory=historyPath?fetchJson(historyPath,true).data:null;
  const rankedLibrary=useMemo(()=>{
    const library=(vm.playlistLibrary||[]).map(row=>({...row}));
    if(rankHistory){
      const songs=Object.entries(vm.currentSongRanks||{}).map(([track_id,rank])=>({track_id,rank}));
      applyArtworkRanks({playlistLibrary:library},songs,[],rankHistory);
    }
    return new Map(library.map(row=>[row.id,row]));
  },[vm.playlistLibrary,vm.currentSongRanks,rankHistory]);
  useEffect(()=>{
    let active=true;
    const refresh=()=>{
      if(!IOS_APP||!playlist?.id)return;
      loadNativePlaylistLastPlayedInNativeApp(playlist.id).then(value=>{if(active)setNativeLastPlayed(value);}).catch(()=>{});
    };
    setNativeLastPlayed({});
    refresh();
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[playlist?.id]);
  if(error)return <EmptyState note="" title="Chưa tải được playlist" action={{label:'Thử lại',onTap:retry}} />;
  if(!data)return <div className="playlist-note t3" role="status">Đang tải playlist…</div>;
  if(!playlist)return <EmptyState note="" title="Không tìm thấy playlist trong dữ liệu hiện tại" />;
  return <>
    <div className="sec">{playlist.name}</div>
    <div className="playlist-detail-toolbar"><div className="playlist-note playlist-summary t2">{playlist.path} · {vn(playlist.items.length)} bài{data.exportedAt && <span className="t3"> · playlist {new Date(data.exportedAt).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</span>}</div></div>
    <div className="card playlist-song-list">
      {rows.slice(0,limit).map(({id,index,track})=>{
        const persistentId=String(track.persistentId||'').replace(/^0x/i,'').toUpperCase();
        const owned=findTrack(track);
        return <PlaylistSong key={id+':'+index} playlistId={playlist.id} playlistName={playlist.name} playlistSize={playlist.items.length} track={track} folder={playlist.folder} index={index} owned={owned?rankedLibrary.get(owned.id)||owned:undefined} libraryReady={!!vm.playlistLibrary} artwork={vm.playlistArtwork||{}} nativeLibraryPlayedAt={IOS_APP&&persistentId?nativeLastPlayed[persistentId]:undefined} c={c} />;
      })}
    </div>
    {!rows.length&&<EmptyState note="" title="Playlist chưa có bài trong dữ liệu hiện tại" />}
    {rows.length>limit&&<button className="btn-wide btn-subtle" onClick={()=>setLimit(n=>n+50)}>Xem thêm · còn {vn(rows.length-limit)} bài</button>}
    {!!vm.playlistLibrary&&rows.some(({track})=>!findTrack(track)&&!track.missing)&&<LastfmScrobbleRefreshButton notify={c.ptoast} tracks={rows.filter(({track})=>!findTrack(track)&&!track.missing).map(({track})=>({artist:track.artist||track.albumArtist||'',title:track.title}))}/>}
  </>;
}
function PlaylistSong({playlistId,playlistName,playlistSize,track,folder,index,owned,libraryReady,artwork,nativeLibraryPlayedAt,c}:{playlistId:string;playlistName:string;playlistSize:number;track:PlaylistTrack;folder:string;index:number;owned?:any;libraryReady:boolean;artwork:Record<string,string>;nativeLibraryPlayedAt?:string;c:Ctx}) {
  const mode=playlistMetricMode(folder,track,libraryReady,!!owned);
  const outsideLibrary=libraryReady && !owned;
  const plays=owned?.allPlays, duration=owned?.duration_s || track.duration;
  const metadata = [
    ...(track.duration ? [{text:durationLabel(track.duration),title:'Độ dài bài hát',tone:'gray' as const}] : []),
    ...(track.year ? [{text:String(track.year),title:'Năm phát hành',tone:releaseTone(track.year)}] : []),
  ];
  if(owned){
    const sourceMetadata=owned.metadata?.length ? owned.metadata : metadata;
    const lastPlayedAt=[owned.last_played,nativeLibraryPlayedAt]
      .filter(value=>Number.isFinite(toMs(value)))
      .sort((a,b)=>toMs(b)-toMs(a))[0];
    const lastPlayed=lastPlayedAt?{text:'▷'+elapsedAgeLabel(lastPlayedAt),title:'Lần nghe cuối',detail:fmtWhen(lastPlayedAt),tone:'gray',color:lastPlayedColor(lastPlayedAt)}:sourceMetadata.find((item:any)=>item.title==='Lần nghe cuối');
    const visibleMetadata=sourceMetadata.filter((item:any)=>item.title!=='Lần nghe cuối');
    const row={
      tid:owned.id,
      title:owned.title || track.title,
      artist:owned.artist || track.artist,
      album:canonicalAlbum(owned.album_artist || owned.artist || track.albumArtist || track.artist || '',owned.album || track.album || ''),
      albumDisplay:owned.artist || track.artist,
      originalAlbum:owned.originalAlbum || owned.album || track.album,
      albumArtist:owned.albumArtist || owned.album_artist || track.albumArtist || track.artist,
      ini:ini(owned.title || track.title),
      img:owned.img || artwork[owned.id],
      metadata:visibleMetadata,
      titleTone:owned.titleTone || 'gray',
      artistTone:owned.artistTone || 'gray',
      allTimeRank:owned.allTimeRank,
      allTimeChange:owned.allTimeChange,
      allTimeComparison:owned.allTimeComparison,
      rankWeight:owned.rankWeight ?? owned.rank_weight,
      applePid:track.persistentId || owned.applePid || owned.apple_pid || owned.persistentId,
      queueContext:{kind:'playlist' as const,playlistId,label:playlistName,itemCount:playlistSize,index},
      duration_s:duration,
      metric:plays==null?'—':vn(plays)+' lượt',
      listening:plays!=null && duration?fmtH(plays*duration/3600):undefined,
      timeFirst:true,
      onTap:()=>c.go('song',owned.id),
    };
    return <SongListRow r={row} hideArtist right={<div className="song-metrics num playlist-last-played"><span style={lastPlayed?.color?{color:lastPlayed.color}:undefined} title={lastPlayed?`Lần nghe cuối: ${lastPlayed.detail || lastPlayed.text}`:'Chưa có lần nghe'}>{lastPlayed?.text || '—'}</span></div>}/>;
  }
  const content=<>
    <div className="song-artwork"><Thumb ini={ini(track.title)} img={owned ? artwork[owned.id] : undefined} size={52}/><ArtworkRank rank={owned?.allTimeRank} change={owned?.allTimeChange} comparison={owned?.allTimeComparison} /></div>
    <div className="song-copy"><SongTitle title={track.title} tone={outsideLibrary?'muted':'gray'} items={metadata}/>
      <div className="song-album-line"><div className="song-album ell" title={track.artist}>{track.artist}</div><MusicMetadata items={metadata}/></div>
    </div>
    {mode!=='local' ? <LastfmTrackMetrics artist={track.artist||track.albumArtist||''} title={track.title} trackId={owned?.id} disabled={mode==='waiting'} outsideLibrary={outsideLibrary} addToLibrary={outsideLibrary?{query:{kind:'song',artist:track.artist||track.albumArtist||'',title:track.title,album:track.album},notify:c.ptoast}:undefined} />
      : <SongListeningMetrics plays={plays==null?'—':vn(plays)+'x'} listening={plays!=null && (duration || plays===0)?fmtH(plays*(duration||0)/3600):'—'} duration={duration} rankWeight={owned?.rankWeight ?? owned?.rank_weight} />}
  </>;
  if(track.missing)return <div className="row song-row">{content}</div>;
  return <AppleMusicArtwork className="row song-row similar-track" query={{kind:'song',artist:track.artist||track.albumArtist||'',title:track.title,album:track.album}} notify={c.ptoast} lazy shortcut={songShortcut({title:track.title,artist:track.artist||track.albumArtist||'',album:track.album,applePid:track.persistentId,queueContext:{kind:'playlist',playlistId,label:playlistName,itemCount:playlistSize,index}})}>{content}</AppleMusicArtwork>;
}
