import { Fragment } from 'react';

const valid=(rank?:number)=>Number.isInteger(rank) && rank!>0;

function RankArrow({from,to}:{from?:number;to?:number}) {
  const change=valid(from) && valid(to)?from!-to!:0;
  return <span className={change>0?'rank-up':change<0?'rank-down':''} aria-hidden="true">▶</span>;
}

export function SongRankProgress({best,previous,current,previousPeriod}:{best?:number;previous?:number;current?:number;previousPeriod?:string}) {
  const label=(rank?:number)=>valid(rank)?`#${rank}`:'—';
  const previousTitle=`Hạng khác hiện tại gần nhất${previousPeriod?` (${previousPeriod})`:''}`;
  const currentChange=valid(previous) && valid(current)?previous!-current!:0;
  const points=[
    {rank:best,title:'Hạng tốt nhất',className:'rank-best'},
    {rank:previous,title:previousTitle,className:'rank-down'},
    {rank:current,title:'Hạng hiện tại',className:currentChange>0?'rank-up':currentChange<0?'rank-down':''},
  ].reduce<{rank?:number;title:string;className:string}[]>((result,point)=>{
      const last=result[result.length-1];
      if(last && valid(point.rank) && last.rank===point.rank)last.title+=` · ${point.title}`;
      else result.push({...point});
      return result;
    },[]);
  return <div className="song-rank-progress num" aria-label={`Hạng tốt nhất ${label(best)}; ${previousTitle.replace('Hạng','hạng')} ${label(previous)}; hạng hiện tại ${label(current)}`}>
    {points.map((point,index)=><Fragment key={index}>
      {index>0 && <RankArrow from={points[index-1].rank} to={point.rank}/>}
      <strong className={valid(point.rank)?point.className:undefined} title={point.title}>{valid(point.rank)?point.rank:'—'}</strong>
    </Fragment>)}
  </div>;
}
