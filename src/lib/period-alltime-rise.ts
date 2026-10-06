import { addDays, per } from './fmt';
import { comparisonPeriod } from './period-top';

export function allTimeRiseWindow(scope:string, asOf:string) {
  const lastDay=(year:number,month:number)=>new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  const month=/^\d{4}-\d{2}$/.test(scope), year=/^\d{4}$/.test(scope);
  const end=month?lastDay(Number(scope.slice(0,4)),Number(scope.slice(5))):year?`${scope}-12-31`:asOf;
  const before=month||year?addDays(`${scope}${year?'-01':''}-01`,-1):comparisonPeriod(scope,asOf).asOf;
  return {before,end:end<asOf?end:asOf};
}

export function allTimeRankChanges(current:any[], previous:any[], key:(row:any)=>string) {
  const before=new Map(previous.map(row=>[key(row),row.rank]));
  return new Map(current.flatMap(row=>{
    const old=before.get(key(row));
    return Number.isInteger(old)&&old>0&&Number.isInteger(row.rank)&&row.rank>0?[[key(row),old-row.rank] as [string,number]]:[];
  }));
}

// Closed months use the saved All time snapshots, just like monthly rising-song groups.
export function songAllTimeComparisons(history:any, before:string, end:string) {
  const closed=end.slice(0,7)<String(history?.asOf || '').slice(0,7);
  const rows=history?.rows || [];
  const at=(row:any,date:string)=>row.history?.find((p:any)=>per(p.period)===per(date.slice(0,7)))?.rank;
  return new Map<string,{previous:number;current:number;change:number;history:any[]}>(rows.flatMap((r:any)=>{
    const previous=at(r,before), current=closed?at(r,end):r.rank;
    if (!(Number.isInteger(previous)&&previous>0&&Number.isInteger(current)&&current>0)) return [];
    const points=(r.history || []).filter((p:any)=>{
      const label=/^T(\d{2})\/(\d{2})$/.exec(per(p.period));
      return label && `20${label[2]}-${label[1]}` <= end.slice(0,7);
    });
    return [[r.track_id,{previous,current,change:previous-current,history:points}]];
  }));
}

export function songAllTimeChanges(history:any, before:string, end:string) {
  return new Map([...songAllTimeComparisons(history,before,end)].map(([id,r])=>[id,r.change]));
}
