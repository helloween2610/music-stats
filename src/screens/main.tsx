import {MetadataHelp} from '@/components/metadata-help';
import { SongListeningMetrics } from '@/components/song-listening-metrics';
import { SongRankProgress } from '@/components/song-rank-progress';
import { LastfmTrackMetrics } from '@/components/lastfm-track-metrics';
import { ShortcutTarget, songShortcut, artistShortcut, albumShortcut, RankFocus } from '@/components/shortcuts';
import { AlbumGrid } from '@/components/album-grid';
import {listDisplayLimit} from "@/lib/list-preferences";
import { ArtworkRank } from '@/components/artwork-rank';
// Các màn của 4 tab đầu + trang con của Xếp hạng.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RecentAlbumYear } from '@/components/recent-album-year';
import { Ctx, VM } from "@/vm";
import { MusicMetadata, SongTitle, compactPlays } from "@/components/music-metadata";
import { MonthWeeksChart } from "@/lib/month-weeks";
import { ChartCard, Chips, EmptyState, Flags, Legend, PartRows, SampleChip, ScopeTabs, Sec, SecLink, SecSide, SegTabs, Thumb } from "@/components/ui";
import { loadNowPlaying, vnDate, type NowPlayingTrack } from '@/lib/discovery';
import { fmtH, vn } from '@/lib/fmt';
import { ratingTone, trackMetadata } from '@/lib/metadata';

type P = { vm: VM; c: Ctx };
type Any = any;

// Tạm ẩn mọi nút Chia sẻ (bật lại: true).
export const SHOW_SHARE = false;

// Tạm ẩn mục Nghệ sĩ theo điểm trên trang Thống kê.
export const SHOW_OVERVIEW_ARTIST_POINTS = false;

// Tạm ẩn biểu đồ Top 10 bài trên trang Diễn biến.
export const SHOW_TREND_SONG_HISTORY = false;

// Ẩn biểu đồ nhỏ trong danh sách bài hát; giữ dữ liệu để bật lại.
export const SHOW_SONG_LIST_SPARKLINES = false;

