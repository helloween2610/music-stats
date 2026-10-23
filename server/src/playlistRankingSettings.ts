export type PlaylistKeywordRule={keyword:string;enabled:boolean;match?:'contains'|'exact'|'rawContains'|'word'};
export type PlaylistRankingSettings={keywords:PlaylistKeywordRule[];excludes:string[];updatedAt?:string};

export const PLAYLIST_RANKING_SETTINGS_KEY='playlist_ranking_settings';

const fold=(value:unknown)=>String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const validMatch=(value:unknown):PlaylistKeywordRule['match']|undefined=>
  value==='contains'||value==='exact'||value==='rawContains'||value==='word'?value:undefined;

function cleanKeywords(value:unknown,max=200):PlaylistKeywordRule[]{
  const source=Array.isArray(value)?value:[];
  const out:PlaylistKeywordRule[]=[],seen=new Set<string>();
  for(const item of source){
    const raw=typeof item==='string'?item:(item as any)?.keyword;
    const keyword=String(raw || '').trim().replace(/\s+/g,' ');
    const key=fold(keyword);
    if(!keyword || keyword.length>300 || !key || seen.has(key))continue;
    seen.add(key);
    out.push({keyword,enabled:(item as any)?.enabled!==false,match:validMatch((item as any)?.match)});
    if(out.length>=max)break;
  }
  return out;
}

function cleanExcludes(value:unknown,max=1000):string[]{
  const source=Array.isArray(value)?value:[];
  const out:string[]=[],seen=new Set<string>();
  for(const item of source){
    const key=String(item || '').trim();
    const folded=fold(key);
    if(!key || key.length>300 || !folded || seen.has(folded))continue;
    seen.add(folded);
    out.push(key);
    if(out.length>=max)break;
  }
  return out;
}

function parseSettings(value:string|undefined|null):PlaylistRankingSettings|null{
  if(!value)return null;
  try{
    const parsed=JSON.parse(value);
    if(!parsed || typeof parsed!=='object')return null;
    return {
      keywords:cleanKeywords((parsed as any).keywords),
      excludes:cleanExcludes((parsed as any).excludes),
      updatedAt:typeof (parsed as any).updatedAt==='string'?(parsed as any).updatedAt:undefined,
    };
  }catch{return null;}
}

export async function getPlaylistRankingSettings(db:D1Database):Promise<PlaylistRankingSettings|null>{
  const row=await db.prepare('SELECT value FROM settings WHERE key=?1').bind(PLAYLIST_RANKING_SETTINGS_KEY).first<{value:string}>();
  return parseSettings(row?.value);
}

export async function savePlaylistRankingSettings(db:D1Database,input:unknown):Promise<PlaylistRankingSettings>{
  const body=input && typeof input==='object' ? input as Record<string,unknown> : {};
  const current=await getPlaylistRankingSettings(db) || {keywords:[],excludes:[]};
  const next:PlaylistRankingSettings={
    keywords:'keywords' in body ? cleanKeywords(body.keywords) : current.keywords,
    excludes:'excludes' in body ? cleanExcludes(body.excludes) : current.excludes,
    updatedAt:new Date().toISOString(),
  };
  await db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)').bind(PLAYLIST_RANKING_SETTINGS_KEY,JSON.stringify(next)).run();
  return next;
}
