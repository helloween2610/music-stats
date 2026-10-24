import { cloneElement, createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ShortcutSheetNav, useMenuLinkTap, useSheetMotion, useSheetSwipeDismiss } from './shortcut-sheet-controls';
import type { Ctx, VM } from '@/vm';
import { BROWSER_PREVIEW, IOS_APP } from '@/config';
import { albumId } from '@/lib/albums';
import { isReleaseSaved, loadAppleDetail, setReleaseSaved, type AppleDetailQuery, type Release, type SavedReleaseSource } from '@/lib/discovery';
import { appleMusicStoreId, shareAppleMusicLink } from '@/lib/apple-music-opening';
import { openAppleMusicInNativeApp, openPlaylistInMusicNativeApp, playAlbumInNativeApp, playPlaylistInNativeApp, playSectionFromHereInNativeApp, playTrackInNativeApp, setPlaylistPebbleFavoriteInNativeApp, shareUrlInNativeApp, type NativePlaylistAction, type NativeQueueItem, type NativeTrackAction } from '@/lib/ios-bridge';
import { longPress } from '@/lib/long-press';
import { lockTextSelection } from '@/lib/selection-lock';
import { MusicMetadata, compactPlays } from '@/components/music-metadata';
import { SongMonthlyHistoryChart } from '@/components/song-monthly-history-chart';
import { ShortcutHistoryFrame } from './shortcut-history-frame';
import type { MetaItem } from '@/lib/metadata';
import { artworkStore, getFresh, invalidate, postJson } from '@/lib/api';
import { songHistoryChart, vbars } from '@/lib/charts';
import { addDays, d1, dm, dow, fmtH, mlab, vn } from '@/lib/fmt';
import { addPlaylistRankExclude, buildPlaylistRankRows, loadPlaylistSnapshot, playlistsContainingTrack, readPlaylistRankExcludes, sortPlaylistsByRank, type Playlist } from '@/lib/playlists';

export type ShortcutEntity = {
  kind:'song'|'artist'|'album'; title:string; artist:string; id?:string; album?:string; albumArtist?:string;
  releaseId?:string; detail?:()=>void; goAlbum?:()=>void; image?:string; initials?:string; metadata?:MetaItem[];
  plays?:string; listening?:string; titleTone?:string; actionsOnly?:boolean; applePid?:string;
  artistTone?:string; artistStatus?:string; artistRankLine?:string; artistGap?:string; artistLastDays?:number; artistLastOverdue?:boolean;
  rankWeight?:number;
  queueContext?: {kind:'playlist';playlistId:string;label?:string;itemCount?:number;index?:number}|{kind:'album';artist:string;album:string;label?:string;itemCount?:number;index?:number}|{kind:'section';items:NativeQueueItem[];index:number;label?:string};
  savedRelease?:Release; savedSource?:SavedReleaseSource;
  actions?: {label:string; onRun:()=>void|Promise<void>; symbol?:string}[];
};
export const shortcutKey = (e:ShortcutEntity) => JSON.stringify([e.kind,e.kind==='song' ? e.id || [e.artist,e.title] : e.kind==='artist' ? e.artist : [e.artist,e.title]]);
export const songShortcut = (r:any):ShortcutEntity => {
  const rawPlays=r.allTimeMetric ?? r.metric ?? r.v;
  const plays=rawPlays==null||rawPlays===''?undefined:compactPlays(typeof rawPlays==='number'?`${rawPlays.toLocaleString('vi-VN')} lượt`:String(rawPlays));
  return {kind:'song',id:r.tid,title:r.title || '',artist:r.artist || '',album:r.album,albumArtist:r.albumArtist,releaseId:r.releaseId,
    detail:!r.unmatched ? r.onTap : undefined,goAlbum:r.goAlbum,image:r.img,initials:r.ini || r.title?.slice(0,2)?.toUpperCase(),
    metadata:r.allTimeMetadata ?? r.metadata,plays,listening:r.allTimeListening ?? r.listening,titleTone:r.titleTone,actionsOnly:!!r.shortcutActionsOnly,
    applePid:r.applePid || r.apple_pid || r.persistentId,rankWeight:r.rankWeight ?? r.rank_weight,queueContext:r.queueContext};
};
export const artistShortcut = (r:any):ShortcutEntity => {
  const primary=r.big ?? r.v;
  const secondary=r.small;
  const secondaryIsPlays=/^[\d.,]+(?: lượt|x)$/.test(String(secondary || ''));
  const fallback=String(r.sub || '').split(' · ');
  const metadata=(r.allTimeMetadata ?? r.metadata)?.map((item:MetaItem)=>{
    const match=/^([\d.,]+) bài trong thư viện$/i.exec(String(item.text || '').trim());
    return match?{...item,text:`${match[1]}♪`}:item;
  });
  return {kind:'artist',title:r.name || r.an || r.title || '',artist:r.an || r.name || r.title || '',detail:r.onTap,
    image:r.img,initials:r.ini || (r.name || r.an || r.title || '').slice(0,2).toUpperCase(),metadata,titleTone:r.titleTone,
    artistStatus:r.cold?'Top 10 từ 04/2024 · ít nghe gần đây':r.hot?'* đang nghe nhiều':undefined,
    artistRankLine:r.rline,artistGap:r.gap,
    plays:compactPlays(String(r.allTimeMetric ?? (secondaryIsPlays?secondary:primary) ?? fallback[0] ?? '')) || undefined,
    listening:r.allTimeListening ?? (compactPlays(String((secondaryIsPlays?primary:secondary) ?? fallback[1] ?? '')) || undefined)};
};
export const albumShortcut = (r:any):ShortcutEntity => {
  const metricValues=Array.isArray(r.metrics)?r.metrics:[];
  const providedPlays=metricValues.find((metric:any)=>metric.label==='Lượt nghe')?.value;
  const providedListening=metricValues.find((metric:any)=>metric.label==='Thời gian nghe')?.value;
  const playsField=String(r.plays || '');
  const playsIsCount=/(?: lượt|x)$/.test(playsField);
  const dateText=/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')?String(r.date).split('-').reverse().join('/'):r.date;
  const metadata:MetaItem[]|undefined=r.allTimeMetadata || r.metadata || [
    dateText&&{text:dateText,title:'Ngày phát hành',tone:'gray'},
    r.type&&{text:r.type,title:'Loại bản phát hành',tone:'gray'},
  ].filter(Boolean) as MetaItem[];
  const title=r.title || '', artist=r.artist || r.ak?.split('\u001f')[0] || '';
  const savedRelease=title&&artist?{
    id:String(r.releaseId || r.id || 'saved:'+JSON.stringify([artist,title])),
    title,artist,date:typeof r.date==='string'?r.date:'',type:typeof r.type==='string'&&r.type?r.type:'Album',
    owned:!!r.owned,url:typeof r.url==='string'?r.url:'',cover:typeof (r.img || r.cover)==='string'?(r.img || r.cover):'',
    sources:Array.isArray(r.sources)?r.sources:undefined,
  } as Release:undefined;
  return {kind:'album',title,artist,releaseId:r.releaseId,detail:r.onTap,
    image:r.img || r.cover,initials:r.ini || r.title?.slice(0,2)?.toUpperCase(),metadata,titleTone:r.titleTone,artistTone:r.artistTone,savedRelease,
    savedSource:['recommend','playlistRecommend','recent','upcoming','other'].includes(String(r.releaseSavedSource || r.savedSource)) ? (r.releaseSavedSource || r.savedSource) : 'other',
    plays:compactPlays(String(r.allTimeMetric ?? providedPlays ?? (playsIsCount?r.plays:r.v) ?? '')) || undefined,
    listening:r.allTimeListening ?? (compactPlays(String(providedListening ?? (playsIsCount?r.v:r.plays) ?? '')) || undefined)};
};
const ShortcutContext = createContext<{open:(entity:ShortcutEntity)=>void;detail:(entity:ShortcutEntity)=>void;focusKey?:string}|null>(null);