export function NowPlayingButton({c,alwaysShow=false}:{c:Ctx;alwaysShow?:boolean}) {
  const [track,setTrack]=useState<NowPlayingTrack|null>(null),[busy,setBusy]=useState(alwaysShow);
  const [error,setError]=useState('');
  const controller=useRef<AbortController>();
  const notify=useRef(c.ptoast);notify.current=c.ptoast;
  const check=useCallback(async (silent=false)=>{
    if(controller.current)return;
    const request=new AbortController();controller.current=request;setBusy(true);setError('');
    try{
      const result=await loadNowPlaying(request.signal);
      if(request.signal.aborted)return;
      setTrack(result);
      if(!result&&!silent)notify.current('Last.fm chưa báo bài đang nghe.');
    }catch(error){
      if(!request.signal.aborted){
        const message=error instanceof Error?error.message:'Chưa lấy được bài đang nghe.';
        setError(message);setTrack(null);
        if(!silent)notify.current(message);
      }
    }finally{
      if(controller.current===request){controller.current=undefined;if(!request.signal.aborted)setBusy(false);}
    }
  },[]);
  useEffect(()=>{
    if(!alwaysShow)return()=>controller.current?.abort();
    const refresh=()=>{if(document.visibilityState==='visible')void check(true);};
    refresh();
    const timer=setInterval(refresh,60000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);controller.current?.abort();controller.current=undefined;};
  },[alwaysShow,check]);
  if(!track&&alwaysShow)return <div className="now-playing-wrap now-playing-idle" aria-live="polite">
    <span className="now-playing-cover" aria-hidden="true">♫</span>
    <div className="now-playing-idle-copy"><span className="now-playing-label">Đang nghe · Last.fm</span><strong>{busy?'Đang tải bài đang nghe…':error?'Chưa kết nối được Last.fm':'Chưa có bài đang nghe'}</strong><span>{error||'Tự cập nhật khi bạn nghe nhạc.'}</span><button type="button" className="now-playing-button" disabled={busy} onClick={()=>void check(true)}>{busy?'Đang kiểm tra…':'Cập nhật'}</button></div>
  </div>;
  if(!track)return <div className="now-playing-wrap"><button type="button" className="now-playing-button" disabled={busy} onClick={()=>void check()} aria-label="Lấy bài đang nghe từ Last.fm">
    <span className="now-playing-note" aria-hidden="true">♫</span><span>{busy?'Đang kiểm tra Last.fm…':'Đang nghe'}</span>
  </button></div>;
  const listening=track.plays!=null && track.duration_s?fmtH(track.plays*track.duration_s/3600):undefined;
  const trackMeta=trackMetadata({...track,allHours:track.plays!=null&&track.duration_s?track.plays*track.duration_s/3600:0},vnDate());
  const duration=trackMeta.find(item=>item.title==='Độ dài bài hát')?.text;
  const row={tid:track.libraryTrackId,title:track.title,artist:track.artist,album:track.album,albumArtist:track.artist,metadata:trackMeta,
    img:track.image,metric:track.plays!=null?vn(track.plays)+' lượt':undefined,listening,shortcutActionsOnly:true,
    unmatched:!track.libraryTrackId,titleTone:ratingTone(track.my_rating || 0),onTap:track.libraryTrackId?()=>c.go('song',track.libraryTrackId!):undefined};
  return <div className="now-playing-wrap now-playing-result">
    <ShortcutTarget entity={songShortcut(row)}><button type="button" className="now-playing-card" onClick={row.onTap} aria-label={track.libraryTrackId?`Mở chi tiết bài đang nghe: ${track.title}`:`Bài đang nghe: ${track.title} · ${track.artist}`}>
      <span className="now-playing-cover">{track.image?<img src={track.image} alt={`Bìa ${track.album || track.title}`} />:<span aria-hidden="true">{track.title.slice(0,2).toUpperCase()}</span>}</span>
      <span className="now-playing-details">
        <span className="now-playing-summary">
          <span className="now-playing-copy">
            <span className="now-playing-label">Đang nghe · Last.fm</span>
            <span className="now-playing-title-line"><span className={`now-playing-title ell tone-${row.titleTone}`}>{track.title}</span>{duration&&<span className="now-playing-duration">{duration}</span>}</span>
            <span className="now-playing-artist ell">{track.artist}</span>
            {track.album&&<span className="now-playing-album ell">{track.album}</span>}
          </span>
          <span className="now-playing-metrics num">
            {track.plays!=null&&<strong>{vn(track.plays)}x</strong>}
            {listening&&<span>{listening}</span>}
          </span>
        </span>
        <MusicMetadata items={trackMeta.filter(item=>item.title!=='Độ dài bài hát')}/>
      </span>
    </button></ShortcutTarget>
    {!alwaysShow&&<button type="button" className="now-playing-close" onClick={()=>{controller.current?.abort();controller.current=undefined;setBusy(false);setTrack(null);}} aria-label="Đóng bài đang nghe"><span aria-hidden="true">×</span></button>}
    <button type="button" className="now-playing-reload" disabled={busy} onClick={()=>void check()} aria-label="Cập nhật bài đang nghe">{busy?'…':'↻'}</button>
  </div>;
}

