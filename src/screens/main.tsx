import {MetadataHelp} from '@/components/metadata-help';
import { SongListeningMetrics } from '@/components/song-listening-metrics';
import { SongRankProgress } from '@/components/song-rank-progress';
import { LastfmScrobbleRefreshButton, LastfmTrackMetrics } from '@/components/lastfm-track-metrics';
import { ShortcutTarget, songShortcut, artistShortcut, albumShortcut, RankFocus } from '@/components/shortcuts';
import { ShortcutSheetNav, useSheetMotion, useSheetSwipeDismiss } from '@/components/shortcut-sheet-controls';
import { AlbumGrid } from '@/components/album-grid';
import {listDisplayLimit} from "@/lib/list-preferences";
import { ArtworkRank } from '@/components/artwork-rank';
import { MonthSummaryCard } from '@/components/month-summary-card';
import { MonthlySummaryReadout } from '@/components/month-summary-popup';
// Các màn của 4 tab đầu + trang con của Xếp hạng.
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { RecentAlbumYear } from '@/components/recent-album-year';
import { Ctx, VM } from "@/vm";
import { MusicMetadata, SongTitle, compactPlays } from "@/components/music-metadata";
import { MonthWeeksChart } from "@/lib/month-weeks";
import { ChartCard, Chips, EmptyState, EndOfPage, Flags, Legend, PartRows, SampleChip, ScopeTabs, Sec, SecLink, SecSide, SegTabs, Thumb } from "@/components/ui";
import { vnDate, type NowPlayingTrack } from '@/lib/discovery';
import { fmtH, vn } from '@/lib/fmt';
import { ratingTone, trackMetadata } from '@/lib/metadata';
import { PLAYLIST_KEYWORDS_EVENT, PLAYLIST_RANK_EXCLUDES_EVENT, PLAYLIST_SNAPSHOT_EVENT, addPlaylistRankExclude, buildPlaylistPeriodRows, buildPlaylistRankRows, invalidatePlaylistSnapshot, loadPlaylistSnapshot, readPlaylistRankExcludes, syncPlaylistRankingSettings, type Playlist, type PlaylistRankRow, type PlaylistSnapshot } from '@/lib/playlists';
import { loadPebblePlaylistFavoriteIdsInNativeApp, openPlaylistInMusicNativeApp, playPlaylistInNativeApp, publishWidgetTopPlaylistsInNativeApp, setPlaylistPebbleFavoriteInNativeApp } from '@/lib/ios-bridge';
import { longPress } from '@/lib/long-press';
import { lockTextSelection } from '@/lib/selection-lock';
import { DESKTOP_WEB } from '@/config';

type P = { vm: VM; c: Ctx };
type Any = any;
const lastfmRows = (rows: Any[]) => rows.filter(r=>r && (r.gone || r.unmatched || r.in_library===0) && r.title && r.artist);
const lastfmQueries = (rows: Any[]) => lastfmRows(rows).map(r=>({artist:r.artist || '',title:r.title || '',trackId:r.tid}));

// Tạm ẩn mọi nút Chia sẻ (bật lại: true).
export const SHOW_SHARE = false;

// Tạm ẩn mục Nghệ sĩ theo điểm trên trang Thống kê.
export const SHOW_OVERVIEW_ARTIST_POINTS = false;

// Tạm ẩn biểu đồ Top 10 bài trên trang Diễn biến.
export const SHOW_TREND_SONG_HISTORY = false;

// Ẩn biểu đồ nhỏ trong danh sách bài hát; giữ dữ liệu để bật lại.
export const SHOW_SONG_LIST_SPARKLINES = false;
export const SHOW_MOBILE_RELEASE_YEAR_CHART = false;
const ALBUM_ALL_TIME_LIMIT = 24;
const WEB_SONG_ALL_TIME_LIMIT = 100;
const WEB_ARTIST_ALL_TIME_LIMIT = 32;
const WEB_PLAYLIST_ALL_TIME_LIMIT = 25;
const mobileTopLimit = (preference:unknown) => listDisplayLimit(false,preference);
const pebblePlaylistNameKey = (playlist:Playlist) => `name:${String(playlist.name || '').normalize('NFC').trim().toLocaleLowerCase('vi')}`;
const playlistIsPebble = (playlist:Playlist, favoriteIds?:ReadonlySet<string>|null) => favoriteIds ? favoriteIds.has(playlist.id) || favoriteIds.has(pebblePlaylistNameKey(playlist)) : !!(playlist.favorite || playlist.favourite);
type BridgeNowPlayingTrack = NowPlayingTrack & { playing?: boolean };
async function loadBridgeNowPlaying(signal?:AbortSignal):Promise<BridgeNowPlayingTrack|null> {
  const response=await fetch('http://127.0.0.1:8765/status',{signal});
  if(!response.ok)return null;
  const data=await response.json();
  const now=data?.nowPlaying || data;
  if(!now || !now.title || now.title==='Nothing playing')return null;
  return {
    title:String(now.title),
    artist:String(now.subtitle || ''),
    album:String(now.album || '') || undefined,
    persistentId:String(now.persistentID || now.persistentId || '') || undefined,
    duration_s:Number(now.duration) || undefined,
    year:Number(now.year) || undefined,
    playing:!!now.playing,
  };
}

async function controlBridge(action:string) {
  const response=await fetch('http://127.0.0.1:8765/control?action='+encodeURIComponent(action));
  if(!response.ok)throw new Error('Chưa điều khiển được iPhone.');
}

function normalizeNowPart(value?:string) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

function enrichNowPlayingFromLibrary(track:BridgeNowPlayingTrack,rows?:NowPlayingTrack[]):BridgeNowPlayingTrack {
  if(!rows?.length)return track;
  const persistentId=String(track.persistentId || '').toUpperCase();
  const title=normalizeNowPart(track.title),artist=normalizeNowPart(track.artist);
  const hit=(persistentId && rows.find(row=>String(row.persistentId || '').toUpperCase()===persistentId))
    || rows.find(row=>normalizeNowPart(row.title)===title && normalizeNowPart(row.artist)===artist && (row as Any).in_library!==0)
    || rows.find(row=>normalizeNowPart(row.title)===title && normalizeNowPart(row.artist)===artist);
  if(!hit)return track;
  return {
    ...track,
    album:hit.album || track.album,
    image:hit.image || track.image,
    libraryTrackId:hit.libraryTrackId || track.libraryTrackId,
    duration_s:track.duration_s || hit.duration_s,
    year:track.year || hit.year,
    date_added:hit.date_added || track.date_added,
    last_played:hit.last_played || track.last_played,
    my_rating:hit.my_rating ?? track.my_rating,
    plays:hit.plays ?? track.plays,
    allTimeRank:hit.allTimeRank ?? track.allTimeRank,
    allTimeChange:hit.allTimeChange ?? track.allTimeChange,
    allTimeComparison:hit.allTimeComparison || track.allTimeComparison,
  };
}

function sameNowPlayingMeta(a:NowPlayingTrack,b:NowPlayingTrack) {
  return a.album===b.album && a.image===b.image && a.libraryTrackId===b.libraryTrackId
    && a.duration_s===b.duration_s && a.year===b.year && a.date_added===b.date_added
    && a.last_played===b.last_played && a.my_rating===b.my_rating && a.plays===b.plays
    && a.allTimeRank===b.allTimeRank && a.allTimeChange===b.allTimeChange && a.allTimeComparison===b.allTimeComparison;
}

