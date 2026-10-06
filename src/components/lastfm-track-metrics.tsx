import { useEffect, useRef, useState } from 'react';
import { vn } from '@/lib/fmt';
import { loadLastfmTrack, type LastfmTrackStats } from '@/lib/discovery';

export function LastfmTrackMetrics({artist,title,trackId,disabled=false,outsideLibrary=false}:{artist:string;title:string;trackId?:string;disabled?:boolean;outsideLibrary?:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
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
  },[visible,artist,title,trackId,disabled]);
  const missing=error || (data ? 'Last.fm chưa có dữ liệu' : disabled || !artist ? 'Chưa có thông tin bài hát' : 'Đang tải Last.fm');
  return <div ref={ref} className="song-metrics num">
    <LastfmMetricValues scrobbles={data?.scrobbles} listeners={data?.listeners} missing={missing} outsideLibrary={outsideLibrary}/>

  </div>;
}

export function LastfmMetricValues({scrobbles,listeners,outsideLibrary=false,missing='Last.fm chưa có dữ liệu'}:{scrobbles?:number;listeners?:number;outsideLibrary?:boolean;missing?:string}) {
  return <>
    <strong title={scrobbles==null?missing:'Tổng scrobbles trên Last.fm'} aria-label={`Scrobbles Last.fm: ${scrobbles==null?'chưa có dữ liệu':vn(scrobbles)}`}>{scrobbles==null?'—':vn(scrobbles)}</strong>
    <LastfmListenRatio scrobbles={scrobbles} listeners={listeners}/>
    {outsideLibrary && <span className="outside-library-icon" role="img" aria-label="Chưa có trong thư viện">+</span>}
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
