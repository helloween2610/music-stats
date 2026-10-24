export class SheetGesture {
  private origin: {x:number;y:number;at:number} | null=null;
  private previous={y:0,at:0};
  private velocity=0;
  active=false;
  offset=0;
  begin(x:number,y:number,at:number) {
    this.cancel();this.origin={x,y,at};this.previous={y,at};
  }
  move(x:number,y:number,at:number) {
    if(!this.origin)return false;
    const dx=x-this.origin.x,dy=y-this.origin.y;
    if(!this.active){
      if(Math.hypot(dx,dy)<8)return false;
      if(dy<=0 || dy<=Math.abs(dx)*1.3){this.cancel();return false;}
      this.active=true;
    }
    const elapsed=at-this.previous.at;
    if(y!==this.previous.y){
      if(elapsed>0)this.velocity=(y-this.previous.y)/elapsed;
      this.previous={y,at};
    }
    this.offset=Math.max(0,dy);
    return true;
  }
  end(height:number,at:number) {
    const velocity=at-this.previous.at<100?this.velocity:0;
    const dismiss=this.active && (this.offset>=Math.max(64,Math.min(120,height*.18)) || this.offset>=24 && velocity>.6);
    this.origin=null;this.active=false;
    return dismiss;
  }
  cancel(){this.origin=null;this.active=false;this.offset=0;this.velocity=0;}
}
