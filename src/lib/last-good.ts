// Bounded persistent cache. Failed storage writes still retain data for this session.
export type Saved = { data: any; at: number; generation?: string };
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export function sameResponseReferences(previous:Record<string,unknown>|undefined,current:Record<string,unknown>) {
  if(!previous)return false;
  const keys=Object.keys(current);
  return keys.length===Object.keys(previous).length && keys.every(key=>Object.prototype.hasOwnProperty.call(previous,key) && previous[key]===current[key]);
}
export class LastGoodStore {
  private entries: Record<string, Saved> = {};
  private entrySizes = new Map<string, number>();
  private totalChars = 2;
  constructor(private key: string, private storage?: StorageLike, private maxChars = 4000000) {
    try {
      const parsed = JSON.parse(storage?.getItem(key) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [path, value] of Object.entries(parsed)) {
          const s = value as Saved;
          if (s && Number.isFinite(s.at) && s.at > 0 && s.data != null) this.remember(path, s);
        }
      }
    } catch { /* Corrupt or unavailable storage must not block the app. */ }
  }
  get(path: string): Saved | undefined { return this.entries[path]; }
  removeWhere(predicate:(path:string)=>boolean){
    for(const path of Object.keys(this.entries))if(predicate(path))this.forget(path);
    try{this.storage?.setItem(this.key,JSON.stringify(this.entries));}catch{}
  }
  set(path: string, data: any, at = Date.now(), generation?: string) {
    const value = { data, at, ...(generation ? {generation} : {}) };
    const size = this.sizeOf(path, value);
    if (size + 2 > this.maxChars) return;
    this.forget(path);
    this.remember(path, value, size);
    try {
      const oldest = Object.keys(this.entries).sort((a, b) => {
        const av = a.startsWith("view:"), bv = b.startsWith("view:");
        if (av !== bv) return av ? 1 : -1;
        return this.entries[a].at - this.entries[b].at;
      });
      while (this.totalChars > this.maxChars && oldest.length) this.forget(oldest.shift()!);
      this.storage?.setItem(this.key, JSON.stringify(this.entries));
    } catch { /* Keep the in-memory copy when storage is full or denied. */ }
  }
  private sizeOf(path:string, value:Saved) {
    return JSON.stringify(path).length + 1 + JSON.stringify(value).length;
  }
  private remember(path:string, value:Saved, size=this.sizeOf(path,value)) {
    this.entries[path]=value;
    this.entrySizes.set(path,size);
    this.totalChars+=size+(this.entrySizes.size>1?1:0);
  }
  private forget(path:string) {
    const size=this.entrySizes.get(path);
    if(size===undefined)return;
    this.totalChars-=size+(this.entrySizes.size>1?1:0);
    this.entrySizes.delete(path);
    delete this.entries[path];
  }
}

// Separate API/account caches without writing bearer tokens to storage keys.
export function cacheScope(base: string, token: string) {
  let a = 2166136261, b = 5381;
  for (const char of base + "\n" + token) {
    a = Math.imul(a ^ char.charCodeAt(0), 16777619);
    b = Math.imul(b, 33) ^ char.charCodeAt(0);
  }
  return `music-stats:last-good:v1:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}

// Validate the endpoint envelope before replacing its last successful response.
export function validResponse(path: string, d: any): boolean {
  const obj = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
  if (!obj(d) || d.error) return false;
  const route = path.split("?")[0];
  if (route === "/summary") return typeof d.asOf === "string" && /^\d{4}-\d{2}-\d{2}/.test(d.asOf)
    && [d.week, d.month, d.year, d.total].every(obj)
    && [d.week.plays, d.month.plays, d.year.plays, d.total.plays].every(Number.isFinite);
  if (route === "/daily") return (!path.includes("hours=today") || Array.isArray(d.byHour)) && Array.isArray(d.days) && d.days.length > 0 && d.days.every((x: any) => obj(x) && typeof x.date === "string");
  if (route === "/artwork") return [d.artists, d.tracks, d.albums].every(obj);
  if (route === "/library/generation") return typeof d.generation === "string";
  if (route === "/library/metadata") return typeof d.generation === "string" && Array.isArray(d.rows) && d.generation === new URLSearchParams(path.split("?")[1]).get("generation");
  if (route === "/library") return obj(d.library) && obj(d.unmatched) && Array.isArray(d.sync);
  if (route === "/library/title-rules") return Array.isArray(d.rules);
  if (route === "/library/search") return [d.songs, d.artists, d.albums].every(Array.isArray);
  if (route === "/board") return Array.isArray(d.periods);
  if (route === "/overview") return obj(d.totals) && Array.isArray(d.months);
  if (route === "/new-additions") return Array.isArray(d.artists) && Array.isArray(d.songs);
  if (route.startsWith("/song/")) return obj(d.track) && typeof d.track.title === "string" && Array.isArray(d.months);
  if (route.startsWith("/artist/")) return typeof d.artist === "string" && obj(d.library) && Array.isArray(d.months) && Array.isArray(d.weeks);
  return Array.isArray(d.rows);
}
