// Carry the last recorded rank through missing months; leave leading months empty.
export function songRankTimeline(history: {period:string;rank:number}[], asOf:string, currentRank?:number) {
  const end=asOf.slice(0,7), points=new Map<string,number>();
  for(const point of history){
    const match=/^T(\d{2})\/(\d{2})$/.exec(point.period);
    const month=match?`20${match[2]}-${match[1]}`:point.period.slice(0,7);
    if(Number.isFinite(point.rank) && point.rank>0)points.set(month,point.rank);
  }
  const labels:string[]=[], ranks:(number|null)[]=[];
  let previousRank:number|null=null;
  for(let year=2024,month=5;`${year}-${String(month).padStart(2,'0')}`<end;month++){
    if(month>12){year++;month=1;}
    const ym=`${year}-${String(month).padStart(2,'0')}`;
    if(ym>=end)break;
    labels.push(`${String(month).padStart(2,'0')}/${String(year).slice(-2)}`);
    previousRank=points.get(ym)??previousRank;
    ranks.push(previousRank);
  }
  labels.push('Hiện tại');
  ranks.push(currentRank && currentRank>0?currentRank:null);
  return {labels,ranks};
}

// Color reflects the current rank, independent of the selected historical month.
export function songRankColor(rank?:number|null):string {
  if(!rank || !Number.isFinite(rank) || rank<1)return 'var(--text2)';
  if(rank<=10)return 'var(--rank-chart-gold)';
  if(rank<=50)return 'var(--rank-chart-green)';
  if(rank<=80)return 'var(--rank-chart-blue)';
  if(rank<=100)return 'var(--text2)';
  return 'var(--rank-chart-muted)';
}


// Songs fill the two historical gaps; artist charts can carry every missing month forward.
export function ranksWithHistoricalGaps(history:{period:string;rank:number|null}[],periods:string[],carryAllMissingMonths=false){
  const points=new Map(history.map(point=>{
    const match=/^T(\d{2})\/(\d{2})$/.exec(point.period);
    return [match?`20${match[2]}-${match[1]}`:point.period.slice(0,7),point.rank] as const;
  }));
  let previous:number|null=null;
  return periods.map(period=>{
    const rank=points.get(period);
    previous=rank!=null?rank:(carryAllMissingMonths||period==='2024-08'||period==='2024-09')?previous:null;
    return previous;
  });
}
