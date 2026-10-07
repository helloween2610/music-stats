import { cloneElement, createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Ctx } from '@/vm';
import { BROWSER_PREVIEW } from '@/config';
import { albumId } from '@/lib/albums';
import { loadAppleDetail, type AppleDetailQuery } from '@/lib/discovery';
import { shareAppleMusicLink } from '@/lib/apple-music-opening';
import { longPress } from '@/lib/long-press';
import { MusicMetadata, compactPlays } from '@/components/music-metadata';
import type { MetaItem } from '@/lib/metadata';

export type ShortcutEntity = {
  kind:'song'|'artist'|'album'; title:string; artist:string; id?:string; album?:string; albumArtist?:string;
  releaseId?:string; detail?:()=>void; goAlbum?:()=>void; image?:string; initials?:string; metadata?:MetaItem[];
  plays?:string; listening?:string; titleTone?:string; actionsOnly?:boolean;
};
export const shortcutKey = (e:ShortcutEntity) => JSON.stringify([e.kind,e.kind==='song' ? e.id || [e.artist,e.title] : e.kind==='artist' ? e.artist : [e.artist,e.title]]);
export const songShortcut = (r:any):ShortcutEntity => {
  const rawPlays=r.allTimeMetric ?? r.metric ?? r.v;
  const plays=rawPlays==null||rawPlays===''?undefined:compactPlays(typeof rawPlays==='number'?`${rawPlays.toLocaleString('vi-VN')} lượt`:String(rawPlays));
  return {kind:'song',id:r.tid,title:r.title || '',artist:r.artist || '',album:r.album,albumArtist:r.albumArtist,releaseId:r.releaseId,
    detail:!r.unmatched ? r.onTap : undefined,goAlbum:r.goAlbum,image:r.img,initials:r.ini || r.title?.slice(0,2)?.toUpperCase(),
    metadata:r.allTimeMetadata ?? r.metadata,plays,listening:r.allTimeListening ?? r.listening,titleTone:r.titleTone,actionsOnly:!!r.shortcutActionsOnly};
};
export const artistShortcut = (r:any):ShortcutEntity => {
  const primary=r.big ?? r.v;
  const secondary=r.small;
  const secondaryIsPlays=/^[\d.,]+(?: lượt|x)$/.test(String(secondary || ''));
  const fallback=String(r.sub || '').split(' · ');
  return {kind:'artist',title:r.name || r.an || r.title || '',artist:r.an || r.name || r.title || '',detail:r.onTap,
    image:r.img,initials:r.ini || (r.name || r.an || r.title || '').slice(0,2).toUpperCase(),metadata:r.allTimeMetadata ?? r.metadata,titleTone:r.titleTone,
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
  return {kind:'album',title:r.title || '',artist:r.artist || r.ak?.split('\u001f')[0] || '',releaseId:r.releaseId,detail:r.onTap,
    image:r.img || r.cover,initials:r.ini || r.title?.slice(0,2)?.toUpperCase(),metadata,titleTone:r.titleTone,
    plays:compactPlays(String(r.allTimeMetric ?? providedPlays ?? (playsIsCount?r.plays:r.v) ?? '')) || undefined,
    listening:r.allTimeListening ?? (compactPlays(String(providedListening ?? (playsIsCount?r.v:r.plays) ?? '')) || undefined)};
};
const ShortcutContext = createContext<{open:(entity:ShortcutEntity)=>void;focusKey?:string}|null>(null);

/** Clone a DOM target so rows/cards retain their layout and ordinary tap behavior. */
export function ShortcutTarget({entity,children}:{entity:ShortcutEntity;children:ReactElement<any>}) {
  const context=useContext(ShortcutContext);
  const latest=useRef(()=>{}); latest.current=()=>context?.open(entity);
  const gesture=useRef<ReturnType<typeof longPress>>();
  if(!gesture.current)gesture.current=longPress(()=>latest.current());
  useEffect(()=>()=>gesture.current?.cancel(),[]);
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
    onClickCapture:(e:React.MouseEvent)=>{if(gesture.current!.consumeClick()){e.preventDefault();e.stopPropagation();}else old.onClickCapture?.(e);},
    onContextMenu:(e:React.MouseEvent)=>{e.preventDefault();e.stopPropagation();gesture.current!.blockClick();latest.current();},
    onDragStart:(e:React.DragEvent)=>e.preventDefault(),
    onKeyDown:(e:React.KeyboardEvent)=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();e.stopPropagation();latest.current();}else old.onKeyDown?.(e);},
  });
}

export function ShortcutProvider({c,children}:{c:Ctx;children:ReactNode}) {
  const [entity,setEntity]=useState<ShortcutEntity|null>(null);
  useEffect(()=>setEntity(null),[c.screen,c.id]);
  return <ShortcutContext.Provider value={{open:setEntity,focusKey:c.p.rankFocus?.key}}>
    {children}
    {entity && <ShortcutSheet key={shortcutKey(entity)} entity={entity} c={c} close={()=>setEntity(null)}/>}
  </ShortcutContext.Provider>;
}

