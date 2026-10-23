export type ReleaseScanSettings={watchlist:string[];excluded:string[];recentDays:90|180;updatedAt?:string};
export const RELEASE_SCAN_SETTINGS_KEY='release_scan_settings';
const norm=(value:unknown)=>String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const cleanList=(value:unknown,max=1000)=>{
  const input=Array.isArray(value)?value:[];
  const out:string[]=[],seen=new Set<string>();
  for(const item of input){
    const name=String(item || '').trim().replace(/\s+/g,' ');
    const key=norm(name);
    if(!name || name.length>300 || !key || seen.has(key))continue;
    seen.add(key);out.push(name);
    if(out.length>=max)break;
  }
  return out;
};
const validDays=(value:unknown):90|180=>Number(value)===180?180:90;
const valid=(value:any):value is ReleaseScanSettings=>value && Array.isArray(value.watchlist) && Array.isArray(value.excluded) && (value.recentDays===90 || value.recentDays===180);

export async function getReleaseScanSettings(db:D1Database):Promise<ReleaseScanSettings>{
  try{
    const row=await db.prepare('SELECT value FROM settings WHERE key=?1').bind(RELEASE_SCAN_SETTINGS_KEY).first<{value:string}>();
    const parsed=JSON.parse(row?.value || '{}');
    return {watchlist:cleanList(parsed.watchlist),excluded:cleanList(parsed.excluded),recentDays:validDays(parsed.recentDays),updatedAt:typeof parsed.updatedAt==='string'?parsed.updatedAt:undefined};
  }catch{return {watchlist:[],excluded:[],recentDays:90};}
}

export async function saveReleaseScanSettings(db:D1Database,input:unknown):Promise<ReleaseScanSettings>{
  const body=input && typeof input==='object' ? input as Record<string,unknown> : {};
  const current=await getReleaseScanSettings(db);
  const next:ReleaseScanSettings={
    watchlist:'watchlist' in body ? cleanList(body.watchlist) : current.watchlist,
    excluded:'excluded' in body ? cleanList(body.excluded) : current.excluded,
    recentDays:'recentDays' in body ? validDays(body.recentDays) : current.recentDays,
    updatedAt:new Date().toISOString(),
  };
  if(!valid(next))throw new Error('invalid release scan settings');
  await db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)').bind(RELEASE_SCAN_SETTINGS_KEY,JSON.stringify(next)).run();
  return next;
}
