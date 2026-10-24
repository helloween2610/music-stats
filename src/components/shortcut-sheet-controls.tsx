import { useCallback, useEffect, useRef, useState, type AnimationEvent, type MouseEvent, type PointerEvent, type TouchEvent } from 'react';
import {SheetGesture} from '@/lib/sheet-gesture';
import {shouldReduceMotion} from '@/lib/motion-preference';

export function useMenuLinkTap() {
  const pending=useRef<{key:string;timer:ReturnType<typeof setTimeout>}>();
  const cancel=useCallback(()=>{
    clearTimeout(pending.current?.timer);
    pending.current=undefined;
  },[]);
  useEffect(()=>cancel,[cancel]);
  const tap=(key:string,clickDetail:number,openMenu:()=>void,openPage:()=>void)=>{
    const secondTap=pending.current?.key===key;
    cancel();
    if(clickDetail===0){openMenu();return;}
    if(secondTap){openPage();return;}
    pending.current={key,timer:setTimeout(()=>{pending.current=undefined;openMenu();},300)};
  };
  return {tap,cancel};
}

export function useSheetMotion(onClose:()=>void, entry:'slide'|'fade'='slide') {
  const [closing,setClosing]=useState(false);
  const [exitMode,setExitMode]=useState<'slide'|'fade'>('slide');
  const [ready,setReady]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout>>();
  const pending=useRef(false);
  const latest=useRef(onClose); latest.current=onClose;
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{
    // Keep synchronous chart/playlist work off the entrance animation's first frames.
    const fallback=setTimeout(()=>{if(!pending.current)setReady(true);},shouldReduceMotion()?0:entry==='fade'?180:540);
    return()=>clearTimeout(fallback);
  },[entry]);
  const exit=useCallback((action:()=>void, mode:'slide'|'fade'='slide')=>{
    if(pending.current)return;
    pending.current=true;
    setExitMode(mode);
    setClosing(true);
    const reduced=shouldReduceMotion();
    timer.current=setTimeout(action,reduced?0:mode==='fade'?80:180);
  },[]);
  const close=useCallback(()=>exit(()=>latest.current()),[exit]);
  return {close,exit,ready,motionProps:{
    'data-closing':closing || undefined,
    'data-entered':ready || undefined,
    'data-entry':entry,
    'data-exit':exitMode,
    onAnimationEnd:(event:AnimationEvent<HTMLElement>)=>{
      if(['sheet-in','sheet-crossfade-in'].includes(event.animationName) && !pending.current)setReady(true);
    },
    onClickCapture:(event:MouseEvent<HTMLElement>)=>{
      if(pending.current){event.preventDefault();event.stopPropagation();}
    },
  }};
}

export function ShortcutSheetNav({canBack = false, back, close}:{canBack?:boolean;back?:()=>void;close:()=>void}) {
  return <div className="shortcut-sheet-nav">
    {canBack?<button type="button" aria-label="Quay lại menu trước" title="Quay lại" onClick={back || close}>‹</button>:<span/>}
    <div className="shortcut-handle"/>
    <button type="button" aria-label="Đóng menu" title="Đóng" onClick={close}>×</button>
  </div>;
}

/** Only dismiss a downward gesture started at the top; scrolling content stays scrollable. */
export function useSheetSwipeDismiss(close:()=>void) {
  const gesture=useRef(new SheetGesture());
  const sheetRef=useRef<HTMLDivElement|null>(null);
  const releaseListener=useRef<()=>void>();
  const settling=useRef<Animation>();
  const moved = useRef(false);
  useEffect(()=>()=>{releaseListener.current?.();settling.current?.cancel();},[]);
  const restore=()=>{
    releaseListener.current?.();releaseListener.current=undefined;
    const sheet=sheetRef.current;
    if(!sheet?.style)return;
    const offset=gesture.current.offset;
    const backdrop=sheet.parentElement;
    sheet.style.setProperty('--sheet-drag-y','0px');
    backdrop?.style.removeProperty('--sheet-dim');
    const finish=()=>{delete sheet.dataset.dragging;sheet.style.removeProperty('--sheet-drag-y');};
    if(offset>0 && sheet.animate && !shouldReduceMotion()){
      settling.current=sheet.animate([{transform:`translate3d(0,${offset}px,0)`},{transform:'translate3d(0,0,0)'}],{duration:300,easing:'cubic-bezier(.2,.8,.2,1)'});
      settling.current.onfinish=finish;
    }else finish();
  };
  const cancel=()=>{restore();gesture.current.cancel();};
  const begin = (sheet:HTMLDivElement,x:number,y:number,at:number,target?:EventTarget|null) => {
    cancel();settling.current?.cancel();
    moved.current=false;
    sheetRef.current=sheet;
    if(sheet.scrollTop>0 || (target as Element)?.closest?.('input,textarea,select,[role="slider"],.shortcut-history-body'))return;
    gesture.current.begin(x,y,at);
    const prevent=(event:globalThis.TouchEvent)=>{if(gesture.current.active && event.cancelable)event.preventDefault();};
    sheet.addEventListener?.('touchmove',prevent,{passive:false});
    releaseListener.current=()=>sheet.removeEventListener?.('touchmove',prevent);
  };
  const move = (x:number,y:number,at:number) => {
    if(!gesture.current.move(x,y,at))return;
    moved.current=true;
    const sheet=sheetRef.current;
    if(!sheet?.style)return;
    sheet.dataset.resting='true';
    sheet.dataset.dragging='true';
    sheet.style.setProperty('--sheet-drag-y',`${gesture.current.offset}px`);
    sheet.parentElement?.style.setProperty('--sheet-dim',String(Math.max(.12,1-gesture.current.offset/sheet.offsetHeight)));
  };
  const end = (x:number,y:number,at:number) => {
    move(x,y,at);
    releaseListener.current?.();releaseListener.current=undefined;
    if(gesture.current.end(sheetRef.current?.offsetHeight || 0,at))close();
    else {restore();gesture.current.cancel();}
  };
  return {
    onTouchStartCapture:(e:TouchEvent<HTMLDivElement>)=>{if(e.touches.length===1)begin(e.currentTarget,e.touches[0].clientX,e.touches[0].clientY,e.timeStamp,e.target);else cancel();},
    onTouchMoveCapture:(e:TouchEvent<HTMLDivElement>)=>{if(e.touches.length===1)move(e.touches[0].clientX,e.touches[0].clientY,e.timeStamp);else cancel();},
    onTouchEndCapture:(e:TouchEvent<HTMLDivElement>)=>{const t=e.changedTouches[0];if(t)end(t.clientX,t.clientY,e.timeStamp);},
    onTouchCancelCapture:cancel,
    onPointerDownCapture:(e:PointerEvent<HTMLDivElement>)=>{if(e.pointerType==='mouse'&&e.button===0)begin(e.currentTarget,e.clientX,e.clientY,e.timeStamp,e.target);},
    onPointerMoveCapture:(e:PointerEvent<HTMLDivElement>)=>{if(e.pointerType==='mouse'){move(e.clientX,e.clientY,e.timeStamp);if(gesture.current.active)e.currentTarget.setPointerCapture?.(e.pointerId);}},
    onPointerUpCapture:(e:PointerEvent<HTMLDivElement>)=>{if(e.pointerType==='mouse')end(e.clientX,e.clientY,e.timeStamp);},
    onPointerCancelCapture:cancel,
    onClickCapture:(e:MouseEvent<HTMLDivElement>)=>{if(moved.current){moved.current=false;e.preventDefault();e.stopPropagation();}},
  };
}