function ShortcutEntityHeader({entity:e,onDetail,canDetail}:{entity:ShortcutEntity;onDetail:()=>void;canDetail:boolean}) {
  const duration=e.metadata?.find(item=>item.title==='Độ dài bài hát')?.text;
  const label=e.kind==='song'?'Bài hát':e.kind==='artist'?'Nghệ sĩ':'Album';
  return <div className={`shortcut-song-card shortcut-${e.kind}-card${canDetail?' shortcut-song-card-action':''}`} role={canDetail?'button':undefined} tabIndex={canDetail?0:undefined}
    aria-label={canDetail?`Mở chi tiết ${label.toLowerCase()}: ${e.title}`:undefined} aria-disabled={canDetail?undefined:true}
    onClick={canDetail?onDetail:undefined} onKeyDown={canDetail?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onDetail();}}:undefined}>
    <div className="shortcut-song-cover">
      {e.image?<img src={e.image} alt={`Bìa ${e.album || e.title}`} />:<span aria-hidden="true">{e.initials || e.title.slice(0,2).toUpperCase() || '♫'}</span>}
    </div>
    <div className="shortcut-song-details">
      <div className="shortcut-song-summary">
        <div className="shortcut-song-copy">
          <div className="shortcut-song-label">{label}</div>
          <div className={`shortcut-song-title tone-${e.titleTone || 'gray'}`}>{e.title}{duration&&<span className="shortcut-song-duration num">{duration}</span>}</div>
          {e.kind!=='artist'&&<div className="shortcut-song-artist ell">{e.artist}</div>}
          {(e.kind==='song'&&e.album||e.metadata?.length)&&<div className="shortcut-song-album-line">
            {e.album&&<span className="shortcut-song-album ell">{e.album}</span>}
            <MusicMetadata items={e.metadata}/>
          </div>}
        </div>
        {(e.plays||e.listening)&&<div className="shortcut-song-metrics num">
          {e.plays&&<strong>{e.plays}</strong>}
          {e.listening&&<span>{e.listening}</span>}
        </div>}
      </div>
    </div>
  </div>;
}

function ShortcutSheet({entity:e,c,close}:{entity:ShortcutEntity;c:Ctx;close:()=>void}) {
  const panel=useRef<HTMLDivElement>(null), busy=useRef(false);
  const [link,setLink]=useState(''), [sharing,setSharing]=useState(false);
  const [linkError,setLinkError]=useState('');
  const query:AppleDetailQuery={kind:e.kind,artist:e.artist,title:e.title,album:e.album,releaseId:e.releaseId,trackId:e.id};
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow; document.body.style.overflow='hidden';
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return ()=>{document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  const detail=()=>{
    close();
    if(e.detail)e.detail();
    else if(e.kind==='album')c.go('album',albumId(e.artist,e.title));
    else if(e.kind==='artist')c.go('artist',e.artist);
    else if(e.id)c.go('song',e.id);
  };
  const find=()=>{
    if(e.kind==='album') { close(); c.go('periodTop','albums~all'); return; }
    c.set(()=>({rankFocus:{key:shortcutKey(e),kind:e.kind as 'song'|'artist',label:e.title,request:Date.now()}}));
    close(); c.go(e.kind==='song'?'top100':'artistsAll');
  };
  const findLabel=e.kind==='song'?'Find in Top 100 All time':e.kind==='artist'?'Find in Top 32 Artist All time':'Find in Top 24 Album All time';
  async function music() {
    if(busy.current||!e.artist||(e.kind!=='artist'&&!e.title))return;
    busy.current=true;setSharing(true);
    let url=link;
    try {
      setLinkError('');
      if(!url){const result=await loadAppleDetail(query);url=result.url;setLink(url);}
      if(typeof navigator.share==='function')await shareAppleMusicLink(url,navigator);
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
  return createPortal(<div className="shortcut-backdrop" onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label={'Shortcut actions: '+e.title} className="shortcut-sheet" onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){
        const buttons=Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        const first=buttons[0],last=buttons[buttons.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }}>
      <div className="shortcut-handle"/>
      {!e.actionsOnly&&<ShortcutEntityHeader entity={e} onDetail={detail} canDetail={e.kind==='song'?!!(e.id||e.detail):!!(e.title||e.artist)}/>}
      {e.kind==='song'&&<>
        <button type="button" disabled={!e.artist} onClick={()=>{close();c.go('artist',e.artist);}}>Go to Artist <span>›</span></button>
        <button type="button" disabled={!e.album&&!e.goAlbum} onClick={()=>{close();if(e.goAlbum)e.goAlbum();else c.go('album',albumId(e.albumArtist||e.artist,e.album!));}}>Go to Album <span>›</span></button>
      </>}
      <button type="button" onClick={find}>{findLabel} <span>⌕</span></button>
      <button type="button" disabled={sharing||!e.artist||(e.kind!=='artist'&&!e.title)} onClick={()=>void music()}>{sharing?'Đang lấy liên kết…':'Open in Music'} <span>↗</span></button>
      {linkError&&<div className="shortcut-status t3" role="status">{linkError}</div>}
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