export function NowPlayingButton({c,vm,alwaysShow=false}:{c:Ctx;vm?:Any;alwaysShow?:boolean}) {
  const [track,setTrack]=useState<BridgeNowPlayingTrack|null>(null),[busy,setBusy]=useState(alwaysShow);
  const [controlBusy,setControlBusy]=useState<string>('');
  const [error,setError]=useState('');
  const controller=useRef<AbortController>();
  const notify=useRef(c.ptoast);notify.current=c.ptoast;
  const libraryRef=useRef<NowPlayingTrack[]|undefined>();libraryRef.current=vm?.nowPlayingLibrary;
  const check=useCallback(async (silent=false)=>{
    if(controller.current)return;
    const request=new AbortController();controller.current=request;setBusy(true);setError('');
    try{
      const bridge=await loadBridgeNowPlaying(request.signal).catch(()=>null);
      if(request.signal.aborted)return;
      if(bridge){
        setTrack(enrichNowPlayingFromLibrary(bridge,libraryRef.current));
      }else{
        setTrack(null);
        if(!silent)notify.current('iPhone chưa báo bài đang nghe.');
      }
    }catch(error){
      if(!request.signal.aborted){
        const message=error instanceof Error?error.message:'Chưa lấy được bài đang nghe từ iPhone.';
        setTrack(null);
        setError(message);
        if(!silent)notify.current(message);
      }
    }finally{
      if(controller.current===request){controller.current=undefined;if(!request.signal.aborted)setBusy(false);}
    }
  },[]);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible')void check(true);};
    refresh();
    const timer=setInterval(refresh,alwaysShow?15000:5000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);controller.current?.abort();controller.current=undefined;};
  },[alwaysShow,check]);
  useEffect(()=>{
    setTrack(current=>{
      if(!current)return current;
      const enriched=enrichNowPlayingFromLibrary(current,vm?.nowPlayingLibrary);
      return sameNowPlayingMeta(current,enriched)?current:enriched;
    });
  },[vm?.nowPlayingLibrary]);
  const runControl=useCallback(async(action:string)=>{
    if(controlBusy)return;
    setControlBusy(action);
    try{
      await controlBridge(action);
      await new Promise(resolve=>setTimeout(resolve,250));
      await check(true);
    }catch(error){
      notify.current(error instanceof Error?error.message:'Chưa điều khiển được iPhone.');
    }finally{
      setControlBusy('');
    }
  },[check,controlBusy]);
  if(!track&&alwaysShow)return <div className="now-playing-wrap now-playing-idle" aria-live="polite">
    <span className="now-playing-cover" aria-hidden="true">♫</span>
    <div className="now-playing-idle-copy"><span className="now-playing-label">Đang nghe · iPhone</span><strong>{busy?'Đang tải bài đang nghe…':error?'Chưa kết nối được iPhone':'Chưa có bài đang nghe'}</strong><span>{error||'Tự cập nhật khi bạn nghe nhạc.'}</span><button type="button" className="now-playing-button" disabled={busy} onClick={()=>void check(true)}>{busy?'Đang kiểm tra…':'Cập nhật'}</button></div>
  </div>;
  if(!track)return null;
  const listening=track.plays!=null && track.duration_s?fmtH(track.plays*track.duration_s/3600):undefined;
  const trackMeta=trackMetadata({...track,allHours:track.plays!=null&&track.duration_s?track.plays*track.duration_s/3600:0},vnDate());
  const duration=trackMeta.find(item=>item.title==='Độ dài bài hát')?.text;
  const row={tid:track.libraryTrackId,title:track.title,artist:track.artist,album:track.album,albumArtist:track.artist,metadata:trackMeta,
    img:track.image,metric:track.plays!=null?vn(track.plays)+' lượt':undefined,listening,shortcutActionsOnly:true,
    unmatched:!track.libraryTrackId,titleTone:ratingTone(track.my_rating || 0),allTimeRank:track.allTimeRank,allTimeChange:track.allTimeChange,allTimeComparison:track.allTimeComparison,
    onTap:track.libraryTrackId?()=>c.go('song',track.libraryTrackId!):undefined};
  return <div className="now-playing-wrap now-playing-result">
    <ShortcutTarget entity={songShortcut(row)}><div className="now-playing-card now-playing-row" onClick={row.onTap} role={row.onTap?'button':undefined} tabIndex={row.onTap?0:undefined} aria-label={track.libraryTrackId?`Mở chi tiết bài đang nghe: ${track.title}`:`Bài đang nghe: ${track.title} · ${track.artist}`}>
      <span className="now-playing-cover-wrap"><span className="now-playing-cover">{track.image?<img src={track.image} alt={`Bìa ${track.album || track.title}`} />:<span aria-hidden="true">{track.title.slice(0,2).toUpperCase()}</span>}</span><ArtworkRank rank={track.allTimeRank} change={track.allTimeChange} comparison={track.allTimeComparison}/></span>
      <span className="now-playing-details">
        <span className="now-playing-summary">
          <span className="now-playing-copy">
            <span className="now-playing-artist ell">{track.artist}</span>
            <span className="now-playing-title-line"><span className={`now-playing-title ell tone-${row.titleTone}`}>{track.title}</span>{duration&&<span className="now-playing-duration">{duration}</span>}</span>
            {track.album&&<span className="now-playing-album ell">{track.album}</span>}
          </span>
        </span>
        <MusicMetadata items={trackMeta.filter(item=>item.title!=='Độ dài bài hát')}/>
      </span>
      <span className="now-playing-controls" onClick={event=>event.stopPropagation()}>
        <NowPlayingControl label="Previous" busy={controlBusy==='previous'} onClick={()=>void runControl('previous')} icon="previous"/>
        <NowPlayingControl label={track.playing?'Pause':'Play'} busy={controlBusy==='playpause'} onClick={()=>void runControl('playpause')} icon={track.playing?'pause':'play'}/>
        <NowPlayingControl label="Next" busy={controlBusy==='next'} onClick={()=>void runControl('next')} icon="next"/>
      </span>
    </div></ShortcutTarget>
  </div>;
}

function NowPlayingControl({label,busy,onClick,icon}:{label:string;busy:boolean;onClick:()=>void;icon:'previous'|'play'|'pause'|'next'}) {
  return <button type="button" className="now-playing-control" disabled={busy} onClick={event=>{event.preventDefault();event.stopPropagation();onClick();}} aria-label={label} title={label}>
    {busy?<span aria-hidden="true">…</span>:<NowPlayingControlSvg icon={icon}/>}
  </button>;
}

function NowPlayingControlSvg({icon}:{icon:'previous'|'play'|'pause'|'next'}) {
  const paths={
    previous:<><path d="M6 5v14"/><path d="M18 5 8 12l10 7Z"/></>,
    play:<path d="M8 5v14l11-7Z"/>,
    pause:<><path d="M7 5h4v14H7z"/><path d="M13 5h4v14h-4z"/></>,
    next:<><path d="M18 5v14"/><path d="M6 5l10 7-10 7Z"/></>,
  }[icon];
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths}</svg>;
}

