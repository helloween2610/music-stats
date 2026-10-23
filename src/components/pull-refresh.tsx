import {useEffect,useRef,useState} from 'react';
import {refreshServerData} from '@/lib/api';
import {PullGesture} from '@/lib/pull-refresh';

export function PullRefresh({notify}:{notify:(message:string)=>void}) {
  const anchor=useRef<HTMLDivElement>(null);
  const notifyRef=useRef(notify);notifyRef.current=notify;
  const [distance,setDistance]=useState(0),[busy,setBusy]=useState(false);
  const busyRef=useRef(false);
  const run=async()=>{
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);
    try {
      const ok=await refreshServerData();
      notifyRef.current(ok?'Đã cập nhật dữ liệu':'Chưa tải được đầy đủ dữ liệu, đang giữ bản đã lưu');
    } finally {busyRef.current=false;setBusy(false);setDistance(0);}
  };
  const runRef=useRef(run);runRef.current=run;
  useEffect(()=>{
    const page=anchor.current?.closest<HTMLElement>('.zaui-page');
    if(!page)return;
    const gesture=new PullGesture();let suppressClickUntil=0;
    const cancel=()=>{gesture.cancel();setDistance(0);};
    const start=(event:TouchEvent)=>{
      if(busyRef.current || event.touches.length!==1)return cancel();
      const target=event.target as HTMLElement;
      if(target.closest('input,textarea,select,[role="slider"],.sheet'))return cancel();
      // A nested scroller has its own gesture; don't steal it.
      for(let node=target;node && node!==page;node=node.parentElement!) {
        if(node.scrollHeight>node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY))return cancel();
      }
      gesture.begin(event.touches[0].clientX,event.touches[0].clientY,page.scrollTop<=0);
    };
    const move=(event:TouchEvent)=>{
      if(event.touches.length!==1)return cancel();
      const amount=gesture.move(event.touches[0].clientX,event.touches[0].clientY);
      if(amount>0){if(event.cancelable)event.preventDefault();suppressClickUntil=Date.now()+500;}
      setDistance(amount);
    };
    const end=()=>{const ready=gesture.end();setDistance(0);if(ready)void runRef.current();};
    const click=(event:MouseEvent)=>{if(Date.now()<suppressClickUntil){event.preventDefault();event.stopPropagation();}};
    page.addEventListener('touchstart',start,{passive:true});
    page.addEventListener('touchmove',move,{passive:false});
    page.addEventListener('touchend',end);
    page.addEventListener('touchcancel',cancel);
    page.addEventListener('click',click,true);
    return()=>{
      page.removeEventListener('touchstart',start);page.removeEventListener('touchmove',move);
      page.removeEventListener('touchend',end);page.removeEventListener('touchcancel',cancel);page.removeEventListener('click',click,true);
    };
  },[]);
  return <div ref={anchor} className="pull-refresh" style={{height:busy?44:distance}}>
    <button className="pull-refresh-keyboard" onClick={()=>void run()} disabled={busy}>Cập nhật dữ liệu từ server</button>
    {(busy || distance>0) && <div role="status" aria-live="polite">{busy?'Đang cập nhật…':distance>=60?'Thả để cập nhật':'Kéo xuống để cập nhật'}</div>}
  </div>;
}
