// A pull must begin at the top and remain vertical; normal scrolling never refreshes.
export class PullGesture {
  private start: {x:number;y:number} | null = null;
  distance = 0;
  begin(x:number,y:number,atTop:boolean) { this.start=atTop?{x,y}:null; this.distance=0; }
  move(x:number,y:number) {
    if(!this.start)return 0;
    const dx=Math.abs(x-this.start.x),dy=y-this.start.y;
    if(dx>12 && dx>Math.abs(dy) || dy<0){this.cancel();return 0;}
    this.distance=Math.min(90,Math.max(0,dy)*0.5);
    return this.distance;
  }
  end(){const ready=this.distance>=60;this.cancel();return ready;}
  cancel(){this.start=null;this.distance=0;}
}