export function TodayScreen({ vm, c }: P) {
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <ChartCard>
        <Legend items={[{ color: "var(--c2)", label: "Trung bình" }, { color: "var(--text3)", label: "Tuần trước" }, { color: "var(--accent)", label: "Tuần này" }]} />
        <div className="readout" hidden>{vm.rd.week}</div>
        {vm.ch.week}
      </ChartCard>
      <div className="today-week-pair">
        <div className="today-week-summary today-summary-card">
          <div className="today-week-plays today-summary-plays">
            <div className="num today-summary-total">{vm.wk.plays}<span className="today-plays-unit">x</span></div>
          </div>
          <div className="today-week-sub today-summary-sub t2">{vm.wk.sub}</div>
          <div className="today-change-stack">
            <div className="today-week-change" style={{ color: vm.wk.progressCol }}>{vm.wk.progressChg.replace('so với', 'với')}</div>
            <div className="today-week-change" style={{ color: vm.wk.col }}>{vm.wk.chg.replace('so với', 'với')}</div>
          </div>
        </div>
        <div className="today-month-summary today-summary-card">
          <div className="today-month-plays today-summary-plays">
            <div className="num today-month-total today-summary-total">{vm.mo.plays}<span className="today-plays-unit">x</span></div>
          </div>
          <div className="today-month-sub today-summary-sub">{vm.mo.sub}</div>
          <div className="today-change-stack">
            <div className="today-week-change" style={{ color: vm.mo.progressCol }}>{vm.mo.progressChg.replace("so với", "với")}</div>
            <div className="today-week-change" style={{ color: vm.mo.col }}>{vm.mo.chg.replace("so với", "với")}</div>
          </div>
        </div>
      </div>
      <SecSide title="Top nghệ sĩ tuần này" side="xếp theo giờ nghe" />
      <div className="card" style={{ padding: "6px 0 4px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) repeat(7,22px) 28px", gap: 3, padding: "6px 12px", fontSize: "var(--type-caption, 11px)", fontWeight: 600, color: "var(--text3)", textAlign: "center" }}>
          <div style={{ textAlign: "left" }}>Nghệ sĩ</div>
          {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => <div key={d}>{d}</div>)}
          <div>Σ</div>
        </div>
        {vm.weekTable.map((r: Any, k: number) => (
          <ShortcutTarget key={k} entity={artistShortcut(r)}><div className="num" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) repeat(7,22px) 28px", gap: 3, padding: "9px 12px", borderTop: "0.5px solid var(--line)", fontSize: 14, textAlign: "center", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <Thumb ini={r.ini} img={r.img} round size={22} label={r.name} style={{ fontSize: 8, flexShrink: 0 }} />
              <div className="ell" style={{ fontWeight: 600 }}>{r.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 3, whiteSpace: "nowrap", fontSize: 10, fontWeight: 400 }}>
                <span>#{r.rank ?? "–"}</span>
                {r.rankChange != null && r.rankChange !== 0 && <span style={{ color: r.rankChange > 0 ? "var(--up)" : "var(--down)" }}>{r.rankChange > 0 ? "▲" : "▼"}{Math.abs(r.rankChange)}</span>}
              </div>
              <Flags hot={r.hot} cold={r.cold} />
            </div>
            {r.cells.map((cl: Any, j: number) => <div key={j} style={cl.s}>{cl.v}</div>)}
            <div style={{ fontWeight: 600 }}>{r.total}</div>
          </div></ShortcutTarget>
        ))}
      </div>

      <TodayPlaylistRanks vm={vm} c={c}/>

      <SecLink title={vm.top5Title} link="Xem tất cả" onTap={vm.viewTodaySongs} />
      {vm.top5Prev && (
        <div style={{ padding: "0 20px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          <div className="t2" style={{ fontSize: 14 }}>{vm.top5Note}</div>
          <div className="t3" style={{ fontSize: "var(--type-caption, 11px)", fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>{vm.top5Sub}</div>
        </div>
      )}
      <div className="card song-list">
        {vm.top5.map((r: Any, k: number) => <SongListRow key={k} r={r} />)}
      </div>
      {!!lastfmRows(vm.top5).length&&<LastfmScrobbleRefreshButton notify={c.ptoast} tracks={lastfmQueries(vm.top5)}/>}

      <SecLink title="Vừa nghe" link="Xem thêm" onTap={()=>c.go('recent')} />
      <RecentSongs rows={vm.recent} />
      <EndOfPage />

    </>
  );
}

export function RecentSongs({rows}:{rows:Any[]}) {
  return <div className="card song-list">{rows.map((r:Any,k:number)=><SongListRow key={k} r={r} right={
    <div className="recent-time num t3">{r.date && <span className="recent-date">{r.date}</span>}<span>{r.time}</span>{r.unmatched && <span className="outside-library-icon" role="img" aria-label="Chưa có trong thư viện" title="Chưa có trong thư viện">+</span>}</div>
  } />)}</div>;
}
export function RecentScreen({vm}:P) {
  return <><SampleChip show={vm.sampleChip} text={vm.chipText}/><Sec>25 lượt nghe gần nhất</Sec>
    {vm.recent.length ? <RecentSongs rows={vm.recent}/> : <EmptyState title="Chưa có lượt nghe" note=""/>}</>;
}

export const SongListRow = ({ r, right, hideAlbum = false, hideArtist = false, showListRank = false }: { r: Any; right?: ReactNode; hideAlbum?:boolean; hideArtist?:boolean; showListRank?:boolean }) => (
  <ShortcutTarget entity={songShortcut(r)}><div className={`row song-row ${r.rankTrendClass || ''}`} onClick={r.onTap}>
    <div className="song-artwork"><Thumb ini={r.ini || r.title?.slice(0,2) || '♫'} img={r.img} size={52} /><ArtworkRank rank={r.allTimeRank} change={r.allTimeChange} comparison={r.allTimeComparison} /></div>
    <div className="song-copy">
      {!hideArtist && <MetadataHelp item={{title:'Màu nghệ sĩ',text:r.artist}}><div className={`song-artist-line sub13 ell tone-${r.artistTone || 'gray'}`}>{showListRank && Number.isInteger(r.rank) && r.rank > 0 && <span className="song-list-number num">{r.rank}.</span>}<span className="ell">{r.artist}</span></div></MetadataHelp>}
      <SongTitle title={r.title} tone={r.titleTone} items={r.metadata} trackNumber={r.trackNumber} />
      <div className="song-album-line">
        {!hideAlbum && (r.albumDisplay || r.album) && (r.albumDisplay ? <div className="song-album ell" title={r.albumDisplay}>{r.albumDisplay}</div> : r.goAlbum ? <ShortcutTarget entity={albumShortcut({title:r.album,artist:r.albumArtist || r.artist,onTap:r.goAlbum,allTimeMetric:r.albumAllTimeMetric,allTimeListening:r.albumAllTimeListening,artistTone:r.artistTone})}><button type="button" className="song-album ell album-name-link" title={r.album} aria-label={`Mở album: ${r.album}`} onClick={e=>{e.stopPropagation();r.goAlbum();}}>{r.album}</button></ShortcutTarget> : <div className="song-album ell" title={r.album}>{r.album}</div>)}
        <MusicMetadata items={r.metadata} />
        {r.unmatched && !r.metadata?.some((m:Any)=>m.title==='Năm phát hành') && <RecentAlbumYear artist={r.artist} title={r.title} album={r.album} />}
      </div>
      {!r.metadata?.length && r.added && <div className="sub13">{r.added}</div>}
    </div>
    {right ?? ((r.gone || r.unmatched || r.in_library===0) ? <LastfmTrackMetrics artist={r.artist || ''} title={r.title || ''} trackId={r.tid} outsideLibrary={r.titleTone!=='unreleased'} addToLibrary={r.titleTone!=='unreleased'?{query:{kind:'song',artist:r.artist || '',title:r.title || '',album:r.originalAlbum || r.album,trackId:r.tid},notify:(message)=>{window.dispatchEvent(new CustomEvent('app-toast',{detail:message}));}}:undefined}/> : <SongListeningMetrics plays={r.metric || r.v} listening={r.listening} duration={r.duration_s} metadata={r.metadata} rankWeight={r.rankWeight ?? r.rank_weight} timeFirst={r.timeFirst}>
      {SHOW_SONG_LIST_SPARKLINES && r.spark}
      {SHOW_SONG_LIST_SPARKLINES && r.spark && <small>{r.sparkLabel ?? '18 tháng'}</small>}
    </SongListeningMetrics>)}
  </div></ShortcutTarget>
);

export const ArtistStatsLine = ({ r }: { r: Any }) => {
  const added = r.metadata?.filter((m: Any) => m.title === 'Thêm vào thư viện');
  const inlineAdded = !!added?.length;
  const counts = r.libraryTracks != null && r.listenedTracks != null;
  return (counts || inlineAdded || r.lastPlayed) ? <div className="artist-sub artist-stats-line num">
      {counts && <span title={`${r.listenedTracks} bài đã nghe trong kỳ / ${r.libraryTracks} bài trong thư viện`} aria-label={`${r.listenedTracks} bài đã nghe trong kỳ / ${r.libraryTracks} bài trong thư viện`}>{r.listenedTracks}/{r.libraryTracks}<span className="track-note" aria-hidden="true">♪</span></span>}
      {inlineAdded && <div className="artist-added-inline"><MusicMetadata items={added} /></div>}
      {r.lastPlayed && <span className="last-played" title={`Nghe lần cuối: ${r.lastPlayed}`} aria-label={`Nghe lần cuối: ${r.lastPlayed}`}><svg width="7.2" height="8" viewBox="0 0 9 10" aria-hidden="true"><path d="M1.5 1.5 7.5 5 1.5 8.5Z" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" /></svg>{r.lastPlayed}</span>}
    </div> : null;
};

export const ArtistListRow = ({ r, timeFirst = false }: { r: Any; timeFirst?: boolean }) => {
  const primary = r.big || r.v;
  const isPlays = (value: string) => /^[\d.,]+(?: lượt|x)$/.test(value || '');
  const swapMetrics = timeFirst ? isPlays(primary) : isPlays(r.small);
  const counts = r.libraryTracks != null && r.listenedTracks != null;
  return <ShortcutTarget entity={artistShortcut(r)}><button type="button" className="artist-tile" onClick={r.onTap}>
    <div className="artist-avatar-wrap"><Thumb ini={r.ini || r.name?.slice(0,2) || '♫'} img={r.img} round size={136} /><ArtworkRank rank={r.allTimeRank} change={r.allTimeChange} comparison={r.allTimeComparison}/></div>
    <div className="artist-title-line"><MetadataHelp item={{title:'Màu nghệ sĩ',text:r.name}}><div className={`artist-name tone-${r.titleTone || 'gray'}`}><span className="tile-rank">{r.rank}.</span> {r.name} <Flags hot={r.hot} cold={r.cold} /></div></MetadataHelp>
    </div>
    {!counts && <MusicMetadata items={r.metadata} hideAdded />}
    <ArtistStatsLine r={r} />
    {!counts && !r.lastPlayed && r.sub && <div className="artist-sub">{r.sub.replace(/nghe lần cuối\s*/, '▷')}</div>}
    <div className="tile-metrics num"><strong>{compactPlays(swapMetrics ? r.small : primary)}</strong><span>{compactPlays(swapMetrics ? primary : r.small)}</span></div>
  </button></ShortcutTarget>;
};

export function Top100Screen({ vm, c }: P) {
  const limit=WEB_SONG_ALL_TIME_LIMIT;
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <div className="ranking-tabs"><SegTabs items={vm.songViewTabs} /></div>
      {!vm.songIsHistory && <div className="ranking-month-tabs"><SegTabs items={vm.songRankMonthChips || []} scrollActive /></div>}
      {vm.songIsHistory ? <RankHistoryPanel vm={vm} /> : <>
      {vm.songFilterNote && <div className="note">{vm.songFilterNote}</div>}
      <RankFocus c={c} rows={vm.top100Rows} kind="song" />
      <div className="card web-song-grid" style={{ marginTop: 10 }}>
        {vm.top100Rows.slice(0,limit).map((r: Any, k: number) => (
          <RisingRow key={k} r={r} showListRank />
        ))}
      </div>
      {!!lastfmRows(vm.top100Rows.slice(0,limit)).length&&<LastfmScrobbleRefreshButton notify={c.ptoast} tracks={lastfmQueries(vm.top100Rows.slice(0,limit))}/>}
      </>}
    </>
  );
}

export function ArtistsAllScreen({ vm, c }: P) {
  const limit=DESKTOP_WEB ? WEB_ARTIST_ALL_TIME_LIMIT : mobileTopLimit(c?.p?.periodListSize);
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <div className="ranking-tabs"><SegTabs items={vm.sortChips} /></div>
      {!vm.artistIsHistory && <div className="ranking-month-tabs"><SegTabs items={vm.artistRankMonthChips || []} scrollActive /></div>}
      {vm.artistIsHistory ? <RankHistoryPanel vm={vm} /> : <>
      {vm.artistFilterNote && <div className="note">{vm.artistFilterNote}</div>}
      <RankFocus c={c} rows={vm.artistRows} kind="artist" />
      {!vm.artistRows.length && <EmptyState title="Chưa có nghệ sĩ phù hợp" note=""/>}
      <div className="artist-grid" style={{ marginTop: 12 }}>
        {vm.artistRows.slice(0,limit).map((r: Any, k: number) => (
          <ArtistListRow key={k} r={r} timeFirst />
        ))}
      </div>
      {vm.sortPts && <div className="note" style={{ paddingTop: 6 }}>Chỉ 30 nghệ sĩ trong nhóm chấm điểm có điểm. Nghệ sĩ khác hiện “–” và không có trong danh sách này.</div>}
      </>}
    </>
  );
}

// Dùng cùng cover và metadata với các danh sách bài hát khác.
export const RisingRow = ({ r, showListRank = false }: { r: Any; showListRank?: boolean }) => r.gone ? <SongListRow r={r} showListRank={showListRank}/> : (
  <SongListRow r={r} showListRank={showListRank} right={
    <div className={`rising-song-metrics tone-${r.titleTone || 'gray'}`}>
      <SongListeningMetrics plays={r.metric || r.v} listening={r.listening} duration={r.duration_s} metadata={r.metadata} rankWeight={r.rankWeight ?? r.rank_weight} timeFirst={r.timeFirst} inline/>
      <div className="rising-song-chart">{r.spark}</div>
      {r.hideRankProgress ? <div className="song-rank-progress num is-empty" aria-hidden="true">&nbsp;</div> : r.monthRankCurrent != null ? <div className="song-rank-progress num" aria-label={`Hạng ${r.monthRankPreviousPeriod}: #${r.monthRankPrevious ?? '–'}; hạng ${r.monthRankCurrentPeriod}: #${r.monthRankCurrent}${r.monthRankPrevious ? `; thay đổi ${r.monthRankPrevious-r.monthRankCurrent} bậc` : ''}`}>
        {r.monthRankPrevious != null && <><strong className="t3">{r.monthRankPrevious}</strong><span className={r.monthRankPrevious-r.monthRankCurrent >= 0 ? "rank-up" : "rank-down"} aria-hidden="true">▶</span></>}<strong className={r.monthRankPrevious == null ? "t3" : r.monthRankPrevious-r.monthRankCurrent >= 0 ? "rank-up" : "rank-down"}>{r.monthRankCurrent}</strong>
      </div> : r.risingRank != null ? <div className="song-rank-progress num" aria-label={`Hạng cuối ${r.risingPreviousPeriod}: #${r.risingPreviousRank ?? '–'}; hạng trong tháng này: #${r.risingRank}${r.risingPreviousRank ? `; tăng ${r.risingPreviousRank-r.risingRank} bậc` : ''}`}>
        {r.risingPreviousRank != null && <><strong className="t3">{r.risingPreviousRank}</strong><span className={r.risingPreviousRank-r.risingRank >= 0 ? "rank-up" : "rank-down"} aria-hidden="true">▶</span></>}<strong className={r.risingPreviousRank == null ? "t3" : r.risingPreviousRank-r.risingRank >= 0 ? "rank-up" : "rank-down"}>{r.risingRank}</strong>
      </div> : <SongRankProgress best={r.allTimeBestRank} previous={r.allTimePreviousRank} current={r.allTimeRank} previousPeriod={r.allTimePreviousPeriod}/>} 
    </div>
  } />
);

export function RisingSongGroups({ vm, rows }: { vm: Any; rows: Any[] }) {
  const groups = vm.risingGroups || (rows.length ? [{ month: "T09/26", rows }] : []);
  return <div className="rising-song-groups" style={{ margin: "0 16px", display: "flex", flexDirection: "column", gap: 12 }}>
    {groups.map((g: Any) => <div className="rising-song-month" key={g.month} style={{ borderRadius: 16, overflow: "hidden" }}>
      <RisingMonthHeader group={g}/>
      {g.rows.map((r: Any, k: number) => <RisingRow key={r.tid || k} r={r}/>)}
    </div>)}
    {!groups.length && <EmptyState title="Chưa có bài phù hợp" note="Chỉ hiện bài tăng hạng và có lượt nghe trong tháng tương ứng."/>}
  </div>;
}

export const RisingArtistRow = ({ r }: { r: Any }) => {
  const [previous,current]=String(r.ranks || '').split(' → ').map((rank:string)=>rank.replace(/#/g,''));
  const [plays,listening]=String(r.sub || '').split(' · ');
  return <ShortcutTarget entity={artistShortcut(r)}><div className="row rising-artist-row" onClick={r.onTap} style={{ display: "grid", gridTemplateColumns: "36px minmax(0,1fr) auto", columnGap: 10, padding: "10px 14px", alignItems: "center" }}>
    <Thumb ini={r.ini} img={r.img} round size={36} style={{ fontSize: "var(--type-caption, 10px)" }} />
    <div className="rising-artist-copy">
      <div className="rising-artist-title-line">
        <div className="title15 ell">{r.name}</div>
        <Flags hot={r.hot} cold={r.cold} />
      </div>
      <div className="artist-row-details rising-artist-date"><ArtistStatsLine r={r} /></div>
      <div className="song-metrics num song-metrics-inline rising-artist-metric"><strong>{plays}</strong>{listening && <span>{listening}</span>}</div>
    </div>
    <div style={{ textAlign: "right" }}>
      <div className="num" style={{ fontSize: 15, fontWeight: 700, color: "var(--up)", whiteSpace: "nowrap" }}><span style={{ color: "var(--text3)" }}>{previous}</span><span aria-hidden="true" style={{ fontSize: 9, margin: '0 3px', verticalAlign: 'middle' }}>▶</span>{current}</div>
      <div className="t3" style={{ fontSize: "var(--type-caption, 10px)" }}>All time{r.rise > 0 && <span className="num" style={{ color: "var(--up)", marginLeft: 5 }}>▲{r.rise}</span>}</div>
    </div>
  </div></ShortcutTarget>;
};

function RisingMonthHeader({group}:{group:Any}) {
  return <div style={{ minHeight: 38, padding: "4px 8px 2px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: "var(--type-caption, 11px)", fontWeight: 600, letterSpacing: 0.5, color: "var(--text2)" }}>
    <span>{group.month}</span>
    {group.onViewAll && <button type="button" onClick={group.onViewAll} style={{ border: 0, background: "transparent", color: "var(--accent)", font: "inherit", letterSpacing: 0, padding: "7px 6px", cursor: "pointer" }}>Xem tất cả</button>}
  </div>;
}

export function RisingArtistGroups({groups,emptyNote}:{groups:Any[];emptyNote:string}) {
  return <div className="rising-artist-groups" style={{ margin: "0 16px", display: "flex", flexDirection: "column", gap: 12 }}>
    {groups.map((g:Any)=><div className="rising-artist-month" key={g.month} style={{ borderRadius: 16, overflow: "hidden" }}>
      <RisingMonthHeader group={g}/>
      {g.rows.map((r:Any,j:number)=><RisingArtistRow key={r.an || j} r={r}/>)}
    </div>)}
    {!groups.length && <EmptyState title="Chưa có nghệ sĩ phù hợp" note={emptyNote}/>}
  </div>;
}

export function RisingScreen({ vm }: P) {
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <div className="t2 pretty" style={{ padding: "16px 20px 10px", fontSize: 13 }}>{vm.risingHead}</div>
      <RisingSongGroups vm={vm} rows={vm.risingAll}/>
    </>
  );
}

export function TrendScreen({ vm, c }: P) {
  if (c.p.trendMode !== "rising") {
    return (
      <>
        <ScopeTabs items={vm.trendTabs} />
        {(c.p.trendMode === "Tháng" || c.p.trendMode === "Tháng trước") && <div className="ranking-month-tabs"><SegTabs items={vm.trendMonthChips || []} scrollActive /></div>}
        <OverviewScreen vm={vm} c={c} hideScopeTabs />
      </>
    );
  }
  return (
    <>
      <ScopeTabs items={vm.trendTabs} />
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <Sec>Nghệ sĩ đang lên</Sec>
      <RisingArtistGroups groups={vm.risingArtists} emptyNote="Chỉ hiện nghệ sĩ tăng hạng trong tháng tương ứng."/>

      <Sec>Bài đang lên hạng</Sec>
      <RisingSongGroups vm={vm} rows={vm.rising}/>

      {SHOW_TREND_SONG_HISTORY && <>
        <Sec>Top 10 bài · 12 tháng</Sec>
        <div className="card chart-surface" style={{ padding: "14px 12px 10px", overflow: "visible" }}>{vm.bumpEl}</div>
      </>}
    </>
  );
}

export function OverviewScreen({ vm, c, hideScopeTabs = false }: P & { hideScopeTabs?: boolean }) {
  return (
    <div className="overview-layout">
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      {!hideScopeTabs && c.screen !== "overview" && <ScopeTabs items={vm.scopeChips} />}
      {!vm.monthSummary && <div className="overview-stats-grid" style={{ margin: "10px 16px 0", display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 8 }}>
        {vm.stats.map((s: Any, k: number) => (
          <div key={k} style={{ gridColumn: `span ${s.span}`, minWidth: 0 }}>
            <div style={{ background: "var(--surface)", borderRadius: 14, padding: 12 }}>
              <div className="num" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: "var(--type-caption, 12px)", color: "var(--text2)", marginTop: 4 }}>{s.l}</div>
            </div>
          </div>
        ))}
      </div>}
      {vm.monthSummary && <MonthSummaryCard summary={vm.monthSummary}/>}

      {!vm.isMonth && <div className="overview-time-charts">
        <section>
          <Sec>Lượt nghe theo tháng</Sec>
          <ChartCard readout={vm.rd.month}>
            {vm.ch.month}
          </ChartCard>
        </section>
        <section>
          <SecSide title="Giờ nghe theo tháng" side="tất cả nghệ sĩ" />
          <ChartCard readout={<MonthlySummaryReadout value={vm.rd.hours} c={c} months={vm.periodOptions?.hours} onMonthSelect={index => c.set(q => ({ sel: { ...q.sel, hours: index } }))}/>}>{vm.ch.hours}</ChartCard>
        </section>
      </div>}

      {vm.isMonth && (
        <>
          <Sec>{vm.dayTitle}</Sec>
          {vm.monthEmpty ? (
            <div className="card">
              <EmptyState iconOnly title="Chưa có lượt nghe" note="" />
            </div>
          ) : (
            <div className="overview-month-charts">
              <div className="overview-month-main-charts">
                <ChartCard readout={<><strong className="overview-card-title">Theo ngày</strong><span className="overview-card-sub">{vm.rd.day}</span></>}>{vm.ch.day}</ChartCard>
                {!!vm.monthWeeks?.length && <ChartCard readout={<strong className="overview-card-title">Theo tuần</strong>} style={{ marginTop: 14 }}><MonthWeeksChart key={vm.dayTitle} weeks={vm.monthWeeks} /></ChartCard>}
              </div>
              <div className="overview-chart-pair">
                {[["Theo thứ", vm.rd.wd, vm.ch.wd], ["Theo giờ", vm.rd.hr, vm.ch.hr]].map(([t, rdv, chv]: Any) => (
                  <div key={t} className="overview-chart-small">
                    <div style={{ fontSize: 13, fontWeight: 600, margin: "0 2px 2px" }}>{t}</div>
                    <div className="overview-chart-readout num t2" aria-live="polite">{rdv}</div>
                    <div className="overview-chart-plot">{chv}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <SecLink title={vm.topArtistsTitle} link="Xem tất cả" onTap={vm.viewArtists} />
      <div className="artist-grid">
        {!vm.hourArtists.length && <EmptyState iconOnly title="Chưa có kết quả" note="" />}
        {vm.hourArtists.map((r: Any, k: number) => <ArtistListRow key={k} r={r} timeFirst />)}
      </div>

      {vm.isAll && SHOW_OVERVIEW_ARTIST_POINTS && (
        <>
          <SecSide title="Nghệ sĩ theo điểm" side="chạm để xem 8 thành phần" anchor="points" />
          <div className="card">
            {vm.scoreRows.map((r: Any, k: number) => (
              <div key={k} style={{ borderTop: k ? "0.5px solid var(--line)" : 0 }}>
                <div onClick={r.onTap} style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr) 44px", gap: 10, alignItems: "center", padding: "10px 14px", cursor: "pointer" }}>
                  <div className="rank-sm">{r.rank}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                      <div className="ell" style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</div>
                      <Flags hot={r.hot} cold={r.cold} />
                    </div>
                    {r.bar}
                  </div>
                  <div className="num" style={{ fontSize: 15, fontWeight: 700, textAlign: "right" }}>{r.score}</div>
                </div>
                {r.open && <div style={{ padding: "0 14px 12px 42px" }}><PartRows parts={r.parts} /></div>}
              </div>
            ))}
          </div>
          <div className="note pretty">Điểm là tổng 8 phần, không có trần, tính theo All time cho 30 nghệ sĩ trong nhóm chấm điểm.</div>
        </>
      )}

      <SecLink title={vm.topAlbumsTitle} link="Xem tất cả" onTap={vm.viewAlbums} />
      {vm.albums.length ? <AlbumGrid albums={vm.albums}/> : <EmptyState iconOnly title="Chưa có kết quả" note=""/>}

      <SecLink title={vm.topSongsTitle} link="Xem tất cả" onTap={vm.viewSongs} />
      <div className="card song-list">
        {!vm.top15.length && <EmptyState iconOnly title="Chưa có kết quả" note="" />}
        {vm.top15.map((r: Any, k: number) => <SongListRow key={k} r={r} />)}
      </div>
      {!!lastfmRows(vm.top15).length&&<LastfmScrobbleRefreshButton notify={c.ptoast} tracks={lastfmQueries(vm.top15)}/>}

      <TopPlaylistsOverview vm={vm} c={c} />

      <Sec>{vm.topGenresTitle}</Sec>
      <div className="card" style={{ padding: "6px 14px 10px" }}>
        {!vm.genres.length && <EmptyState iconOnly title="Chưa có kết quả" note=""/>}
        {vm.genres.map((r: Any, k: number) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "6px 0" }}>
            <div style={{ minWidth: 0 }}>
              <div className="ell" style={{ fontSize: 13, fontWeight: 600 }}>{r.name?.toLocaleUpperCase("vi")}</div>
              {r.detail && <div className="sub13">{r.detail}</div>}
              {r.bar}
            </div>
            <div className="num t2" style={{ fontSize: "var(--type-caption, 12px)", textAlign: "right" }}>{compactPlays(r.v)}</div>
          </div>
        ))}
      </div>

      {vm.isAll && SHOW_MOBILE_RELEASE_YEAR_CHART && <>
      <div className="sec pretty">Bài thêm vào thư viện theo năm phát hành</div>
      <ChartCard readout={vm.rd.area} style={{ padding: 12 }}>
        {vm.ch.area}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "5px 10px", marginTop: 10 }}>
          {vm.areaLegend.map((g: Any, k: number) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--type-caption, 11px)", color: "var(--text2)", minWidth: 0 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: g.color, flex: "none" }} />
              <div className="ell">{g.name}</div>
            </div>
          ))}
        </div>
      </ChartCard>
      </>}
    </div>
  );
}

function usePlaylistRankRows(vm:VM, enabled:boolean, limit:number, saveHistory=false, periodRows?:Any[]) {
  const [snapshot,setSnapshot]=useState<PlaylistSnapshot|null>(null);
  const [failed,setFailed]=useState(false);
  const [rankExcludes,setRankExcludes]=useState(()=>readPlaylistRankExcludes());
  const [keywordsVersion,setKeywordsVersion]=useState(0);
  useEffect(()=>{
    const sync=()=>setRankExcludes(readPlaylistRankExcludes());
    window.addEventListener(PLAYLIST_RANK_EXCLUDES_EVENT,sync);
    window.addEventListener('storage',sync);
    return()=>{window.removeEventListener(PLAYLIST_RANK_EXCLUDES_EVENT,sync);window.removeEventListener('storage',sync);};
  },[]);
  useEffect(()=>{
    const sync=()=>{invalidatePlaylistSnapshot();setKeywordsVersion(n=>n+1);};
    window.addEventListener(PLAYLIST_KEYWORDS_EVENT,sync);
    window.addEventListener('storage',sync);
    void syncPlaylistRankingSettings();
    return()=>{window.removeEventListener(PLAYLIST_KEYWORDS_EVENT,sync);window.removeEventListener('storage',sync);};
  },[]);
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    setFailed(false);
    loadPlaylistSnapshot()
      .then(data=>{if(active)setSnapshot(data);})
      .catch(()=>{if(active)setFailed(true);});
    return()=>{active=false;};
  },[enabled,keywordsVersion]);
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    const refresh=()=>void loadPlaylistSnapshot().then(data=>{if(active)setSnapshot(data);}).catch(()=>{});
    window.addEventListener(PLAYLIST_SNAPSHOT_EVENT,refresh);
    return()=>{active=false;window.removeEventListener(PLAYLIST_SNAPSHOT_EVENT,refresh);};
  },[enabled]);
  const rankLibrary=vm.nowPlayingLibrary?.length ? vm.nowPlayingLibrary : vm.playlistLibrary;
  const rows=useMemo(()=>enabled
    ? periodRows === undefined
      ? buildPlaylistRankRows(snapshot,rankLibrary,limit,rankExcludes,saveHistory)
      : buildPlaylistPeriodRows(snapshot,rankLibrary,periodRows,limit,rankExcludes)
    : [],[snapshot,enabled,rankLibrary,limit,rankExcludes,saveHistory,periodRows]);
  const exclude=(row:PlaylistRankRow|Playlist)=>setRankExcludes(addPlaylistRankExclude(row));
  return {rows,failed,exclude,snapshot};
}

