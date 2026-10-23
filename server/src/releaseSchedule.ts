import { mergeReleases } from '../../shared/releases';
import { vnToday } from './charts';
import { memo } from './cache';
import { releaseTracks, upcoming, type DiscoveryStore, type Track } from './discovery';
import { discoveryStore } from './discoveryRoute';
import { getReleaseScanSettings } from './releaseSettings';
import type { Env } from './index';

export const RELEASE_SCAN_STATE_KEY='release-scan-state:v1';
const DAY=86400000;
const STATE_TTL=365*86400;

type FailedPage={cursor:string;source:string;retryAfter:number;attempts?:number};
export type ReleaseScanState={
  cursor:string|null;
  failed:FailedPage[];
  checked:number;
  total:number;
  cycleStartedAt:string;
  updatedAt:string;
  completedAt?:string;
};

const validState=(value:any):value is ReleaseScanState=>value && (value.cursor===null || typeof value.cursor==='string')
  && Array.isArray(value.failed) && Number.isFinite(value.checked) && Number.isFinite(value.total)
  && typeof value.cycleStartedAt==='string' && typeof value.updatedAt==='string';

const uniqueFailures=(rows:FailedPage[])=>[...new Map(rows.map(row=>[row.cursor,row])).values()];
type ReleaseScanner=typeof upcoming;

async function rememberRows(store:DiscoveryStore,cursor:string,rows:any[]){
  if(!rows.length)return;
  const key='release-snapshot:v1:page:'+cursor+':[]';
  const old=await store.get(key);
  await store.put(key,{rows:mergeReleases([...(old?.rows || []),...rows])},90*86400);
}

/**
 * Advance a bounded part of the release scan. Scheduled runs keep the cursor in D1,
 * so one run stays below Worker subrequest limits and the next hour resumes it.
 */
export async function startReleaseScanCycle(store:DiscoveryStore,total=0,now=Date.now()){
  const stamp=new Date(now).toISOString();
  const state:ReleaseScanState={cursor:'0~0',failed:[],checked:0,total,cycleStartedAt:stamp,updatedAt:stamp};
  await store.put(RELEASE_SCAN_STATE_KEY,state,STATE_TTL);
  return state;
}

export async function scanReleasePages(tracks:Track[],store:DiscoveryStore,maxPages=9,now=Date.now(),fetcher:typeof fetch=fetch,scanner:ReleaseScanner=upcoming,recentDays=90){
  const stamp=new Date(now).toISOString();
  const saved=await store.get(RELEASE_SCAN_STATE_KEY);
  let state:ReleaseScanState=validState(saved)?saved:{cursor:'0~0',failed:[],checked:0,total:0,cycleStartedAt:stamp,updatedAt:stamp};
  if(state.cursor===null && !state.failed.length){
    if(state.completedAt && now-Date.parse(state.completedAt)<DAY)return state;
    state={cursor:'0~0',failed:[],checked:0,total:state.total,cycleStartedAt:stamp,updatedAt:stamp};
  }

  // Finish the main cursor first. Failed provider pages are retried on later hourly
  // runs, after their cooldown, instead of being hammered again in the same run.
  const retryRun=state.cursor===null;
  const retryBudget=retryRun?Math.min(maxPages,state.failed.length):0;
  let processed=0;
  while(processed<maxPages){
    const failed=retryRun && processed<retryBudget ? state.failed.shift() : undefined;
    const cursor=failed?.cursor || state.cursor;
    if(!cursor)break;
    const result=await scanner(tracks,cursor,store,fetcher,vnToday(now),recentDays);
    await rememberRows(store,cursor,result.rows || []);
    if(failed){
      if(result.failed){
        const attempts=(failed.attempts || 1)+1;
        // A provider can stay unavailable for hours. Stop this day's chain after
        // three attempts; tomorrow's 07:30 cycle starts clean and tries again.
        if(attempts<3)state.failed.push({...result.failed,attempts});
      }
      else if(result.next && !result.next.startsWith('b:') && result.next.split('~')[0]===cursor.replace(/^b:/,'').split('~')[0])
        state.failed.push({cursor:result.next,source:'MusicBrainz',retryAfter:1});
    }else{
      if(result.failed)state.failed.push(result.failed);
      state.cursor=result.next;
    }
    state.checked=Math.max(state.checked,Number(result.checked)||0);
    state.total=Number(result.total)||state.total;
    state.updatedAt=stamp;
    processed++;
    if(!failed && state.cursor===null)break;
  }
  state.failed=uniqueFailures(state.failed);
  if(state.cursor===null && !state.failed.length)state.completedAt=stamp;
  await store.put(RELEASE_SCAN_STATE_KEY,state,STATE_TTL);
  return state;
}

export async function releaseScanTracks(env:Env){
  return memo(env,'discovery-tracks:v2:'+vnToday(),async()=> (await env.DB.prepare(`WITH counts AS (SELECT track_id,COUNT(*) AS n FROM plays WHERE play_date >= ?1 AND play_date <= ?2 GROUP BY track_id)
    SELECT t.id,title,artist,album_artist,album,genre,duration_s,in_library,COALESCE(plays_to_12_2024,0)+COALESCE(c.n,0) AS plays
    FROM tracks t LEFT JOIN counts c ON c.track_id=t.id`).bind(env.LASTFM_FROM,vnToday()).all<Track>()).results);
}

export async function scanReleaseCalendar(env:Env,maxPages=9){
  const settings=await getReleaseScanSettings(env.DB);
  const eligible=releaseTracks(await releaseScanTracks(env),settings.excluded,settings.watchlist);
  return scanReleasePages(eligible,discoveryStore(env.DB),maxPages,Date.now(),fetch,upcoming,settings.recentDays);
}

export async function beginReleaseCalendarScan(env:Env){
  // The first provider page writes the eligible artist count. Keep zero during
  // the short enqueue gap so the read endpoint can use its own 143-artist count.
  return startReleaseScanCycle(discoveryStore(env.DB));
}
