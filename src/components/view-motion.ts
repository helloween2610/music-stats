import {useEffect,useRef} from 'react';
import type {UI} from '@/state';
import {shouldReduceMotion} from '@/lib/motion-preference';

const viewFields = [
  'playlistSort','playlistListSort','playlistFolder','releaseMode','trendMode','trendAsOf',
  'filter','periodSort','periodFilter','artistFilter','artistRankAsOf','songRankAsOf',
  'albumFilter','albumRankAsOf','albumSort','songView','sort','scope',
] as const satisfies readonly (keyof UI)[];

export function viewMotionKey(view:UI,loading:boolean) {
  return JSON.stringify([...viewFields.map(field=>view[field]),loading]);
}

/** Animate changed views in place, preserving scroll, focus and chart state. */
export function useViewMotion(key:string,enabled=true) {
  const node=useRef<HTMLDivElement>(null);
  const previous=useRef(key);
  useEffect(()=>{
    const changed=previous.current!==key;
    previous.current=key;
    if(!changed || !enabled || !node.current?.animate || shouldReduceMotion())return;
    const animation=node.current.animate([
      {opacity:.65,transform:'translate3d(0,6px,0)'},
      {opacity:1,transform:'translate3d(0,0,0)'},
    ],{duration:180,easing:'cubic-bezier(.22,.7,.2,1)'});
    return()=>animation.cancel();
  },[key,enabled]);
  return node;
}