export function TodayScreen({ vm, c }: P) {
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <NowPlayingButton c={c}/>
      <Sec>{vm.weekTitle}</Sec>
      <ChartCard>
        <Legend items={[{ color: "var(--c2)", label: "Trung bình" }, { color: "var(--text3)", label: "Tuần trước" }, { color: "var(--accent)", label: "Tuần này" }]} />
        <div className="readout" hidden>{vm.rd.week}</div>
        {vm.ch.week}
      </ChartCard>
      <div className="today-week-pair">
      <div className="today-week-summary">
        <div className="today-week-plays">
          <div className="num">{vm.wk.plays}</div>
          <div className="t2">lượt nghe</div>
        </div>
        <div className="today-week-sub t2">{vm.wk.sub}</div>
        <div className="today-week-change" style={{ color: vm.wk.col }}>{vm.wk.chg.replace('so với', 'với')}</div>
      </div>
      <div className="today-week-hour">
        {vm.ch.weekHour ? <>
          <div className="today-week-clock">{vm.ch.weekHour}</div>
        </> : <EmptyState iconOnly title="Chưa có dữ liệu theo giờ" note=""/>}
        </div>
      </div>
      <div style={{ margin: "10px 16px 0", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        {[
          { l: "Tháng này", x: vm.mo, foot: <div style={{ fontSize: "var(--type-caption, 12px)", fontWeight: 600, color: vm.mo.col, marginTop: 4 }}>{vm.mo.chg.replace("so với", "với")}</div> },
          { l: vm.yr.label, x: vm.yr, foot: <div style={{ fontSize: "var(--type-caption, 12px)", color: "var(--text3)", marginTop: 4 }}>{vm.yr.prev}</div> },
        ].map((b, k) => (
          <div key={k} style={{ background: "var(--surface)", borderRadius: 16, padding: 14 }}>
            <div className="lbl">{b.l}</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, marginTop: 6 }}>{b.x.plays}</div>
            <div style={{ fontSize: "var(--type-caption, 12px)", color: "var(--text2)", marginTop: 6 }}>{b.x.sub}</div>
            {b.foot}
          </div>
        ))}
      </div>
      <div className="num" style={{ padding: "10px 20px 0", fontSize: "var(--type-caption, 12px)", color: "var(--text3)" }}>{vm.totalLine}</div>

      <SecSide title="Top nghệ sĩ tuần này" side="xếp theo giờ nghe" />
      <div className="card" style={{ padding: "6px 0 4px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) repeat(7,22px) 26px", gap: 3, padding: "6px 12px", fontSize: "var(--type-caption, 11px)", fontWeight: 600, color: "var(--text3)", textAlign: "center" }}>
          <div style={{ textAlign: "left" }}>Nghệ sĩ</div>
          {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => <div key={d}>{d}</div>)}
          <div style={{ textAlign: "right" }}>Σ</div>
        </div>
        {vm.weekTable.map((r: Any, k: number) => (
          <ShortcutTarget key={k} entity={artistShortcut(r)}><div className="num" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) repeat(7,22px) 26px", gap: 3, padding: "9px 12px", borderTop: "0.5px solid var(--line)", fontSize: 14, textAlign: "center", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <Thumb ini={r.ini} img={r.img} round size={22} label={r.name} style={{ fontSize: 8, flexShrink: 0 }} />
              <div className="ell" style={{ fontWeight: 600 }}>{r.name}</div>
              <Flags hot={r.hot} cold={r.cold} />
            </div>
            {r.cells.map((cl: Any, j: number) => <div key={j} style={cl.s}>{cl.v}</div>)}
            <div style={{ textAlign: "right", fontWeight: 700 }}>{r.total}</div>
          </div></ShortcutTarget>
        ))}
      </div>

      <SecLink title="Vừa nghe" link="Xem thêm" onTap={()=>c.go('recent')} />
      <RecentSongs rows={vm.recent} />

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

    </>
  );
}

export function RecentSongs({rows}:{rows:Any[]}) {
  return <div className="card">{rows.map((r:Any,k:number)=><SongListRow key={k} r={r} right={
    <div className="recent-time num t3">{r.date && <span className="recent-date">{r.date}</span>}<span>{r.time}</span>{r.unmatched && <span className="outside-library-icon" role="img" aria-label="Chưa có trong thư viện" title="Chưa có trong thư viện">+</span>}</div>
  } />)}</div>;
}
export function RecentScreen({vm}:P) {
  return <><SampleChip show={vm.sampleChip} text={vm.chipText}/><Sec>25 lượt nghe gần nhất</Sec>
    {vm.recent.length ? <RecentSongs rows={vm.recent}/> : <EmptyState title="Chưa có lượt nghe" note=""/>}</>;
}

