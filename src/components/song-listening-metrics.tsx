import type { ReactNode } from 'react';
import type { MetaItem } from '@/lib/metadata';
import { compactPlays } from './music-metadata';

export function songDurationSeconds(duration?:number,metadata?:MetaItem[]):number|undefined {
  if(typeof duration==='number' && Number.isFinite(duration) && duration>0)return duration;
  const label=metadata?.find(item=>item.title==='Độ dài bài hát')?.text;
  if(!label || !/^\d+:\d{2}$/.test(label))return undefined;
  const [minutes,seconds]=label.split(':').map(Number);
  return seconds<60?minutes*60+seconds:undefined;
}

export function SongListeningMetrics({plays,listening,duration,metadata,rankWeight,timeFirst=false,forceTimeFirst=false,hasChange=false,inline=false,children}:{
  plays?:string;listening?:string;duration?:number;metadata?:MetaItem[];rankWeight?:number;timeFirst?:boolean;forceTimeFirst?:boolean;hasChange?:boolean;inline?:boolean;children?:ReactNode;
}) {
  const showTimeFirst=(forceTimeFirst || (timeFirst && (songDurationSeconds(duration,metadata) ?? 0)>=360)) && !!listening;
  const count=compactPlays(plays);
  const weight=Number(rankWeight),deduction=Number.isFinite(weight)&&weight<1?Math.round((1-weight)*100):0;
  return <div className={`song-metrics num${hasChange?' has-change':''}${inline?' song-metrics-inline':''}${deduction?' has-rank-weight':''}`}>
    <strong title={showTimeFirst?'Thời gian đã nghe':'Lượt nghe'}>{showTimeFirst?listening:count}</strong>
    {listening && <span title={showTimeFirst?'Lượt nghe':'Thời gian đã nghe'}>{showTimeFirst?count:listening}</span>}
    {!!deduction&&<small className="song-rank-weight-note">−{deduction}%</small>}
    {children}
  </div>;
}
