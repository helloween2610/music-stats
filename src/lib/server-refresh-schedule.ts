// Share the worker's actual Vietnam-time sync schedule; refresh five minutes later.
import {isSyncHour} from '../../server/src/schedule';
const HOUR=3600000, DELAY=5*60000;
export function serverRefreshWindow(now:number) {
  const hour=Math.floor(now/HOUR)*HOUR;
  let last=0,next=0;
  for(let offset=-48;offset<=48;offset++) {
    const sync=hour+offset*HOUR;
    if(!isSyncHour(new Date(sync)))continue;
    const refresh=sync+DELAY;
    if(refresh<=now)last=refresh;
    else {next=refresh;break;}
  }
  return {last,next};
}

// Returning from the background catches up once, even if several sync slots passed.
export class ServerRefreshSchedule {
  private handled:number;
  constructor(now:number){this.handled=serverRefreshWindow(now).last;}
  takeDue(now:number,active:boolean) {
    const slot=serverRefreshWindow(now).last;
    if(!active || slot<=this.handled)return false;
    this.handled=slot;return true;
  }
}