export const SongListRow = ({ r, right, hideAlbum = false, hideArtist = false }: { r: Any; right?: ReactNode; hideAlbum?:boolean; hideArtist?:boolean }) => (
  <ShortcutTarget entity={songShortcut(r)}><div className={`row song-row ${r.rankTrendClass || ''}`} onClick={r.onTap}>
    <div className="song-artwork"><Thumb ini={r.ini || r.title?.slice(0,2) || '♫'} img={r.img} size={52} /><ArtworkRank rank={r.allTimeRank} change={r.allTimeChange} comparison={r.allTimeComparison} /></div>
    <div className="song-copy">
      {!hideArtist && <MetadataHelp item={{title:'Màu nghệ sĩ',text:r.artist}}><div className={`sub13 ell tone-${r.artistTone || 'gray'}`}>{r.artist}</div></MetadataHelp>}
      <SongTitle title={r.title} tone={r.titleTone} items={r.metadata} trackNumber={r.trackNumber} />
      <div className="song-album-line">
        {!hideAlbum && r.album && (r.goAlbum ? <ShortcutTarget entity={albumShortcut({title:r.album,artist:r.albumArtist || r.artist,onTap:r.goAlbum})}><button type="button" className="song-album ell album-name-link" title={r.album} aria-label={`Mở album: ${r.album}`} onClick={e=>{e.stopPropagation();r.goAlbum();}}>{r.album}</button></ShortcutTarget> : <div className="song-album ell" title={r.album}>{r.album}</div>)}
        <MusicMetadata items={r.metadata} />
        {r.unmatched && !r.metadata?.some((m:Any)=>m.title==='Năm phát hành') && <RecentAlbumYear artist={r.artist} title={r.title} album={r.album} />}
      </div>
      {!r.metadata?.length && r.added && <div className="sub13">{r.added}</div>}
    </div>
    {right ?? ((r.gone || r.unmatched || r.in_library===0) ? <LastfmTrackMetrics artist={r.artist || ''} title={r.title || ''} trackId={r.tid} outsideLibrary={r.titleTone!=='unreleased'}/> : <SongListeningMetrics plays={r.metric || r.v} listening={r.listening} duration={r.duration_s} metadata={r.metadata} timeFirst={r.timeFirst}>
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
    <Thumb ini={r.ini || r.name?.slice(0,2) || '♫'} img={r.img} round size={136} />
    <div className="artist-title-line"><MetadataHelp item={{title:'Màu nghệ sĩ',text:r.name}}><div className={`artist-name tone-${r.titleTone || 'gray'}`}><span className="tile-rank">{r.rank}.</span> {r.name} <Flags hot={r.hot} cold={r.cold} /></div></MetadataHelp>
    </div>
    {!counts && <MusicMetadata items={r.metadata} hideAdded />}
    <ArtistStatsLine r={r} />
    {!counts && !r.lastPlayed && r.sub && <div className="artist-sub">{r.sub.replace(/nghe lần cuối\s*/, '▷')}</div>}
    <div className="tile-metrics num"><strong>{compactPlays(swapMetrics ? r.small : primary)}</strong><span>{compactPlays(swapMetrics ? primary : r.small)}</span></div>
  </button></ShortcutTarget>;
};

export function Top100Screen({ vm, c }: P) {
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <div className="ranking-tabs"><SegTabs items={vm.songViewTabs} /></div>
      {!vm.songIsHistory && <div className="ranking-month-tabs"><SegTabs items={vm.songRankMonthChips || []} /></div>}
      {vm.songIsHistory ? <RankHistoryPanel vm={vm} /> : <>
      {vm.songFilterNote && <div className="note">{vm.songFilterNote}</div>}
      <RankFocus c={c} rows={vm.top100Rows} kind="song" />
      <div className="card web-song-grid" style={{ marginTop: 10 }}>
        {vm.top100Rows.slice(0,100).map((r: Any, k: number) => (
          <RisingRow key={k} r={r} />
        ))}
      </div>
      </>}
    </>
  );
}

export function ArtistsAllScreen({ vm, c }: P) {
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <div className="ranking-tabs"><SegTabs items={vm.sortChips} /></div>
      {!vm.artistIsHistory && <div className="ranking-month-tabs"><SegTabs items={vm.artistRankMonthChips || []} /></div>}
      {vm.artistIsHistory ? <RankHistoryPanel vm={vm} /> : <>
      {vm.artistFilterNote && <div className="note">{vm.artistFilterNote}</div>}
      <RankFocus c={c} rows={vm.artistRows} kind="artist" />
      {!vm.artistRows.length && <EmptyState title="Chưa có nghệ sĩ phù hợp" note=""/>}
      <div className="artist-grid" style={{ marginTop: 12 }}>
        {vm.artistRows.slice(0,32).map((r: Any, k: number) => (
          <ArtistListRow key={k} r={r} timeFirst />
        ))}
      </div>
      {vm.sortPts && <div className="note" style={{ paddingTop: 6 }}>Chỉ 30 nghệ sĩ trong nhóm chấm điểm có điểm. Nghệ sĩ khác hiện “–” và không có trong danh sách này.</div>}
      </>}
    </>
  );
}

