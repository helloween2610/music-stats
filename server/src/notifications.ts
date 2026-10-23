import { mergeReleases, type Release } from '../../shared/releases';
import { allTimeSql } from './alltime';
import { artistSql } from './artistRank';
import { discoveryStore } from './discoveryRoute';
import type { Env } from './index';

export type NotificationPriority='high'|'normal'|'digest';
export type NotificationEvent={
  id:string;fingerprint:string;type:string;entity_kind:string|null;entity_id:string|null;
  title:string;body:string;priority:NotificationPriority;route:string|null;payload:Record<string,unknown>;event_at:string;
};
export type NotificationSettings={songRanks:boolean;artistRanks:boolean;artistRhythm:boolean;forgottenArtists:boolean;releases:boolean;dailyDigest:boolean};
export const DEFAULT_NOTIFICATION_SETTINGS:NotificationSettings={songRanks:true,artistRanks:true,artistRhythm:true,forgottenArtists:true,releases:true,dailyDigest:true};

type SongRank={track_id:string;rank:number;title:string;artist:string|null};
type ArtistStatus={lastPlayed:string|null;overdueStage:number;forgotten:boolean};
type ArtistState=Record<string,ArtistStatus>;
type MonthLeader={scope:string;artist:string;plays:number;hours:number};
type ReleaseState=Record<string,{date:string;title:string;artist:string}>;
const DAY=86400000;