export function useShortcutMenu() {
  return useContext(ShortcutContext)?.open;
}

export function useShortcutDetail() {
  return useContext(ShortcutContext)?.detail;
}

/** Clone a DOM target so rows/cards retain their layout and ordinary tap behavior. */
export function ShortcutTarget({entity,children,singleTapActivates=false}:{entity:ShortcutEntity;children:ReactElement<any>;singleTapActivates?:boolean}) {
  const context=useContext(ShortcutContext);
  const latest=useRef(()=>{}); latest.current=()=>context?.open(entity);
  const latestDetail=useRef(()=>{}); latestDetail.current=()=>context?.detail(entity);
  const gesture=useRef<ReturnType<typeof longPress>>();
  const tapTimer=useRef<ReturnType<typeof setTimeout>>();
  if(!gesture.current)gesture.current=longPress(()=>latest.current());
  useEffect(()=>()=>{gesture.current?.cancel();clearTimeout(tapTimer.current);},[]);
  const key=shortcutKey(entity), old=children.props;
  return cloneElement(children, {
    'data-shortcut-key':key,
    tabIndex:old.tabIndex ?? 0,
    'aria-haspopup':'dialog',
    className:[old.className,'shortcut-target',context?.focusKey===key?'shortcut-highlight':''].filter(Boolean).join(' '),
    onPointerDown:(e:React.PointerEvent)=>{old.onPointerDown?.(e);if(e.defaultPrevented)return;if(!e.isPrimary || e.button!==0){gesture.current!.cancel();return;} e.stopPropagation();gesture.current!.start(e.clientX,e.clientY);},
    onPointerMove:(e:React.PointerEvent)=>{gesture.current!.move(e.clientX,e.clientY);old.onPointerMove?.(e);},
    onPointerUp:(e:React.PointerEvent)=>{gesture.current!.end();old.onPointerUp?.(e);},
    onPointerCancel:()=>gesture.current!.cancel(),
    onPointerLeave:()=>gesture.current!.cancel(),
    onClickCapture:(e:React.MouseEvent)=>{
      const owner=(e.target as Element)?.closest?.('[data-shortcut-key]');
      if(owner!==e.currentTarget){old.onClickCapture?.(e);return;}
      if(gesture.current!.consumeClick()){clearTimeout(tapTimer.current);e.preventDefault();e.stopPropagation();return;}
      if(e.detail===0){e.preventDefault();e.stopPropagation();if(old.onClick)old.onClick(e);else latestDetail.current();return;}
      e.preventDefault();e.stopPropagation();
      if(singleTapActivates){clearTimeout(tapTimer.current);tapTimer.current=undefined;if(old.onClick)old.onClick(e);else latestDetail.current();return;}
      if(e.detail>=2){clearTimeout(tapTimer.current);tapTimer.current=undefined;if(old.onClick)old.onClick(e);else latestDetail.current();return;}
      clearTimeout(tapTimer.current);
      tapTimer.current=setTimeout(()=>{tapTimer.current=undefined;latest.current();},300);
    },
    onContextMenu:(e:React.MouseEvent)=>{clearTimeout(tapTimer.current);tapTimer.current=undefined;e.preventDefault();e.stopPropagation();gesture.current!.blockClick();latest.current();},
    onDragStart:(e:React.DragEvent)=>e.preventDefault(),
    onKeyDown:(e:React.KeyboardEvent)=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();e.stopPropagation();latest.current();}else old.onKeyDown?.(e);},
  });
}

export function ShortcutProvider({c,vm,children}:{c:Ctx;vm?:VM|null;children:ReactNode}) {
  const [entities,setEntities]=useState<ShortcutEntity[]>([]);
  const [menuEntry,setMenuEntry]=useState<'slide'|'fade'>('slide');
  const entity=entities[entities.length-1] || null;
  useEffect(()=>setEntities([]),[c.screen,c.id]);
  const detail=(item:ShortcutEntity)=>{
    if(item.actionsOnly)return;
    if(item.detail)item.detail();
    else if(item.kind==='album'&&item.artist&&item.title)c.go('album',albumId(item.artist,item.title));
    else if(item.kind==='artist'&&item.artist)c.go('artist',item.artist);
    else if(item.kind==='song'&&item.id)c.go('song',item.id);
  };
  const close=()=>setEntities([]);
  return <ShortcutContext.Provider value={{open:item=>{setMenuEntry('slide');setEntities([item]);},detail,focusKey:c.p.rankFocus?.key}}>
    {children}
    {entity && <ShortcutSheet key={shortcutKey(entity)} entity={entity} c={c} vm={vm} entry={menuEntry}
      canBack={entities.length>1} open={item=>{setMenuEntry('fade');setEntities(stack=>[...stack,item]);}}
      back={()=>{setMenuEntry('fade');setEntities(stack=>stack.slice(0,-1));}} close={close}/>}
  </ShortcutContext.Provider>;
}

type ShortcutRankBadge = {rank:number;change?:number};

