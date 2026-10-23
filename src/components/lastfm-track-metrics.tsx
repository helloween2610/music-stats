import { useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { vn } from '@/lib/fmt';
import { lastfmTrackRefreshSnapshot, loadAppleDetail, loadLastfmTrack, refreshLastfmTrackStats, subscribeLastfmTrackRefresh, type AppleDetailQuery, type LastfmTrackQuery, type LastfmTrackStats } from '@/lib/discovery';
import { appleMusicStoreId } from '@/lib/apple-music-opening';
import { addTrackToLibraryInNativeApp } from '@/lib/ios-bridge';

type AddToLibrary = { query?: AppleDetailQuery; notify?: (message:string)=>void };

export function LastfmTrackMetrics({artist,title,trackId,disabled=false,outsideLibrary=false,addToLibrary}:{artist:string;title:string;trackId?:string;disabled?:boolean;outsideLibrary?:boolean;addToLibrary?:AddToLibrary}) {
  const ref=useRef<HTMLDivElement>(null);
  const refreshVersion=useSyncExternalStore(subscribeLastfmTrackRefresh,lastfmTrackRefreshSnapshot,lastfmTrackRefreshSnapshot);
  const [visible,setVisible]=useState(false),[data,setData]=useState<LastfmTrackStats|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    if(!ref.current || !('IntersectionObserver' in window)){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}
    },{rootMargin:'100px'});
    observer.observe(ref.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    setData(null);setError('');
    if(!visible || disabled || !artist || !title)return;
    const controller=new AbortController();
    let retry:ReturnType<typeof setTimeout>|undefined;
    const load=(canRetry:boolean)=>loadLastfmTrack({artist,title,trackId},controller.signal).then(value=>{
      if(!controller.signal.aborted){setData(value);setError('');}
    }).catch(e=>{
      if(controller.signal.aborted)return;
      setError('Chưa tải được số liệu Last.fm');
      if(canRetry)retry=setTimeout(()=>void load(false),Math.max(30000,(e.retryAt||0)-Date.now()));
    });
    void load(true);
    return()=>{controller.abort();clearTimeout(retry);};
  },[visible,artist,title,trackId,disabled,refreshVersion]);
  const missing=error || (data ? 'Last.fm chưa có dữ liệu' : disabled || !artist ? 'Chưa có thông tin bài hát' : 'Đang tải Last.fm');
  return <div ref={ref} className="song-metrics num">
    <LastfmMetricValues scrobbles={data?.scrobbles} listeners={data?.listeners} missing={missing} outsideLibrary={outsideLibrary} addToLibrary={addToLibrary}/>

  </div>;
}

export function LastfmScrobbleRefreshButton({notify,label='Tải lại scrobble Last.fm',tracks}:{notify?:(message:string)=>void;label?:string;tracks?:LastfmTrackQuery[]}) {
  return <button type="button" className="btn-wide btn-subtle lastfm-refresh-button" onClick={()=>{
    refreshLastfmTrackStats(tracks);
    notify?.('Đang tải lại scrobble Last.fm…');
  }}>{label}</button>;
}

export function LastfmMetricValues({scrobbles,listeners,outsideLibrary=false,missing='Last.fm chưa có dữ liệu',addToLibrary}:{scrobbles?:number;listeners?:number;outsideLibrary?:boolean;missing?:string;addToLibrary?:AddToLibrary}) {
  const [adding,setAdding]=useState(false),[added,setAdded]=useState(false);
  async function add(event:SyntheticEvent<HTMLElement>) {
    event.preventDefault();event.stopPropagation();
    if(adding || added || !addToLibrary?.query)return;
    setAdding(true);
    try {
      addToLibrary.notify?.('Đang thêm vào Apple Music Library…');
      const result=await loadAppleDetail(addToLibrary.query);
      const storeId=appleMusicStoreId(result.url);
      if(!storeId)throw new Error('Chưa lấy được ID Apple Music của bài này.');
      const ok=await addTrackToLibraryInNativeApp({...addToLibrary.query,storeId});
      if(!ok)throw new Error('Chỉ thêm trực tiếp được trong app iOS.');
      setAdded(true);
      addToLibrary.notify?.('Đã thêm vào Apple Music Library.');
    } catch(error) {
      addToLibrary.notify?.(error instanceof Error ? error.message : 'Chưa thêm được vào Apple Music Library.');
    } finally {
      setAdding(false);
    }
  }
  return <>
    <strong title={scrobbles==null?missing:'Tổng scrobbles trên Last.fm'} aria-label={`Scrobbles Last.fm: ${scrobbles==null?'chưa có dữ liệu':vn(scrobbles)}`}>{scrobbles==null?'—':vn(scrobbles)}</strong>
    <LastfmListenRatio scrobbles={scrobbles} listeners={listeners}/>
    {outsideLibrary && (addToLibrary?.query
      ? <span role="button" tabIndex={adding||added?-1:0} className="outside-library-icon outside-library-add" aria-disabled={adding||added} onPointerDown={event=>event.stopPropagation()} onClick={add} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){void add(event);}}} aria-label={added?'Đã thêm vào thư viện':'Thêm vào Apple Music Library'} title={added?'Đã thêm vào thư viện':'Thêm vào Apple Music Library'}>{adding?'…':added?'✓':'+'}</span>
      : <span className="outside-library-icon" role="img" aria-label="Chưa có trong thư viện">+</span>)}
  </>;
}

export function LastfmListenRatio({scrobbles,listeners}:{scrobbles?:number;listeners?:number}) {
  if(scrobbles==null || listeners==null || !Number.isFinite(scrobbles) || !Number.isFinite(listeners) || scrobbles<0 || listeners<=0)return null;
  const ratio=scrobbles/listeners;
  if(!Number.isFinite(ratio))return null;
  const value=ratio.toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1});
  return <span className="lastfm-listen-ratio" title="Scrobbles / số người nghe trên Last.fm" aria-label={`${value} lượt nghe trung bình mỗi người trên Last.fm`}>
    <svg className="lastfm-metric-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h8m-2-2 2 2-2 2M13 9v2a2 2 0 0 1-2 2H3m2-2-2 2 2 2"/></svg>
    {value}
  </span>;
}
