export function ArtworkRank({rank,change,comparison}:{rank?:number;change?:number;comparison?:string}) {
  if(!Number.isInteger(rank) || rank! <= 0)return null;
  const hasChange=Number.isInteger(change) && change !== 0;
  const movement=hasChange ? change! > 0 ? `▲${change}` : change! < 0 ? `▼${Math.abs(change!)}` : '→0' : '';
  const label=`Hạng All time hiện tại: ${rank}`+(hasChange ? `; ${change! > 0 ? 'tăng '+change : change! < 0 ? 'giảm '+Math.abs(change!) : 'không đổi'}${change ? ' bậc' : ''} so với hạng tốt nhất trước đó #${rank!+change!}${comparison ? ' ('+comparison+')' : ''}` : '');
  return <span className={'artwork-rank'+(hasChange?' with-change':'')} title={label} aria-label={label}>
    <span>{rank}</span>{hasChange && <span className={'artwork-rank-change '+(change!>0?'up':change!<0?'down':'same')}>{movement[0]}<strong>{movement.slice(1)}</strong></span>}
  </span>;
}
