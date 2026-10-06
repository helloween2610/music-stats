// Lock the initial direction so scrolling cannot turn into navigation mid-gesture.
export class BackGesture {
  private start: { x: number; y: number } | null = null;
  private horizontal = false;
  private distance = 0;
  begin(x: number, y: number) { this.cancel(); this.start = { x, y }; }
  move(x: number, y: number) {
    if (!this.start) return false;
    const dx = x - this.start.x, dy = Math.abs(y - this.start.y);
    if (!this.horizontal) {
      if (Math.max(Math.abs(dx), dy) < 12) return false;
      if (dx <= 0 || dx < dy * 1.5) { this.cancel(); return false; }
      this.horizontal = true;
    }
    if (dx < 0 || dy > Math.max(40, dx * .6)) { this.cancel(); return false; }
    this.distance = dx;
    return true;
  }
  end() { const ready = this.horizontal && this.distance >= 80; this.cancel(); return ready; }
  cancel() { this.start = null; this.horizontal = false; this.distance = 0; }
}