function PlaylistRankGrid({rows,c,failed,snapshot,onExclude,emptyTitle}:{rows:PlaylistRankRow[];c:Ctx;failed:boolean;snapshot:PlaylistSnapshot|null;onExclude:(row:PlaylistRankRow|Playlist)=>void;emptyTitle?:string}) {
  const [menu,setMenu]=useState<Playlist|null>(null);
  const [favoriteIds,setFavoriteIds]=useState<Set<string>|null>(null);
  const playlistById=useMemo(()=>new Map((snapshot?.playlists||[]).map(playlist=>[playlist.id,playlist])),[snapshot]);
  useEffect(()=>{
    if(!snapshot)return;
    let active=true;
    const fallback=new Set(snapshot.playlists.filter(playlist=>playlistIsPebble(playlist,null)).map(playlist=>playlist.id));
    setFavoriteIds(fallback);
    loadPebblePlaylistFavoriteIdsInNativeApp().then(ids=>{if(active&&ids)setFavoriteIds(ids);}).catch(()=>{});
    return()=>{active=false;};
  },[snapshot]);
  const setPebbleFavorite=(playlist:Playlist, enabled:boolean)=>{
    setFavoriteIds(current=>{
      const next=new Set(current || snapshot?.playlists.filter(item=>playlistIsPebble(item,null)).map(item=>item.id) || []);
      if(enabled){next.add(playlist.id);next.add(pebblePlaylistNameKey(playlist));}
      else {next.delete(playlist.id);next.delete(pebblePlaylistNameKey(playlist));}
      return next;
    });
  };
  const openMenu=(row:PlaylistRankRow)=>{
    const playlist=playlistById.get(row.id);
    if(playlist)setMenu(playlist);
  };
  return <>
    <div className="playlist-grid overview-playlist-grid">
      {!rows.length && <EmptyState iconOnly title={failed?'Chưa tải được playlist':snapshot?emptyTitle || 'Chưa có playlist phù hợp':'Đang tải playlist…'} note=""/>}
      {rows.map(r=><PlaylistRankTile key={r.id} row={r} c={c} pebble={playlistById.has(r.id) && playlistIsPebble(playlistById.get(r.id)!,favoriteIds)} menu={()=>openMenu(r)}/>) }
    </div>
    {menu&&<TopPlaylistActionMenu playlist={menu} pebble={playlistIsPebble(menu,favoriteIds)} c={c} close={()=>setMenu(null)} onPebbleChange={enabled=>setPebbleFavorite(menu,enabled)} onExclude={()=>{onExclude(menu);c.ptoast('Đã exclude playlist khỏi ranking.');setMenu(null);}}/>}
  </>;
}

