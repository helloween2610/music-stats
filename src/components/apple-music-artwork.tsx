import { ShortcutTarget, type ShortcutEntity } from './shortcuts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BROWSER_PREVIEW } from '@/config';
import { loadAppleDetail, type AppleDetailQuery } from '@/lib/discovery';
import { shareAppleMusicLink } from '@/lib/apple-music-opening';

export function AppleMusicArtwork({query,children,notify,round=false,className,lazy=false,shortcut}: {
  query: AppleDetailQuery; children: ReactNode; notify:(message:string)=>void; round?:boolean; className?:string; lazy?:boolean; shortcut?:ShortcutEntity;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const {kind,artist,title,album,releaseId,trackId} = query;
  const key = JSON.stringify([kind,artist,title,album,releaseId,trackId]);
  const [resolved,setResolved] = useState<{key:string;url:string}|null>(null);
  const [sharing,setSharing] = useState(false);
  const busy = useRef(false);
  useEffect(()=>{
    // Dense song lists previously searched every visible row. Keep eager loading
    // for primary cards, but resolve lazy rows only after the user's tap/menu.
    if (lazy || !artist || (kind !== 'artist' && !title)) return;
    let active=true;
    void loadAppleDetail({kind,artist,title,album,releaseId,trackId}).then(result=>{
      if(active)setResolved({key,url:result.url});
    }).catch(()=>{}); // A later tap can retry; never substitute a search link.
    return ()=>{active=false;};
  },[lazy,key,kind,artist,title,album,releaseId,trackId]);
  async function share() {
    if(busy.current)return;
    if (!artist || (kind !== 'artist' && !title)) {notify('Chưa đủ thông tin để tìm trên Apple Music.');return;}
    busy.current=true;setSharing(true);
    let url=resolved?.key===key ? resolved.url : '';
    if(resolved?.key !== key) {
      notify('Đang lấy liên kết Apple Music…');
      try {
        const result=await loadAppleDetail(query);
        setResolved({key,url:result.url});
        url=result.url;
      } catch(error) {
        notify(error instanceof Error ? error.message : 'Chưa lấy được liên kết Apple Music. Hãy thử lại.');
        busy.current=false;setSharing(false);return;
      }
    }
    try {
      if(typeof navigator.share === 'function') await shareAppleMusicLink(url,navigator);
      else if(BROWSER_PREVIEW) window.open(url,'_blank','noopener,noreferrer');
      else {await navigator.clipboard.writeText(url);notify('Đã sao chép liên kết. Chạy Shortcut hoặc dán vào Safari.');}
    } catch(error) {
      if(!(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) notify('Chưa chia sẻ được liên kết. Chạm lại ảnh để thử lại.');
    } finally {busy.current=false;setSharing(false);}
  }
  const content=<button type="button" ref={button} className={className ?? ('apple-music-artwork'+(round?' round':''))} onClick={()=>void share()} disabled={sharing} aria-busy={sharing}
    aria-label={`Chia sẻ liên kết Apple Music: ${kind !== 'artist' ? title : artist}`}>{children}</button>;
  return <ShortcutTarget entity={shortcut || {kind,id:trackId,artist,title:kind==='artist'?artist:title || '',album,releaseId}}>{content}</ShortcutTarget>;
}
