/** Cancel on scrolling, multiple pointers or leaving the target; consume the release click. */
export function longPress(open: () => void, delay = 500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: {x:number;y:number} | undefined;
  let blockedUntil = 0;
  let fired = false;
  const cancel = () => { clearTimeout(timer); timer = undefined; origin = undefined; };
  return {
    start(x:number,y:number) {
      cancel(); origin={x,y}; blockedUntil=0; fired=false;
      timer=setTimeout(()=>{timer=undefined;fired=true;open();},delay);
    },
    move(x:number,y:number) { if(origin && Math.hypot(x-origin.x,y-origin.y)>10)cancel(); },
    cancel,
    end() { cancel(); if(fired){blockedUntil=Date.now()+1500;fired=false;} },
    consumeClick() { const blocked=fired || Date.now()<blockedUntil; blockedUntil=0; fired=false; return blocked; },
    blockClick() { cancel(); fired=false; blockedUntil=Date.now()+1500; },
  };
}