function TodayPlaylistRanks({vm,c}:P) {
  const {rows,failed,exclude,snapshot}=usePlaylistRankRows(vm,true,4,false,vm.todayPlaylistRows || []);
  return <>
    <Sec>Top playlist · 15 ngày</Sec>
    <PlaylistRankGrid rows={rows} c={c} failed={failed} snapshot={snapshot} onExclude={exclude} emptyTitle="Chưa có playlist được nghe trong 15 ngày"/>
  </>;
}

export function NativeWidgetPlaylistPublisher({vm}:{vm:VM}) {
  const {rows,snapshot}=usePlaylistRankRows(vm,true,4,false,vm.todayPlaylistRows || []);
  useEffect(()=>{
    if(!snapshot || !Array.isArray(vm.todayPlaylistRows) || !rows.length)return;
    const playlistById=new Map(snapshot.playlists.map(playlist=>[playlist.id,playlist]));
    void publishWidgetTopPlaylistsInNativeApp(rows.slice(0,4).map(row=>{
      const playlist=playlistById.get(row.id);
      return {
        id:row.id,
        name:row.name,
        path:playlist?.path || playlist?.folder || '',
        rank:row.rank,
        plays:Math.max(0,Math.round(row.score)),
        trackCount:row.trackCount,
        hue:row.hue,
      };
    }));
  },[rows,snapshot,vm.todayPlaylistRows]);
  return null;
}
function PlaylistRankTile({row:r,c,pebble,menu}:{row:PlaylistRankRow;c:Ctx;pebble:boolean;menu:()=>void}) {
  const gesture=useRef<ReturnType<typeof longPress>>();
  const tapTimer=useRef<ReturnType<typeof setTimeout>>();
  const latest=useRef(menu);latest.current=menu;
  if(!gesture.current)gesture.current=longPress(()=>latest.current());
  useEffect(()=>()=>{gesture.current?.cancel();clearTimeout(tapTimer.current);},[]);
  return <button type="button" className={'playlist-tile overview-playlist-tile has-rank'+(pebble?' pebble-favorite':'')} onClick={event=>{
    if(event.detail===0){c.go('playlist',r.id);return;}
    if(event.detail>=2){clearTimeout(tapTimer.current);tapTimer.current=undefined;c.go('playlist',r.id);return;}
    clearTimeout(tapTimer.current);
    tapTimer.current=setTimeout(()=>{tapTimer.current=undefined;latest.current();},300);
  }} style={{background:`hsl(${r.hue} 26% 14%)`,borderColor:`hsl(${r.hue} 22% 24%)`}} title={`${r.name}
${r.explanation}`} aria-label={`${r.rank}. ${r.name}${r.change?r.change>0?`; tăng ${r.change} bậc so với best trước đó #${r.bestRank}${r.comparison?' '+r.comparison:''}`:`; giảm ${Math.abs(r.change)} bậc so với best trước đó #${r.bestRank}${r.comparison?' '+r.comparison:''}`:''}. ${r.explanation}`}
    onPointerDown={e=>{if(!e.isPrimary||e.button!==0){gesture.current!.cancel();return;}gesture.current!.start(e.clientX,e.clientY);}}
    onPointerMove={e=>gesture.current!.move(e.clientX,e.clientY)}
    onPointerUp={()=>gesture.current!.end()}
    onPointerCancel={()=>gesture.current!.cancel()}
    onPointerLeave={()=>gesture.current!.cancel()}
    onClickCapture={e=>{if(gesture.current!.consumeClick()){e.preventDefault();e.stopPropagation();}}}
    onContextMenu={e=>{e.preventDefault();e.stopPropagation();gesture.current!.blockClick();menu();}}>
    <span className={'playlist-rank-badge num'+(r.change?' with-change':'')} aria-hidden="true"><span>{r.rank}</span>{r.change&&<span className={'playlist-rank-change '+(r.change>0?'up':'down')}>{r.change>0?'▲':'▼'}<strong>{Math.abs(r.change)}</strong></span>}</span>
    <span className="playlist-tile-name">{r.name.split('_').map((part,i)=><span key={i}>{i>0&&<>_<wbr/></>}{part}</span>)}</span>
    <div className="playlist-rank-meta">
      <MusicMetadata items={r.metadata.slice(0,3)}/>
      <MusicMetadata items={r.metadata.slice(3)}/>
    </div>
  </button>;
}

function TopPlaylistActionMenu({playlist,pebble,c,close:onDismiss,onPebbleChange,onExclude}:{playlist:Playlist;pebble:boolean;c:Ctx;close:()=>void;onPebbleChange:(enabled:boolean)=>void;onExclude:()=>void}) {
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

function TopPlaylistsOverview({vm,c}:P) {
  const {rows,failed,exclude,snapshot}=usePlaylistRankRows(vm,vm.isAll,12,false);
  if(!vm.isAll)return null;
  return <>
    <SecLink title="Top 12 Playlists All time" link="Xem tất cả" onTap={()=>c.go('topPlaylists')} />
    <PlaylistRankGrid rows={rows} c={c} failed={failed} snapshot={snapshot} onExclude={exclude}/>
  </>;
}

export function TopPlaylistsScreen({vm,c}:P) {
  const limit=DESKTOP_WEB ? WEB_PLAYLIST_ALL_TIME_LIMIT : mobileTopLimit(c?.p?.periodListSize);
  const {rows,failed,exclude,snapshot}=usePlaylistRankRows(vm,true,limit,true);
  return <>
    <Sec>{`Top ${limit} Playlists All time`}</Sec>
    <PlaylistRankGrid rows={rows} c={c} failed={failed} snapshot={snapshot} onExclude={exclude}/>
  </>;
}

function RankHistoryPanel({ vm }: { vm: VM }) {
  return <>
    <Sec>{vm.rankHistoryTitle}</Sec>
    {vm.rankHistoryChart && <div className="card chart-surface rank-history-chart" style={{ padding: "14px 12px 10px" }}>{!!vm.rankHistoryLabels?.length && <div className="rank-history-axis"><div>{vm.rankHistoryLabels.map((label:string,i:number,labels:string[]) => (i % Math.ceil(labels.length/9) === 0 || i === labels.length-1) && <span key={i} style={{left:`${i/Math.max(1,labels.length-1)*100}%`}}>{label}</span>)}</div></div>}{vm.rankHistoryChart}</div>}
    <div className="note">{vm.rankHistoryNote}</div>
  </>;
}

export function PeriodTopScreen({ vm, c }: P) {
  if(vm.periodIsAlbums){
    const limit=vm.periodAllTime ? (DESKTOP_WEB ? ALBUM_ALL_TIME_LIMIT : mobileTopLimit(c?.p?.periodListSize)) : listDisplayLimit(vm.periodAllTime,c?.p?.periodListSize);
    return <><div className="ranking-tabs"><SegTabs items={vm.albumSortChips || []}/></div>
      {vm.periodAllTime && !vm.albumIsHistory && <div className="ranking-month-tabs"><SegTabs items={vm.albumRankMonthChips || []} scrollActive /></div>}
      {vm.albumIsHistory ? <RankHistoryPanel vm={vm}/> : <>
      {vm.albums.length ? <AlbumGrid albums={vm.albums.slice(0,limit)} showRank hideArtist/> : <EmptyState title="Chưa có album phù hợp" note=""/>}
      </>}
    </>;
  }
  return <>
    <SampleChip show={vm.sampleChip} text={vm.chipText} />
    {vm.periodIsArtists ? <div className="period-top-tabs ranking-tabs"><SegTabs items={vm.periodSortChips} /></div> : !vm.periodListOnly && <div className="ranking-tabs"><SegTabs items={vm.songViewTabs} /></div>}
    {vm.periodIsHistory ? <RankHistoryPanel vm={vm} /> : <>
    {vm.periodRisingNote && <div className="note">{vm.periodRisingNote}</div>}
    {vm.periodIsArtists && vm.periodRisingNote ? <RisingArtistGroups groups={(vm.periodRisingGroups || []).map((g:Any)=>({...g,rows:g.rows.slice(0,listDisplayLimit(false,c?.p?.periodListSize))}))} emptyNote={vm.periodEmpty}/>
    : <div className={vm.periodIsArtists ? "artist-grid" : "card song-list"} style={{ marginTop: 12 }}>
      {!vm.periodRows.length && <EmptyState title="Chưa có kết quả" note={vm.periodEmpty} />}
      {vm.periodRows.slice(0,listDisplayLimit(false,c?.p?.periodListSize)).map((r: Any, k: number) => vm.periodIsArtists
        ? <ArtistListRow key={k} r={r} timeFirst={c.p.periodSort !== "Lượt" && c.p.periodSort !== "Điểm All time"} />
        : r.risingRank != null ? <RisingRow key={k} r={r} showListRank/> : <SongListRow key={k} r={r} showListRank />)}
    </div>}
    {!vm.periodIsArtists&&!!lastfmRows(vm.periodRows.slice(0,listDisplayLimit(false,c?.p?.periodListSize))).length&&<LastfmScrobbleRefreshButton notify={c.ptoast} tracks={lastfmQueries(vm.periodRows.slice(0,listDisplayLimit(false,c?.p?.periodListSize)))}/>}
    {vm.periodIsArtists && !vm.periodRisingNote && <div className="note">* đang nghe nhiều · !!! top 10 từ 04/2024 nhưng gần đây ít nghe</div>}
    </>}
  </>;
}