// Dùng cùng cover và metadata với các danh sách bài hát khác.
export const RisingRow = ({ r }: { r: Any }) => r.gone ? <SongListRow r={r}/> : (
  <SongListRow r={r} right={
    <div className={`rising-song-metrics tone-${r.titleTone || 'gray'}`}>
      <SongListeningMetrics plays={r.metric || r.v} listening={r.listening} duration={r.duration_s} metadata={r.metadata} timeFirst={r.timeFirst} inline/>
      <div className="rising-song-chart">{r.spark}</div>
      {r.risingRank != null ? <div className="song-rank-progress num" aria-label={`Hạng cuối ${r.risingPreviousPeriod}: #${r.risingPreviousRank}; hạng trong tháng này: #${r.risingRank}; tăng ${r.risingPreviousRank-r.risingRank} bậc`}>
        <strong className="t3">{r.risingPreviousRank}</strong><span className="rank-up" aria-hidden="true">▶</span><strong className="rank-up">{r.risingRank}</strong>
      </div> : <SongRankProgress best={r.allTimeBestRank} previous={r.allTimePreviousRank} current={r.allTimeRank} previousPeriod={r.allTimePreviousPeriod}/>} 
    </div>
  } />
);

export function RisingSongGroups({ vm, rows }: { vm: Any; rows: Any[] }) {
  const groups = vm.risingGroups || (rows.length ? [{ month: "T09/26", rows }] : []);
  return <div className="rising-song-groups" style={{ margin: "0 16px", display: "flex", flexDirection: "column", gap: 12 }}>
    {groups.map((g: Any) => <div className="rising-song-month" key={g.month} style={{ background: "var(--surface)", borderRadius: 16, overflow: "hidden" }}>
      <RisingMonthHeader group={g}/>
      {g.rows.map((r: Any, k: number) => <RisingRow key={r.tid || k} r={r}/>)}
    </div>)}
    {!groups.length && <EmptyState title="Chưa có bài phù hợp" note="Chỉ hiện bài tăng hạng và có lượt nghe trong tháng tương ứng."/>}
  </div>;
}