function ShortcutEntityHistoryChart({detail,entity,loading,error}:{detail?:{kind:'artist'|'album';currentRank?:number;rows:any[]}|null;entity?:ShortcutEntity;loading?:boolean;error?:boolean}) {
  const rows=detail?.rows || [];
  const [selected,setSelected]=useState(Math.max(0,rows.length-1));
  useEffect(()=>setSelected(Math.max(0,rows.length-1)),[detail?.kind,rows.length]);
  const labels=rows.map(row=>{
    const period=String(row.period || '');
    return /^T\d{2}\/\d{2}$/.test(period)?period.slice(1):mlab(period.slice(0,7));
  });
  const values=rows.map(row=>Number(row.hours ?? row.monthHours) || 0);
  const ranks=rows.map(row=>Number(row.rank)>0?Number(row.rank):null);
  return <ShortcutHistoryFrame loading={loading} error={error} heading={<>
      <strong>Giờ nghe &amp; lịch sử hạng</strong>
      {entity?.kind==='artist'&&<div className="shortcut-artist-history-context">
        {entity.artistGap&&<span title="Khoảng cách trung bình giữa các ngày nghe">TB <b className="num">{entity.artistGap}</b></span>}
        {entity.artistLastDays!=null&&<b className={`shortcut-artist-history-days num ${entity.artistLastOverdue?'down':'warn'}`} title="Số ngày từ lần nghe cuối đến nay">{entity.artistLastDays} ngày</b>}
      </div>}
    </>}>
    {rows.length>0?songHistoryChart(values,ranks,labels,{
    h:126,
    currentRank:detail?.currentRank,
    rankThreshold:50,
    valueFormatter:(value:number)=>`${Math.round(value)}h`,
    sel:Math.min(selected,rows.length-1),
    onSel:setSelected,
    ariaLabel:`Giờ nghe và lịch sử hạng theo tháng của ${detail?.kind==='artist'?'nghệ sĩ':'album'}`,
  }):null}</ShortcutHistoryFrame>;
}

function ArtistWeeklyChart({detail,loading,error}:{detail?:{weeks?:any[];asOf?:string}|null;loading?:boolean;error?:boolean}) {
  const asOf=/^\d{4}-\d{2}-\d{2}$/.test(String(detail?.asOf || ''))?String(detail?.asOf):new Date().toISOString().slice(0,10);
  const lastWeek=addDays(asOf,-((dow(asOf)+6)%7));
  const dates=Array.from({length:26},(_,index)=>addDays(lastWeek,-7*(25-index)));
  const byWeek=new Map((detail?.weeks || []).map(row=>[String(row.week || '').slice(0,10),Number(row.plays)||0]));
  const values=dates.map(date=>byWeek.get(date) || 0);
  const [selected,setSelected]=useState(values.length-1);
  useEffect(()=>setSelected(values.length-1),[lastWeek]);
  return <ShortcutHistoryFrame weekly loading={loading} error={error} heading={<><strong>Lượt theo tuần · 26 tuần gần nhất</strong>{detail&&<span className="num">Tuần {dm(dates[selected])} · {vn(values[selected])} lượt</span>}</>}>
    {detail?vbars(values,dates.map((date,index)=>index%5===0||index===dates.length-1?dm(date):''),{h:120,inset:14,sel:selected,onSel:setSelected}):null}
  </ShortcutHistoryFrame>;
}

function ShortcutEntityHeader({entity:e,onDetail,canDetail,rankBadge}:{entity:ShortcutEntity;onDetail:()=>void;canDetail:boolean;rankBadge?:ShortcutRankBadge}) {
  const duration=e.metadata?.find(item=>item.title==='Độ dài bài hát')?.text;
  const label=e.kind==='song'?'Bài hát':e.kind==='artist'?'Nghệ sĩ':'Album';
  return <div className={`shortcut-song-card shortcut-${e.kind}-card${canDetail?' shortcut-song-card-action':''}`} role={canDetail?'button':undefined} tabIndex={canDetail?0:undefined}
    aria-label={canDetail?`Mở chi tiết ${label.toLowerCase()}: ${e.title}`:undefined} aria-disabled={canDetail?undefined:true}
    onClick={canDetail?onDetail:undefined} onKeyDown={canDetail?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onDetail();}}:undefined}>
    <div className="shortcut-song-cover">
      {e.image?<img src={e.image} alt={`Bìa ${e.album || e.title}`} />:<span aria-hidden="true">{e.initials || e.title.slice(0,2).toUpperCase() || '♫'}</span>}
      {rankBadge&&<span className="native-art-rank" aria-label={`Hạng All time #${rankBadge.rank}${rankBadge.change?rankBadge.change>0?`, tăng ${rankBadge.change} bậc`:` giảm ${Math.abs(rankBadge.change)} bậc`:''}`}>
        <b>{rankBadge.rank}</b>
        {!!rankBadge.change&&<small className={rankBadge.change>0?'up':'down'}>{rankBadge.change>0?'▲':'▼'}{Math.abs(rankBadge.change)}</small>}
      </span>}
    </div>
    <div className="shortcut-song-details">
      <div className="shortcut-song-summary">
        <div className="shortcut-song-copy">
          <div className={`shortcut-song-label${e.kind==='song'?' shortcut-song-label-artist':''}`}>{e.kind==='song'?e.artist:label}</div>
          <div className={`shortcut-song-title tone-${e.titleTone || 'gray'}`}>
            <span className="shortcut-song-title-text">{e.title}</span>
            {duration&&<span className="shortcut-song-duration num">{duration}</span>}
          </div>
          {e.kind==='album'&&<div className={`shortcut-song-artist ell tone-${e.artistTone || 'gray'}`}>{e.artist}</div>}
          {!!(e.kind==='song'&&e.album||e.metadata?.length)&&<div className="shortcut-song-album-line">
            {e.album&&<span className="shortcut-song-album ell">{e.album}</span>}
            <MusicMetadata items={e.metadata}/>
          </div>}
        </div>
        {(e.plays||e.listening)&&<div className="shortcut-song-metrics num">
          {e.kind==='song' ? <>
            {e.plays&&<strong>{e.plays}</strong>}
            {e.listening&&<span>{e.listening}</span>}
          </> : <>
            {e.listening&&<strong>{e.listening}</strong>}
            {e.plays&&<span>{e.plays}</span>}
          </>}
          {e.kind==='song'&&Number(e.rankWeight)<1&&<small className="song-rank-weight-note">−{Math.round((1-Number(e.rankWeight))*100)}%</small>}
        </div>}
      </div>
    </div>
  </div>;
}