const event=(input:Omit<NotificationEvent,'id'>):NotificationEvent=>({...input,id:input.fingerprint});
const eventTime=(day:string)=>day+'T12:00:00+07:00';
const songRoute=(id:string)=>'/song/'+encodeURIComponent(id);
const artistRoute=(name:string)=>'/artist/'+encodeURIComponent(name);
const albumRoute=(artist:string,title:string)=>'/album/'+encodeURIComponent(JSON.stringify([artist,title]));
const dateDiff=(a:string,b:string)=>Math.floor((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/DAY);
const displayDate=(value:string)=>{
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match?`${match[3]}/${match[2]}/${match[1]}`:value;
};

export function detectSongRankEvents(previous:SongRank[],current:SongRank[],day:string):NotificationEvent[]{
  const before=new Map(previous.map(row=>[row.track_id,row]));
  const out:NotificationEvent[]=[];
  for(const row of current){
    const old=before.get(row.track_id);
    if(!old || old.rank<=row.rank || row.rank>100)continue;
    const rise=old.rank-row.rank;
    const milestone=[1,10,25,50,80,100].find(limit=>old.rank>limit&&row.rank<=limit);
    let type:string,title:string,body:string,priority:NotificationPriority='normal',fingerprint:string;
    if(milestone===1){type='song_rank_1';title='Bài hát lên hạng 1';body=`${row.title} vừa lên hạng 1 All time, từ hạng ${old.rank}.`;priority='high';fingerprint=`song:rank-1:${row.track_id}`;}
    else if(milestone){type=milestone===100?'song_top_100':'song_rank_milestone';title=milestone===100?'Bài hát vào Top 100':`Bài hát vào Top ${milestone}`;body=`${row.title} hiện ở hạng ${row.rank} All time, tăng từ hạng ${old.rank}.`;priority=milestone<=25?'high':'normal';fingerprint=`song:milestone:${row.track_id}:${milestone}`;}
    else if(rise>=5 || row.rank<=10&&rise>=1){type='song_rank_rise';title='Bài hát tăng hạng';body=`${row.title} tăng ${rise} bậc, hiện ở hạng ${row.rank} All time.`;fingerprint=`song:rise:${row.track_id}:${day}`;}
    else continue;
    out.push(event({fingerprint,type,entity_kind:'song',entity_id:row.track_id,title,body,priority,route:songRoute(row.track_id),
      payload:{trackId:row.track_id,title:row.title,artist:row.artist,previousRank:old.rank,rank:row.rank,rise},event_at:eventTime(day)}));
  }
  return out;
}

export type ArtistCandidate={artist:string;rank:number;first:string|null;last:string|null;days:number;forgotten:boolean};
export function detectArtistEvents(previous:ArtistState|null,candidates:ArtistCandidate[],day:string):{events:NotificationEvent[];state:ArtistState}{
  const state:ArtistState={},events:NotificationEvent[]=[];
  for(const row of candidates){
    const avg=row.first&&row.last&&row.days>1?dateDiff(row.last,row.first)/(row.days-1):null;
    const since=row.last?Math.max(0,dateDiff(day,row.last)):0;
    const overdueStage=avg!=null&&row.rank<=25&&row.days>=5
      ? since>avg*2?2:since>Math.max(avg*1.25,3)?1:0 : 0;
    const old=previous?.[row.artist];
    const oldStage=old?.lastPlayed===row.last?old.overdueStage:0;
    state[row.artist]={lastPlayed:row.last,overdueStage,forgotten:row.forgotten};
    if(previous&&overdueStage>oldStage){
      const avgText=avg!.toLocaleString('vi-VN',{maximumFractionDigits:1});
      events.push(event({fingerprint:`artist:overdue:${row.artist}:${row.last || 'never'}:${overdueStage}`,type:'artist_overdue',entity_kind:'artist',entity_id:row.artist,
        title:overdueStage===2?'Nghệ sĩ đã quá nhịp nghe lâu':'Đã đến nhịp nghe nghệ sĩ',
        body:`${row.artist} đã ${since} ngày chưa nghe, lâu hơn nhịp trung bình ${avgText} ngày.`,priority:overdueStage===2?'high':'normal',route:artistRoute(row.artist),
        payload:{artist:row.artist,rank:row.rank,daysSinceLastPlay:since,avgGapDays:Math.round(avg!*10)/10,stage:overdueStage},event_at:eventTime(day)}));
    }
    if(previous&&row.forgotten&&!old?.forgotten){
      events.push(event({fingerprint:`artist:forgotten:${row.artist}:${day}`,type:'artist_forgotten',entity_kind:'artist',entity_id:row.artist,
        title:'Nghệ sĩ yêu thích đang bị bỏ quên',body:`${row.artist} thuộc nhóm yêu thích lâu dài nhưng gần đây không còn trong Top 15.`,priority:'normal',route:artistRoute(row.artist),
        payload:{artist:row.artist},event_at:eventTime(day)}));
    }
  }
  return {events,state};
}

export function detectMonthlyLeaderEvent(previous:MonthLeader|null,current:MonthLeader|null,day:string):NotificationEvent[]{
  if(!previous||!current||previous.scope!==current.scope||previous.artist===current.artist)return [];
  return [event({fingerprint:`artist:month-1:${current.scope}:${current.artist}`,type:'artist_month_rank_1',entity_kind:'artist',entity_id:current.artist,
    title:'Nghệ sĩ mới lên hạng 1 tháng',body:`${current.artist} vừa vượt ${previous.artist} để dẫn đầu tháng ${Number(current.scope.slice(5,7))}/${current.scope.slice(0,4)}.`,
    priority:'high',route:`/period-top/${encodeURIComponent(`artists~${current.scope}~${day}`)}`,
    payload:{artist:current.artist,previousArtist:previous.artist,scope:current.scope,asOf:day,rank:1,plays:current.plays,hours:current.hours},event_at:eventTime(day)})];
}

export function detectReleaseEvents(previous:ReleaseState|null,releases:Release[],day:string):{events:NotificationEvent[];state:ReleaseState}{
  const state:ReleaseState={},events:NotificationEvent[]=[];
  for(const row of releases){
    state[row.id]={date:row.date,title:row.title,artist:row.artist};
    if(!previous)continue;
    const old=previous[row.id];
    const payload={releaseId:row.id,title:row.title,artist:row.artist,date:row.date,type:row.type,cover:row.cover,url:row.url,sources:row.sources};
    if(!old){
      events.push(event({fingerprint:`release:new:${row.id}`,type:'release_new',entity_kind:'release',entity_id:row.id,title:'Phát hiện bản phát hành mới',
        body:`${row.title} — ${row.artist} · ${displayDate(row.date)}.`,priority:'normal',route:albumRoute(row.artist,row.title),payload,event_at:eventTime(day)}));
    }else if(old.date!==row.date){
      events.push(event({fingerprint:`release:date:${row.id}:${old.date}:${row.date}`,type:'release_date_changed',entity_kind:'release',entity_id:row.id,title:'Ngày phát hành đã thay đổi',
        body:`${row.title} chuyển từ ${displayDate(old.date)} sang ${displayDate(row.date)}.`,priority:'normal',route:albumRoute(row.artist,row.title),payload:{...payload,previousDate:old.date},event_at:eventTime(day)}));
    }
    if(/^\d{4}-\d{2}-\d{2}$/.test(row.date)){
      const days=dateDiff(row.date,day);
      if(days===7)events.push(event({fingerprint:`release:7d:${row.id}:${row.date}`,type:'release_in_7_days',entity_kind:'release',entity_id:row.id,title:'Phát hành sau 7 ngày',
        body:`${row.title} — ${row.artist} sẽ phát hành ngày ${displayDate(row.date)}.`,priority:'normal',route:albumRoute(row.artist,row.title),payload,event_at:eventTime(day)}));
      if(days===0)events.push(event({fingerprint:`release:today:${row.id}:${row.date}`,type:'release_today',entity_kind:'release',entity_id:row.id,title:'Phát hành hôm nay',
        body:`${row.title} — ${row.artist} được phát hành hôm nay.`,priority:'high',route:albumRoute(row.artist,row.title),payload,event_at:eventTime(day)}));
    }
  }
  return {events,state};
}

async function stateGet<T>(env:Env,key:string):Promise<T|null>{
  const row=await env.DB.prepare('SELECT value FROM notification_state WHERE key=?1').bind(key).first<{value:string}>();
  if(!row)return null;
  try{return JSON.parse(row.value) as T;}catch{return null;}
}
async function statePut(env:Env,key:string,value:unknown){
  await env.DB.prepare(`INSERT INTO notification_state(key,value,updated_at) VALUES(?1,?2,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(key,JSON.stringify(value)).run();
}

export async function getNotificationSettings(env:Env):Promise<NotificationSettings>{
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='notification_settings'").first<{value:string}>();
  try{return {...DEFAULT_NOTIFICATION_SETTINGS,...JSON.parse(row?.value || '{}')};}catch{return {...DEFAULT_NOTIFICATION_SETTINGS};}
}
export async function saveNotificationSettings(env:Env,input:unknown):Promise<NotificationSettings>{
  const current=await getNotificationSettings(env),body=input&&typeof input==='object'?input as Record<string,unknown>:{};
  const next={...current};
  for(const key of Object.keys(DEFAULT_NOTIFICATION_SETTINGS) as (keyof NotificationSettings)[])if(typeof body[key]==='boolean')next[key]=body[key] as boolean;
  await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('notification_settings',?1)").bind(JSON.stringify(next)).run();
  return next;
}

const enabled=(settings:NotificationSettings,row:NotificationEvent)=>row.type.startsWith('song_')?settings.songRanks
  :row.type==='artist_month_rank_1'?settings.artistRanks:row.type==='artist_overdue'?settings.artistRhythm:row.type==='artist_forgotten'?settings.forgottenArtists
  :row.type.startsWith('release_')?settings.releases:row.type==='daily_digest'?settings.dailyDigest:true;

export async function storeNotificationEvents(env:Env,rows:NotificationEvent[]){
  for(let i=0;i<rows.length;i+=50){
    await env.DB.batch(rows.slice(i,i+50).map(row=>env.DB.prepare(`INSERT INTO notification_events
      (id,fingerprint,type,entity_kind,entity_id,title,body,priority,route,payload,event_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
      ON CONFLICT(fingerprint) DO UPDATE SET title=excluded.title,body=excluded.body,priority=excluded.priority,route=excluded.route,payload=excluded.payload,event_at=excluded.event_at`)
      .bind(row.id,row.fingerprint,row.type,row.entity_kind,row.entity_id,row.title,row.body,row.priority,row.route,JSON.stringify(row.payload),row.event_at)));
  }
}

export async function refreshDailyDigest(env:Env,day:string){
  const counts=await env.DB.prepare(`SELECT
    SUM(type LIKE 'song_%') songs,SUM(type='artist_month_rank_1') artists,SUM(type LIKE 'release_%') releases,COUNT(*) total
    FROM notification_events WHERE substr(event_at,1,10)=?1 AND type<>'daily_digest' AND type NOT IN ('artist_overdue','artist_forgotten')`).bind(day).first<{songs:number;artists:number;releases:number;total:number}>();
  if(!counts||counts.total<2)return;
  const parts=[counts.songs&&`${counts.songs} thay đổi hạng bài hát`,counts.artists&&`${counts.artists} thay đổi hạng nghệ sĩ`,counts.releases&&`${counts.releases} bản phát hành`].filter(Boolean);
  const row=event({fingerprint:`daily:${day}`,type:'daily_digest',entity_kind:null,entity_id:null,title:'Tóm tắt thay đổi hôm nay',
    body:parts.join(' · ')+'.',priority:'digest',route:'/trend',payload:{...counts,day},event_at:eventTime(day)});
  await env.DB.prepare(`INSERT INTO notification_events(id,fingerprint,type,entity_kind,entity_id,title,body,priority,route,payload,event_at)
    VALUES(?1,?2,?3,NULL,NULL,?4,?5,'digest','/trend',?6,?7)
    ON CONFLICT(fingerprint) DO UPDATE SET body=excluded.body,payload=excluded.payload,event_at=excluded.event_at`)
    .bind(row.id,row.fingerprint,row.type,row.title,row.body,JSON.stringify(row.payload),row.event_at).run();
}

async function currentArtistCandidates(env:Env,day:string):Promise<ArtistCandidate[]>{
  const lists=await env.DB.batch<any>([
    env.DB.prepare(artistSql('at')).bind(day,env.LASTFM_FROM,day,25),
    env.DB.prepare(artistSql('ft0424')).bind(day,env.LASTFM_FROM,day,10),
    env.DB.prepare(artistSql('7d')).bind(day,env.LASTFM_FROM,day,15),
    env.DB.prepare(artistSql('1m')).bind(day,env.LASTFM_FROM,day,15),
    env.DB.prepare(artistSql('100d')).bind(day,env.LASTFM_FROM,day,15),
    env.DB.prepare(`SELECT COALESCE(t.album_artist,t.artist) artist,MIN(p.play_date) first,MAX(p.play_date) last,COUNT(DISTINCT p.play_date) days
      FROM plays p JOIN tracks t ON t.id=p.track_id WHERE p.play_date<=?1 GROUP BY 1`).bind(day),
  ]);
  const at=new Map(lists[0].results.map((r:any)=>[r.artist,r])),ft=new Map(lists[1].results.map((r:any)=>[r.artist,r.rank]));
  const recent=lists.slice(2,5).map(result=>new Map(result.results.map((r:any)=>[r.artist,r.rank])));
  const life=new Map(lists[5].results.map((r:any)=>[r.artist,r]));
  const names=new Set<string>([...at.keys(),...ft.keys()]);
  return [...names].map(artist=>{
    const a:any=at.get(artist),l:any=life.get(artist);
    return {artist,rank:a?.rank??Number.MAX_SAFE_INTEGER,first:l?.first??null,last:l?.last??null,days:Number(l?.days)||0,
      forgotten:(ft.get(artist)??Infinity)<=10&&recent.every(map=>(map.get(artist)??Infinity)>15)};
  });
}

export async function runListeningNotifications(env:Env,day:string){
  const settings=await getNotificationSettings(env);
  const current=(await env.DB.prepare(`${allTimeSql('at')} ORDER BY rank LIMIT ?3`).bind(day,env.LASTFM_FROM,300).all<SongRank>()).results;
  const previous=await stateGet<SongRank[]>(env,'notification:song-ranks:v1');
  let rows=previous?detectSongRankEvents(previous,current,day):[];
  await statePut(env,'notification:song-ranks:v1',current);

  const artistDay=await stateGet<string>(env,'notification:artist-scan-day:v1');
  if(artistDay!==day){
    const candidates=await currentArtistCandidates(env,day),old=await stateGet<ArtistState>(env,'notification:artist-state:v1');
    const result=detectArtistEvents(old,candidates,day);rows.push(...result.events);
    await statePut(env,'notification:artist-state:v1',result.state);await statePut(env,'notification:artist-scan-day:v1',day);
  }
  const scope=day.slice(0,7),monthFrom=scope+'-01';
  const leaderRow=await env.DB.prepare(artistSql('month')).bind(day,env.LASTFM_FROM,monthFrom,1).first<{artist:string;plays:number;hours:number}>();
  const leader=leaderRow?{scope,artist:leaderRow.artist,plays:Number(leaderRow.plays)||0,hours:Number(leaderRow.hours)||0}:null;
  const previousLeader=await stateGet<MonthLeader>(env,'notification:artist-month-1:v1');
  rows.push(...detectMonthlyLeaderEvent(previousLeader,leader,day));
  if(leader)await statePut(env,'notification:artist-month-1:v1',leader);
  rows=rows.filter(row=>enabled(settings,row));
  await storeNotificationEvents(env,rows);
  if(settings.dailyDigest)await refreshDailyDigest(env,day);
  await env.DB.prepare("DELETE FROM notification_events WHERE created_at<datetime('now','-180 days')").run();
  return {created:rows.length,seeded:previous===null};
}

export async function runReleaseNotifications(env:Env,day:string){
  const store=discoveryStore(env.DB),saved=store.list?await store.list('release-snapshot:v1:'):[];
  const releases=mergeReleases(saved.flatMap(value=>Array.isArray(value?.rows)?value.rows:[]));
  const old=await stateGet<ReleaseState>(env,'notification:release-state:v1'),result=detectReleaseEvents(old,releases,day);
  await statePut(env,'notification:release-state:v1',result.state);
  const settings=await getNotificationSettings(env),rows=result.events.filter(row=>enabled(settings,row));
  await storeNotificationEvents(env,rows);if(settings.dailyDigest)await refreshDailyDigest(env,day);
  return {created:rows.length,seeded:old===null};
}

export async function listNotifications(env:Env,limit=50,before?:string|null){
  const [beforeAt,beforeId]=before?.split('\u001f')||[];
  const paged=!!beforeAt&&!!beforeId;
  const where=paged?'WHERE created_at<?1 OR (created_at=?1 AND id<?2)':'';
  const rows=await env.DB.prepare(`SELECT id,type,entity_kind,entity_id,title,body,priority,route,payload,event_at,created_at,read_at
    FROM notification_events ${where} ORDER BY created_at DESC,id DESC LIMIT ?${paged?3:1}`)
    .bind(...(paged?[beforeAt,beforeId,limit]:[limit])).all<any>();
  const unread=await env.DB.prepare('SELECT COUNT(*) n FROM notification_events WHERE read_at IS NULL').first<{n:number}>();
  const last=rows.results.at(-1);
  return {rows:rows.results.map(row=>{
    try{return {...row,payload:JSON.parse(row.payload||'{}')};}
    catch{return {...row,payload:{}};}
  }),unread:unread?.n||0,next:rows.results.length===limit&&last?last.created_at+'\u001f'+last.id:null,settings:await getNotificationSettings(env)};
}

export async function markNotificationsRead(env:Env,input:unknown){
  const body=input&&typeof input==='object'?input as any:{};
  if(body.all===true){await env.DB.prepare("UPDATE notification_events SET read_at=datetime('now') WHERE read_at IS NULL").run();return;}
  const ids=Array.isArray(body.ids)?body.ids.filter((id:unknown)=>typeof id==='string').slice(0,50):[];
  if(!ids.length)return;
  await env.DB.prepare(`UPDATE notification_events SET read_at=datetime('now') WHERE id IN (${ids.map((_:string,i:number)=>`?${i+1}`).join(',')})`).bind(...ids).run();
}
