import type {UI} from '@/state';

const shellOnly=new Set(['tab','views','pageParents','ptoast']);
export function sameViewModelInput(previous:UI,current:UI) {
  const keys=Object.keys(current).filter(key=>!shellOnly.has(key)) as (keyof UI)[];
  return keys.length===Object.keys(previous).filter(key=>!shellOnly.has(key)).length
    && keys.every(key=>Object.prototype.hasOwnProperty.call(previous,key) && previous[key]===current[key]);
}