function ArtistRankCards({line}:{line:string}) {
  const match=/^1 tháng (.*?) · 100 ngày (.*?) · từ 04\/2024 (.*?) · All time (.*)$/.exec(line);
  if(!match)return null;
  const rows=[['1 tháng',match[1]],['100 ngày',match[2]],['Từ 04/2024',match[3]],['All time',match[4]]];
  return <div className="shortcut-artist-ranks" aria-label="Thứ hạng nghệ sĩ theo kỳ">
    {rows.map(([label,value])=><div key={label}><strong className="num">{value}</strong><span>{label}</span></div>)}
  </div>;
}

function NativeControlIcon({kind}:{kind:NativeTrackAction}) {
  if(kind==='next')return <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
    <path d="M8 7.8v12.4l9.7-6.2L8 7.8Z" fill="currentColor"/>
    <path d="M20 8.2v11.6" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round"/>
  </svg>;
  if(kind==='last')return <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
    <path d="M5.5 8h12M5.5 14h10M5.5 20h7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/>
    <path d="M20.5 13v8M16.5 17h8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/>
  </svg>;
  if(kind==='play')return <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
    <path d="M8 6.5v15l12-7.5L8 6.5Z" fill="currentColor"/>
  </svg>;
  return <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
    <path d="M7.8 8v12l8.8-6-8.8-6Z" fill="currentColor"/>
    <path d="M19.2 8.4v11.2M23.2 8.4v11.2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
  </svg>;
}