export const RisingArtistRow = ({ r }: { r: Any }) => {
  const [previous,current]=String(r.ranks || '').split(' → ').map((rank:string)=>rank.replace(/#/g,''));
  const [plays,listening]=String(r.sub || '').split(' · ');
  return <ShortcutTarget entity={artistShortcut(r)}><div className="row" onClick={r.onTap} style={{ display: "grid", gridTemplateColumns: "36px minmax(0,1fr) auto", columnGap: 10, padding: "10px 14px", alignItems: "center", borderTop: "0.5px solid var(--line)" }}>
    <Thumb ini={r.ini} img={r.img} round size={36} style={{ fontSize: "var(--type-caption, 10px)" }} />
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
        <div className="title15 ell">{r.name}</div>
        <Flags hot={r.hot} cold={r.cold} />
      </div>
      <div className="artist-row-details"><ArtistStatsLine r={r} /></div>
      <div className="song-metrics num song-metrics-inline" style={{ justifyContent: "flex-start" }}><strong style={{ fontSize: "var(--type-caption, 12px)" }}>{plays}</strong>{listening && <span style={{ fontSize: "var(--type-caption, 12px)" }}>{listening}</span>}</div>
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
    {groups.map((g:Any)=><div className="rising-artist-month" key={g.month} style={{ background: "var(--surface)", borderRadius: 16, overflow: "hidden" }}>
      <RisingMonthHeader group={g}/>
      {g.rows.map((r:Any,j:number)=><RisingArtistRow key={r.an || j} r={r}/>)}
    </div>)}
    {!groups.length && <EmptyState title="Chưa có nghệ sĩ phù hợp" note={emptyNote}/>}
  </div>;
}

function MonthSummaryPeople({rows,round=false}:{rows:Any[];round?:boolean}) {
  return <div className="month-summary-people">
    {rows.slice(0,3).map((r:Any)=><span key={r.name} className="month-summary-person">
      <Thumb ini={r.ini || r.name?.slice(0,2) || '♫'} img={r.img} round={round} size={22}/>
      <span className="ell">{r.name}</span>
      {r.change ? <b className="num">▲{r.change}</b> : null}
    </span>)}
  </div>;
}

function MonthSummaryCard({summary}:{summary:Any}) {
  if(!summary)return null;
  return <div className="month-summary-card">
    <button type="button" className="month-summary-head" onClick={summary.openAll}>
      <span className="month-summary-main">
        <strong>{summary.title}</strong>
        {summary.metrics?.length ? <span className="month-summary-metrics">
          {summary.metrics.map((m:Any)=><span key={m.label}><b className="num">{m.value}</b><small>{m.label}</small></span>)}
        </span> : <em>{summary.status}</em>}
      </span>
      {summary.lead && <span className="month-summary-lead">
        <Thumb ini={summary.lead.ini || summary.lead.name?.slice(0,2) || '♫'} img={summary.lead.img} round size={36}/>
        <span className="ell">#1 {summary.lead.name}</span>
        <b>{summary.lead.value}</b>
      </span>}
    </button>
    <div className="month-summary-grid">
      {(summary.blocks || [
        {label:'Tăng hạng',count:summary.risingCount ? `${summary.risingCount} nghệ sĩ` : 'Chưa có',rows:summary.risingArtists || [],round:true,onTap:summary.openRising},
        {label:'Nghệ sĩ mới',count:summary.newCount ? `${summary.newCount} nghệ sĩ` : 'Chưa có',rows:summary.newArtists || [],round:true,onTap:summary.openNew},
        {label:'Bài hát tăng hạng',count:summary.risingSongCount ? `${summary.risingSongCount} bài` : 'Chưa có',rows:summary.risingSongs || [],onTap:summary.openRisingSongs},
        {label:'Bài hát mới nổi bật',count:summary.newSongCount ? `${summary.newSongCount} bài` : 'Chưa có',rows:summary.newSongs || [],onTap:summary.openNewSongs},
      ]).map((block:Any)=><button type="button" key={block.label} className="month-summary-block" onClick={block.onTap}>
        <span className="lbl">{block.label}</span>
        <strong>{block.count}</strong>
        <MonthSummaryPeople rows={block.rows || []} round={block.round}/>
      </button>)}
    </div>
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
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <Sec>Nghệ sĩ đang lên</Sec>
      <RisingArtistGroups groups={vm.risingArtists} emptyNote="Chỉ hiện nghệ sĩ tăng hạng trong tháng tương ứng."/>

      <Sec>Bài đang lên hạng</Sec>
      <RisingSongGroups vm={vm} rows={vm.rising}/>

      {SHOW_TREND_SONG_HISTORY && <>
        <Sec>Top 10 bài · 12 tháng</Sec>
        <div className="card" style={{ padding: "14px 12px 10px", overflow: "visible" }}>{vm.bumpEl}</div>
      </>}
    </>
  );
}

export function OverviewScreen({ vm, c }: P) {
  return (
    <div className="overview-layout">
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <ScopeTabs items={vm.scopeChips} />
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
            {vm.hasBefore && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: "var(--type-caption, 11px)", color: "var(--text2)" }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: "var(--text3)" }} />
                {vm.beforeL}
              </div>
            )}
          </ChartCard>
        </section>
        <section>
          <SecSide title="Giờ nghe theo tháng" side="tất cả nghệ sĩ" />
          <ChartCard readout={vm.rd.hours}>{vm.ch.hours}</ChartCard>
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

      {vm.isAll && <>
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

function RankHistoryPanel({ vm }: { vm: VM }) {
  return <>
    <Sec>{vm.rankHistoryTitle}</Sec>
    {vm.rankHistoryChart && <div className="card rank-history-chart" style={{ padding: "14px 12px 10px" }}>{!!vm.rankHistoryLabels?.length && <div className="rank-history-axis"><div>{vm.rankHistoryLabels.map((label:string,i:number,labels:string[]) => (i % Math.ceil(labels.length/9) === 0 || i === labels.length-1) && <span key={i} style={{left:`${i/Math.max(1,labels.length-1)*100}%`}}>{label}</span>)}</div></div>}{vm.rankHistoryChart}</div>}
    <div className="note">{vm.rankHistoryNote}</div>
  </>;
}

export function PeriodTopScreen({ vm, c }: P) {
  if(vm.periodIsAlbums){
    const limit=vm.periodAllTime ? 32 : listDisplayLimit(vm.periodAllTime,c?.p?.periodListSize);
    return <><div className="ranking-tabs"><SegTabs items={vm.albumSortChips || []}/></div>
      {vm.periodAllTime && !vm.albumIsHistory && <div className="ranking-month-tabs"><SegTabs items={vm.albumRankMonthChips || []}/></div>}
      {vm.albumIsHistory ? <RankHistoryPanel vm={vm}/> : <>
      {vm.albums.length ? <AlbumGrid albums={vm.albums.slice(0,limit)} showRank hideArtist/> : <EmptyState title="Chưa có album phù hợp" note=""/>}
      </>}
    </>;
  }
  return <>
    <SampleChip show={vm.sampleChip} text={vm.chipText} />
    {vm.periodIsArtists ? <div className="period-top-tabs ranking-tabs"><SegTabs items={vm.periodSortChips} /></div> : <div className="ranking-tabs"><SegTabs items={vm.songViewTabs} /></div>}
    {vm.periodIsHistory ? <RankHistoryPanel vm={vm} /> : <>
    {vm.periodRisingNote && <div className="note">{vm.periodRisingNote}</div>}
    {vm.periodIsArtists && vm.periodRisingNote ? <RisingArtistGroups groups={(vm.periodRisingGroups || []).map((g:Any)=>({...g,rows:g.rows.slice(0,listDisplayLimit(false,c?.p?.periodListSize))}))} emptyNote={vm.periodEmpty}/>
    : <div className={vm.periodIsArtists ? "artist-grid" : "card song-list"} style={{ marginTop: 12 }}>
      {!vm.periodRows.length && <EmptyState title="Chưa có kết quả" note={vm.periodEmpty} />}
      {vm.periodRows.slice(0,listDisplayLimit(false,c?.p?.periodListSize)).map((r: Any, k: number) => vm.periodIsArtists
        ? <ArtistListRow key={k} r={r} timeFirst={c.p.periodSort !== "Lượt" && c.p.periodSort !== "Điểm All time"} />
        : r.risingRank != null ? <RisingRow key={k} r={r}/> : <SongListRow key={k} r={r} />)}
    </div>}
    {vm.periodIsArtists && !vm.periodRisingNote && <div className="note">* đang nghe nhiều · !!! top 10 từ 04/2024 nhưng gần đây ít nghe</div>}
    </>}
  </>;
}