function ShortcutSheet({entity:e,c,vm,canBack,entry,open:onOpen,back:onBack,close:onDismiss}:{entity:ShortcutEntity;c:Ctx;vm?:VM|null;canBack:boolean;entry:'slide'|'fade';open:(entity:ShortcutEntity)=>void;back:()=>void;close:()=>void}) {
  const artwork=vm?.artwork || artworkStore.get('/artwork')?.data;
  const {close:closeSheet,exit,ready,motionProps}=useSheetMotion(onDismiss,entry);
  const menuLink=useMenuLinkTap();
  const close=()=>{menuLink.cancel();closeSheet();};
  const goDirect=(navigate:()=>void)=>exit(()=>{onDismiss();navigate();});
  const goArtist=()=>c.go('artist',e.artist);
  const goAlbum=e.goAlbum || (()=>c.go('album',albumId(e.albumArtist||e.artist,e.album!)));
  const openArtist=()=>open(artistShortcut({name:e.artist,onTap:goArtist}));
  const back=()=>exit(onBack,'fade');
  const open=(entity:ShortcutEntity)=>exit(()=>onOpen(entity),'fade');
  const swipeDismiss=useSheetSwipeDismiss(close);
  const panel=useRef<HTMLDivElement>(null), busy=useRef(false);
  const [link,setLink]=useState(''), [sharing,setSharing]=useState(false);
  const [linkError,setLinkError]=useState(''), [nativeBusy,setNativeBusy]=useState<NativeTrackAction|null>(null), [nativeStatus,setNativeStatus]=useState('');
  const [nativeAlbumBusy,setNativeAlbumBusy]=useState<NativePlaylistAction|null>(null);
  const [nativeQueueBusy,setNativeQueueBusy]=useState(false);
  const [albumSaved,setAlbumSaved]=useState(()=>e.kind==='album'&&!!e.artist&&!!e.title&&isReleaseSaved({artist:e.artist,title:e.title}));
  const [rankWeight,setRankWeight]=useState<number|undefined>(()=>e.kind==='song'&&e.rankWeight!=null?Number(e.rankWeight):undefined);
  const [rankWeightBusy,setRankWeightBusy]=useState(false);
  const [showRankWeights,setShowRankWeights]=useState(false);
  const [includedPlaylists,setIncludedPlaylists]=useState<Playlist[]|null>(null);
  const [includedPlaylistsError,setIncludedPlaylistsError]=useState(false);
  const [showIncludedPlaylists,setShowIncludedPlaylists]=useState(false);
  const [playlistMenu,setPlaylistMenu]=useState<Playlist|null>(null);
  const [resolvedSongID,setResolvedSongID]=useState(()=>e.kind==='song'?e.id || '':'');
  const [songHistoryDetail,setSongHistoryDetail]=useState<any>(null);
  const [historyState,setHistoryState]=useState<'loading'|'ready'|'error'>('loading');
  const [entityHistoryDetail,setEntityHistoryDetail]=useState<{kind:'artist'|'album';currentRank?:number;rows:any[];weeks?:any[];asOf?:string}|null>(null);
  const [artistSummary,setArtistSummary]=useState<Partial<ShortcutEntity>|null>(null);
  const query:AppleDetailQuery={kind:e.kind,artist:e.artist,title:e.title,album:e.album,releaseId:e.releaseId,trackId:e.id};
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow; document.body.style.overflow='hidden';
    const unlockSelection=lockTextSelection();
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    return ()=>{unlockSelection();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  useEffect(()=>{
    if(!ready||e.kind!=='song'||resolvedSongID)return;
    if(!e.title||!e.artist){setHistoryState('ready');return;}
    let live=true;
    const fold=(value:unknown)=>String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('vi').trim();
    getFresh(`/library/search?q=${encodeURIComponent(e.title)}&limit=15`)
      .then(data=>{
        if(!live)return;
        const hit=(data?.songs || []).find((song:any)=>fold(song.title)===fold(e.title)&&fold(song.artist)===fold(e.artist));
        if(hit?.track_id)setResolvedSongID(hit.track_id);
        else setHistoryState('ready');
      })
      .catch(()=>{if(live)setHistoryState('error');});
    return ()=>{live=false;};
  },[ready,e.artist,e.kind,e.title,resolvedSongID]);
  useEffect(()=>{
    if(!ready||e.kind!=='song'||!resolvedSongID||rankWeight!==undefined)return;
    let live=true;
    getFresh(`/settings/song-ranking?track_id=${encodeURIComponent(resolvedSongID)}`)
      .then(data=>{if(live){const weight=Number(data?.setting?.weight);setRankWeight([.7,.8,.9,1].includes(weight)?weight:weight===.75?.8:1);}})
      .catch(()=>{if(live)setRankWeight(1);});
    return ()=>{live=false;};
  },[ready,e.kind,rankWeight,resolvedSongID]);
  useEffect(()=>{
    if(!ready||e.kind!=='song'||!resolvedSongID)return;
    let live=true;
    getFresh(`/song/${encodeURIComponent(resolvedSongID)}?history=v2`).then(data=>{if(live){setSongHistoryDetail(data);setHistoryState('ready');}}).catch(()=>{if(live)setHistoryState('error');});
    return ()=>{live=false;};
  },[ready,e.kind,resolvedSongID]);
  useEffect(()=>{
    if(!ready||e.kind!=='song')return;
    let live=true;
    setIncludedPlaylists(null);setIncludedPlaylistsError(false);
    loadPlaylistSnapshot()
      .then(data=>{
        if(!live)return;
        const rankLibrary=vm?.nowPlayingLibrary?.length?vm.nowPlayingLibrary:vm?.playlistLibrary;
        const matches=playlistsContainingTrack(data,{title:e.title,artist:e.artist,album:e.album,albumArtist:e.albumArtist,persistentId:e.applePid});
        // The collapsed row only needs a count, not a complete library ranking pass.
        const ranks=showIncludedPlaylists?buildPlaylistRankRows(data,rankLibrary,data.playlists.length,readPlaylistRankExcludes()):[];
        setIncludedPlaylists(showIncludedPlaylists?sortPlaylistsByRank(matches,ranks,data.playlists):matches);
      })
      .catch(()=>{if(live){setIncludedPlaylists([]);setIncludedPlaylistsError(true);}});
    return ()=>{live=false;};
  },[ready,showIncludedPlaylists,e.album,e.albumArtist,e.applePid,e.artist,e.kind,e.title,vm?.nowPlayingLibrary,vm?.playlistLibrary]);
  useEffect(()=>{
    if(!ready||e.kind==='song')return;
    if(!e.artist){setHistoryState('ready');return;}
    let live=true;
    setEntityHistoryDetail(null);
    setArtistSummary(null);
    void (async()=>{
      if(e.kind==='album'){
        if(!e.title){setHistoryState('ready');return;}
        const data=await getFresh(`/history/albums?artist=${encodeURIComponent(e.artist)}&album=${encodeURIComponent(e.title)}&months=60`);
        if(live){setEntityHistoryDetail({kind:'album',currentRank:Number(data?.currentRank)||undefined,rows:Array.isArray(data?.rows)?data.rows:[]});setHistoryState('ready');}
        return;
      }
      const detail=await getFresh(`/artist/${encodeURIComponent(e.artist)}`);
      const currentRank=Number(detail?.ranks?.at)||undefined;
      const ranks=detail?.ranks || {};
      const rankText=(value:unknown)=>Number(value)>0?`#${Number(value)}`:'–';
      const flag=String(detail?.flag || '');
      const lastDay=String(detail?.logged?.last || '').slice(0,10);
      const asOf=String(detail?.asOf || '').slice(0,10);
      const lastMs=/^\d{4}-\d{2}-\d{2}$/.test(lastDay)?Date.parse(`${lastDay}T00:00:00Z`):NaN;
      const asOfMs=/^\d{4}-\d{2}-\d{2}$/.test(asOf)?Date.parse(`${asOf}T00:00:00Z`):NaN;
      const lastDays=Number.isFinite(lastMs)&&Number.isFinite(asOfMs)?Math.max(0,Math.floor((asOfMs-lastMs)/86400000)):undefined;
      const avgGap=detail?.avgGapDays==null?undefined:Number(detail.avgGapDays);
      if(live)setArtistSummary({
        artistStatus:flag.includes('!!!')?'Top 10 từ 04/2024 · ít nghe gần đây':flag.includes('*')?'* đang nghe nhiều':undefined,
        artistRankLine:`1 tháng ${rankText(ranks.m1)} · 100 ngày ${rankText(ranks.d100)} · từ 04/2024 ${rankText(ranks.ft0424)} · All time ${rankText(ranks.at)}`,
        artistGap:avgGap!=null?`${d1(avgGap)} ngày`:'–',
        artistLastDays:lastDays,
        artistLastOverdue:lastDays!=null&&avgGap!=null?lastDays>avgGap:lastDays!=null&&lastDays>=14,
        plays:detail?.allTime?.plays!=null?compactPlays(`${vn(detail.allTime.plays)} lượt`):undefined,
        listening:detail?.allTime?.hours!=null?fmtH(detail.allTime.hours):undefined,
      });
      const history=await getFresh(`/history/artists?top=${Math.max(300,currentRank || 0)}&months=36`);
      const fold=(value:unknown)=>String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('vi').trim();
      const hit=(history?.rows || []).find((row:any)=>fold(row.artist)===fold(e.artist));
      const rows=Array.isArray(hit?.history)&&hit.history.length
        ? hit.history
        : (detail?.months || []).map((row:any)=>({period:row.month,hours:row.hours,rank:null}));
      if(live){setEntityHistoryDetail({kind:'artist',currentRank,rows,weeks:Array.isArray(detail?.weeks)?detail.weeks:[],asOf:detail?.asOf});setHistoryState('ready');}
    })().catch(()=>{if(live)setHistoryState('error');});
    return ()=>{live=false;};
  },[ready,e.artist,e.kind,e.title]);
  const detail=()=>exit(()=>{
    onDismiss();
    if(e.detail)e.detail();
    else if(e.kind==='album')c.go('album',albumId(e.artist,e.title));
    else if(e.kind==='artist')c.go('artist',e.artist);
    else if(resolvedSongID)c.go('song',resolvedSongID);
  });
  const find=()=>exit(()=>{
    onDismiss();
    if(e.kind==='album') { c.go('periodTop','albums~all'); return; }
    c.set(()=>({rankFocus:{key:shortcutKey(e),kind:e.kind as 'song'|'artist',label:e.title,request:Date.now()}}));
    c.go(e.kind==='song'?'top100':'artistsAll');
  });
  const findLabel=e.kind==='song'?'Find in Top 100 All time':e.kind==='artist'?'Find in Top 32 Artist All time':'Find in Top 24 Album All time';
  const toggleAlbumSaved=()=>{
    if(e.kind!=='album'||!e.artist||!e.title)return;
    const next=!albumSaved;
    setReleaseSaved(e.savedRelease || {id:'saved:'+shortcutKey(e),title:e.title,artist:e.artist,date:'',type:'Album',owned:false,url:'',cover:e.image || ''},next,e.savedSource || 'other');
    setAlbumSaved(next);
    c.ptoast(next?'Đã lưu album vào Saved.':'Đã bỏ album khỏi Saved.');
  };
  const setContextualSongWeight=async(weight:number)=>{
    if(e.kind!=='song'||!e.id||rankWeightBusy)return;
    setRankWeightBusy(true);
    const response=await postJson('/settings/song-ranking',{track_id:e.id,weight});
    setRankWeightBusy(false);
    if(response.status!==200){c.ptoast('Chưa lưu được cách tính thứ hạng.');return;}
    setRankWeight(weight);setShowRankWeights(false);
    invalidate(()=>true);
    c.ptoast(weight<1?`Đã tính ${Math.round(weight*100)}% lượt nghe khi xếp hạng.`:'Đã khôi phục 100% lượt nghe khi xếp hạng.');
  };
  const actions=[
    ...(e.kind==='album'&&e.artist&&e.title?[{label:albumSaved?'Bỏ Saved':'Saved',symbol:albumSaved?'−':'✓',onRun:toggleAlbumSaved}]:[]),
    ...(e.actions || []),
  ];
  async function music() {
    if(busy.current||!e.artist||(e.kind!=='artist'&&!e.title))return;
    busy.current=true;setSharing(true);
    let url=link;
    try {
      setLinkError('');
      if(!url){const result=await loadAppleDetail(query);url=result.url;setLink(url);}
      if(await openAppleMusicInNativeApp(url)) {}
      else if(typeof navigator.share==='function')await shareAppleMusicLink(url,navigator);
      else if(await shareUrlInNativeApp(url,'Apple Music')) {}
      else if(BROWSER_PREVIEW)window.open(url,'_blank','noopener,noreferrer');
      else {await navigator.clipboard.writeText(url);c.ptoast('Đã sao chép liên kết. Chạy Shortcut hoặc dán vào Safari.');}
      close();
    } catch(error) {
      if(!(error instanceof Error && error.name==='AbortError')){
        const message=error instanceof Error?error.message:'Chưa lấy được liên kết Apple Music.';
        setLinkError(message);c.ptoast(message);
      }
    } finally {busy.current=false;setSharing(false);}
  }
  async function nativeMusic(action:NativeTrackAction) {
    if(nativeBusy)return;
    setNativeBusy(action);setNativeStatus('');
    try {
      let storeId:string|undefined;
      if(!e.applePid&&e.artist&&e.title){
        try {
          const result=link?{url:link}:await loadAppleDetail(query);
          storeId=appleMusicStoreId(result.url);
          if(!link)setLink(result.url);
        } catch {}
      }
      const ok=await playTrackInNativeApp(e.applePid || '',action,{artist:e.artist,title:e.title,album:e.album,storeId});
      if(!ok)throw new Error('Chưa có ID Apple Music để điều khiển bài này.');
      const message=action==='play'?'Đang phát bài này':action==='playpause'?'Đã gửi Play/Pause':action==='next'?'Đã thêm vào phát kế tiếp':'Đã thêm vào cuối hàng chờ';
      setNativeStatus(message);c.ptoast(message);
      if(action==='play'||action==='next'||action==='last')close();
    } catch(error) {
      const message=error instanceof Error?error.message:'Chưa điều khiển được Apple Music.';
      setNativeStatus(message);c.ptoast(message);
    } finally {
      setNativeBusy(null);
    }
  }
  async function nativeAlbum(action:NativePlaylistAction) {
    if(nativeAlbumBusy||e.kind!=='album'||!e.artist||!e.title)return;
    setNativeAlbumBusy(action);
    try {
      const ok=await playAlbumInNativeApp(e.artist,e.title,action);
      if(!ok)throw new Error('Không tìm thấy album này trong thư viện Apple Music.');
      const message=action==='play'?'Đang phát album.':'Đã thêm album vào phát tiếp theo.';
      c.ptoast(message);close();
    } catch(error) {
      const message=error instanceof Error?error.message:'Chưa điều khiển được Apple Music.';
      c.ptoast(message);
    } finally {
      setNativeAlbumBusy(null);
    }
  }
  async function nativeQueueFromHere() {
    if(nativeQueueBusy||e.kind!=='song'||!e.queueContext)return;
    setNativeQueueBusy(true);
    try {
      const start={persistentId:e.applePid,artist:e.artist,title:e.title};
      const ok=e.queueContext.kind==='playlist'
        ? await playPlaylistInNativeApp(e.queueContext.playlistId,'play',start)
        : e.queueContext.kind==='album'
          ? await playAlbumInNativeApp(e.queueContext.artist,e.queueContext.album,'play',start)
          : await playSectionFromHereInNativeApp(e.queueContext.items,e.queueContext.index);
      if(!ok)throw new Error('Chưa tạo được hàng chờ từ bài này.');
      c.ptoast('Đang phát từ bài này.');close();
    } catch(error) {
      c.ptoast(error instanceof Error?error.message:'Chưa điều khiển được Apple Music.');
    } finally {
      setNativeQueueBusy(false);
    }
  }
  const nativeControls=(IOS_APP||BROWSER_PREVIEW)&&e.kind==='song'&&!!(e.applePid || e.artist&&e.title);
  const nativeControlsDisabled=!IOS_APP||!!nativeBusy;
  const nativePrimaryAction:NativeTrackAction=e.queueContext?'play':'playpause';
  const queueLabel=e.queueContext?.label || (e.queueContext?.kind==='album'?e.queueContext.album:'Danh sách hiện tại');
  const queueRemaining=e.queueContext?.kind==='section'
    ? e.queueContext.items.slice(Math.max(0,e.queueContext.index)).filter(item=>item.persistentId?.trim()).length
    : e.queueContext?.itemCount!=null
      ? Math.max(0,e.queueContext.itemCount-(e.queueContext.index || 0))
      : undefined;
  const nativeAlbumControls=IOS_APP&&e.kind==='album'&&!!e.artist&&!!e.title;
  const image=e.image || (e.kind==='artist'?artwork?.artists?.[e.artist]:e.kind==='album'?artwork?.albums?.[`${e.artist}\u001f${e.title}`]:artwork?.tracks?.[e.id || '']);
  const headerEntity={...e,...(e.kind==='artist'?artistSummary:null),image};
  const badgeDetail=e.kind==='song'?songHistoryDetail:entityHistoryDetail;
  const badgeRank=Number(e.kind==='song'?badgeDetail?.allTime?.rank:badgeDetail?.currentRank)||0;
  const badgeHistory=(e.kind==='song'?(badgeDetail?.rankHistory || []):(badgeDetail?.rows || []))
    .map((row:any)=>Number(row?.rank)).filter((rank:number)=>rank>0);
  const badgePrevious=e.kind==='song'
    ? (badgeHistory.length?Math.min(...badgeHistory):0)
    : (badgeHistory.length>1?badgeHistory[badgeHistory.length-2]:0);
  const rankBadge=badgeRank?{rank:badgeRank,change:badgePrevious?badgePrevious-badgeRank:undefined}:undefined;
  return createPortal(<div {...motionProps} data-covered={!!playlistMenu || undefined} className="shortcut-backdrop"
    onPointerDownCapture={event=>{if(!(event.target as Element).closest('[data-menu-link]'))menuLink.cancel();}}
    onClickCapture={event=>{motionProps.onClickCapture(event);if(!(event.target as Element).closest('[data-menu-link]'))menuLink.cancel();}}
    onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <div {...swipeDismiss} ref={panel} role="dialog" aria-modal="true" aria-label={'Shortcut actions: '+e.title} className="shortcut-sheet" onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){
        const buttons=Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        const first=buttons[0],last=buttons[buttons.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }}>
      <ShortcutSheetNav canBack={canBack} back={back} close={close}/>
      {!e.actionsOnly&&<ShortcutEntityHeader
        entity={headerEntity}
        onDetail={detail}
        canDetail={e.kind==='song'?!!(resolvedSongID||e.detail):!!(e.title||e.artist)}
        rankBadge={rankBadge}
      />}
      {!e.actionsOnly&&e.kind==='artist'&&<ArtistRankCards line={headerEntity.artistRankLine || '1 tháng – · 100 ngày – · từ 04/2024 – · All time –'}/>}
      {!e.actionsOnly&&e.kind==='song'&&<ShortcutHistoryFrame loading={historyState==='loading'} error={historyState==='error'}>
        {songHistoryDetail?.months?.length>0&&<SongMonthlyHistoryChart detail={songHistoryDetail} height={126}/>}
      </ShortcutHistoryFrame>}
      {!e.actionsOnly&&e.kind!=='song'&&<ShortcutEntityHistoryChart
        detail={entityHistoryDetail}
        entity={headerEntity}
        loading={historyState==='loading'} error={historyState==='error'}
      />}
      {!e.actionsOnly&&e.kind==='artist'&&<ArtistWeeklyChart detail={entityHistoryDetail} loading={historyState==='loading'} error={historyState==='error'}/>}
      {nativeControls&&<div className="shortcut-native-group" role="group" aria-label="Điều khiển và hàng chờ Apple Music">
        <div className="shortcut-native-controls">
          <button type="button" disabled={nativeControlsDisabled} aria-label="Play next" title="Play next" onClick={()=>void nativeMusic('next')}><span aria-hidden="true">{nativeBusy==='next'?'…':<NativeControlIcon kind="next"/>}</span></button>
          <button type="button" className="shortcut-native-primary" disabled={nativeControlsDisabled} aria-label={e.queueContext?'Phát':'Play/Pause'} title={e.queueContext?'Phát':'Play/Pause'} onClick={()=>void nativeMusic(nativePrimaryAction)}><span aria-hidden="true">{nativeBusy===nativePrimaryAction?'…':<NativeControlIcon kind={nativePrimaryAction}/>}</span></button>
          <button type="button" disabled={nativeControlsDisabled} aria-label="Play last" title="Play last" onClick={()=>void nativeMusic('last')}><span aria-hidden="true">{nativeBusy==='last'?'…':<NativeControlIcon kind="last"/>}</span></button>
        </div>
        {e.queueContext&&<button className="shortcut-native-from-here" type="button" disabled={!IOS_APP||nativeQueueBusy||!!nativeBusy} aria-label={`Phát bài này và tiếp tục ${queueRemaining ?? ''} bài trong ${queueLabel}`.trim()} onClick={()=>void nativeQueueFromHere()}>
          <span className="shortcut-native-from-here-copy"><strong>{nativeQueueBusy?'Đang tạo hàng chờ…':'Phát từ đây'}</strong><small>{queueLabel}{queueRemaining!=null?` · ${queueRemaining} bài`:''}</small></span>
          <span className="shortcut-native-from-here-icon" aria-hidden="true">↳</span>
        </button>}
      </div>}
      {nativeStatus&&!BROWSER_PREVIEW&&<div className="shortcut-status t3" role="status">{nativeStatus}</div>}
      {nativeAlbumControls&&<>
        <button type="button" disabled={!!nativeAlbumBusy} onClick={()=>void nativeAlbum('play')}>{nativeAlbumBusy==='play'?'Đang phát…':'Phát album'} <span aria-hidden="true">▶</span></button>
        <button type="button" disabled={!!nativeAlbumBusy} onClick={()=>void nativeAlbum('next')}>{nativeAlbumBusy==='next'?'Đang thêm…':'Phát tiếp theo'} <span aria-hidden="true">↳</span></button>
      </>}
      {e.kind==='song'&&<button type="button" onClick={find}>{findLabel} <span>⌕</span></button>}
      {e.kind==='song'&&<>
        <button type="button" data-menu-link disabled={!e.artist} onBlur={menuLink.cancel} onClick={event=>menuLink.tap('artist',event.detail,openArtist,()=>goDirect(goArtist))}>Go to Artist <span>›</span></button>
        <button type="button" data-menu-link disabled={!e.album} onBlur={menuLink.cancel} onClick={event=>menuLink.tap('album',event.detail,()=>open(albumShortcut({title:e.album,artist:e.albumArtist||e.artist,img:artwork?.albums?.[`${e.albumArtist||e.artist}\u001f${e.album}`] || e.image,onTap:goAlbum})),()=>goDirect(goAlbum))}>Go to Album <span>›</span></button>
        <button className="shortcut-playlist-included-toggle" type="button" aria-expanded={showIncludedPlaylists} aria-controls="shortcut-playlist-included" onClick={()=>setShowIncludedPlaylists(value=>!value)}>Playlist Included <span className="shortcut-action-tail">{includedPlaylists===null?'…':<>{includedPlaylists.length}<span aria-hidden="true">{showIncludedPlaylists?'⌃':'›'}</span></>}</span></button>
        {showIncludedPlaylists&&<div id="shortcut-playlist-included" className="shortcut-playlist-included" role="group" aria-label={`Playlist có bài ${e.title}`}>
          {includedPlaylists===null?<div className="shortcut-playlist-included-status" role="status">Đang tải playlist…</div>
            :includedPlaylistsError?<div className="shortcut-playlist-included-status" role="status">Chưa tải được danh sách playlist.</div>
            :includedPlaylists.length===0?<div className="shortcut-playlist-included-status">Không có trong playlist nào.</div>
            :includedPlaylists.map((playlist,index)=><button key={playlist.id} type="button" data-menu-link onBlur={menuLink.cancel} onClick={event=>menuLink.tap(`playlist:${playlist.id}`,event.detail,()=>setPlaylistMenu(playlist),()=>goDirect(()=>c.go('playlist',playlist.id)))}>
              <span className="shortcut-playlist-included-index" aria-hidden="true">{index+1}</span>
              <span className="shortcut-playlist-included-copy"><strong>{playlist.name}</strong><small>{playlist.path} · {playlist.items.length} bài</small></span>
              <span className="shortcut-playlist-included-chevron" aria-hidden="true">›</span>
            </button>)}
        </div>}
        {e.id&&<>
          <button type="button" disabled={rankWeight===undefined||rankWeightBusy} aria-expanded={showRankWeights} onClick={()=>setShowRankWeights(value=>!value)}>{rankWeightBusy||rankWeight===undefined?'Đang kiểm tra…':rankWeight<1?`Nghe kèm · tính ${Math.round(rankWeight*100)}%`:'Nghe kèm'} <span>{showRankWeights?'⌃':'›'}</span></button>
          {showRankWeights&&rankWeight!==undefined&&<div className="shortcut-rank-weight-picker" role="group" aria-label="Tỷ lệ lượt nghe dùng để xếp hạng">
            {[.7,.8,.9,1].map(weight=><button key={weight} type="button" className={rankWeight===weight?'on':''} disabled={rankWeightBusy} aria-pressed={rankWeight===weight} onClick={()=>void setContextualSongWeight(weight)}>{Math.round(weight*100)}%</button>)}
          </div>}
        </>}
      </>}
      {e.kind!=='song'&&<button type="button" onClick={find}>{findLabel} <span>⌕</span></button>}
      {e.kind==='album'&&<button type="button" data-menu-link disabled={!e.artist} onBlur={menuLink.cancel} onClick={event=>menuLink.tap('artist',event.detail,openArtist,()=>goDirect(goArtist))}>Go to Artist <span>›</span></button>}
      <button type="button" disabled={sharing||!e.artist||(e.kind!=='artist'&&!e.title)} onClick={()=>void music()}>{sharing?'Đang lấy liên kết…':'Open in Music'} <span>↗</span></button>
      {actions.map(action=><button key={action.label} type="button" onClick={()=>exit(()=>{onDismiss();void action.onRun();})}>{action.label} <span>{action.symbol || '›'}</span></button>)}
      {linkError&&<div className="shortcut-status t3" role="status">{linkError}</div>}
      <button type="button" className="shortcut-close" onClick={close}>Đóng</button>
      {playlistMenu&&<PlaylistShortcutSheet playlist={playlistMenu} c={c} back={()=>setPlaylistMenu(null)} close={onDismiss}/>}
    </div>
  </div>,document.body);
}

function PlaylistShortcutSheet({playlist,c,back:onBack,close:onDismiss}:{playlist:Playlist;c:Ctx;back:()=>void;close:()=>void}) {
  const {close,exit,motionProps}=useSheetMotion(onDismiss,'fade');
  const back=()=>exit(onBack,'fade');
  const swipeDismiss=useSheetSwipeDismiss(close);
  const [busy,setBusy]=useState<'pebble'|'play'|'next'|'music'|''>('');
  const [pebble,setPebble]=useState(!!(playlist.favorite || playlist.favourite));
  const run=async(kind:'pebble'|'play'|'next'|'music')=>{
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
      if(kind==='pebble')setPebble(nextPebble);
      c.ptoast(kind==='pebble'?(nextPebble?'Đã thêm playlist vào Pebble.':'Đã loại playlist khỏi Pebble.')
        :kind==='music'?'Đang mở playlist trong Apple Music.'
          :kind==='play'?'Đang phát playlist.':'Đã thêm playlist vào phát tiếp theo.');
      close();
    } catch(error) {
      c.ptoast(error instanceof Error?error.message:'Chưa thực hiện được.');
    } finally { setBusy(''); }
  };
  return createPortal(<div {...motionProps} className="shortcut-backdrop shortcut-nested-backdrop" onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <div {...swipeDismiss} role="dialog" aria-modal="true" aria-label={'Playlist actions: '+playlist.name} className="shortcut-sheet" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();back();}}}>
      <ShortcutSheetNav canBack back={back} close={close}/>
      <button type="button" className="shortcut-heading shortcut-heading-link" onClick={()=>exit(()=>{onDismiss();c.go('playlist',playlist.id);})}><strong>{playlist.name}</strong><span className="t3">{playlist.path} · {vn(playlist.items.length)} bài</span></button>
      <button type="button" disabled={!!busy} onClick={()=>void run('pebble')}>{busy==='pebble'?(pebble?'Đang loại…':'Đang thêm…'):(pebble?'Loại khỏi Pebble':'Thêm vào Pebble')} <span>{pebble?'−':'＋'}</span></button>
      <button type="button" disabled={!!busy} onClick={()=>void run('play')}>{busy==='play'?'Đang phát…':'Phát playlist'} <span aria-hidden="true">▶</span></button>
      <button type="button" disabled={!!busy} onClick={()=>void run('next')}>{busy==='next'?'Đang thêm…':'Phát tiếp theo'} <span aria-hidden="true">↳</span></button>
      <button type="button" disabled={!!busy} onClick={()=>void run('music')}>{busy==='music'?'Đang mở…':'Open in Music'} <span>↗</span></button>
      <button type="button" onClick={()=>exit(()=>{onDismiss();c.go('topPlaylists');})}>Go to Top playlist <span>▦</span></button>
      <button type="button" onClick={()=>{addPlaylistRankExclude(playlist);c.ptoast('Đã exclude playlist khỏi ranking.');close();}}>Exclude khỏi ranking <span>⊘</span></button>
      <button type="button" className="shortcut-close" onClick={close}>Đóng</button>
    </div>
  </div>,document.body);
}

export function RankFocus({c,rows,kind}:{c:Ctx;rows:any[];kind:'song'|'artist'}) {
  const focus=c.p.rankFocus;
  const match=focus?.kind===kind ? rows.slice(0,100).find(row=>shortcutKey(kind==='song'?songShortcut(row):artistShortcut(row))===focus.key) : undefined;
  const note=useRef<HTMLDivElement>(null), done=useRef<number>();
  useEffect(()=>{
    if(!match||!focus||done.current===focus.request)return;
    const frame=requestAnimationFrame(()=>{
      const el=Array.from((note.current?.parentElement?.querySelectorAll<HTMLElement>('[data-shortcut-key]') || [])).find(node=>node.dataset.shortcutKey===focus.key);
      if(el){el.scrollIntoView({block:'center'});el.focus({preventScroll:true});done.current=focus.request;}
    });
    return ()=>cancelAnimationFrame(frame);
  },[match,focus]);
  if(!focus||focus.kind!==kind)return null;
  return <div ref={note} className="rank-focus-note" role="status">{match ? `Đã tìm thấy “${focus.label}” · #${match.rank}` : `“${focus.label}” không nằm trong Top 100 All time.`}</div>;
}
