import { getFresh, lastGood, postJson } from './api';
import { validResponse } from './last-good';

export type NotificationSettings={songRanks:boolean;artistRanks:boolean;artistRhythm:boolean;forgottenArtists:boolean;releases:boolean;dailyDigest:boolean};
export type NotificationArtwork={artists:Record<string,string>;tracks:Record<string,string>;albums:Record<string,string>};
export type NotificationItem={
  id:string;type:string;entity_kind:string|null;entity_id:string|null;title:string;body:string;
  priority:'high'|'normal'|'digest';route:string|null;payload:Record<string,any>;event_at:string;created_at:string;read_at:string|null;
};
export type NotificationFeed={rows:NotificationItem[];unread:number;settings:NotificationSettings;artwork:NotificationArtwork;busy:boolean;error:string;next:string|null};

const defaults:NotificationSettings={songRanks:true,artistRanks:true,artistRhythm:true,forgottenArtists:true,releases:true,dailyDigest:true};
const emptyArtwork=():NotificationArtwork=>({artists:{},tracks:{},albums:{}});
let feed:NotificationFeed={rows:[],unread:0,settings:defaults,artwork:emptyArtwork(),busy:false,error:'',next:null},loading:Promise<void>|null=null,artworkLoading:Promise<void>|null=null;
const listeners=new Set<()=>void>();
const publish=(next:Partial<NotificationFeed>)=>{feed={...feed,...next};listeners.forEach(fn=>fn());};
export const notificationSnapshot=()=>feed;
export const subscribeNotifications=(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);};
function loadNotificationArtwork(){
  if(artworkLoading)return artworkLoading;
  const saved=lastGood.get('/artwork');
  if(saved&&validResponse('/artwork',saved.data)){
    publish({artwork:{artists:saved.data.artists||{},tracks:saved.data.tracks||{},albums:saved.data.albums||{}}});
    return Promise.resolve();
  }
  artworkLoading=getFresh('/artwork').then(data=>{
    if(validResponse('/artwork',data))lastGood.set('/artwork',data);
    publish({artwork:{artists:data?.artists||{},tracks:data?.tracks||{},albums:data?.albums||{}}});
  }).catch(()=>{}).finally(()=>{artworkLoading=null;});
  return artworkLoading;
}
export function loadNotifications(force=false){
  if(loading&&!force)return loading;
  publish({busy:true,error:''});
  void loadNotificationArtwork();
  loading=getFresh('/notifications?limit=100').then(data=>{
    publish({rows:Array.isArray(data?.rows)?data.rows:[],unread:Number(data?.unread)||0,next:data?.next||null,
      settings:{...defaults,...(data?.settings||feed.settings)},busy:false,error:''});
  }).catch(()=>publish({busy:false,error:'Chưa tải được thông báo.'})).finally(()=>{loading=null;});
  return loading;
}

export async function loadMoreNotifications(){
  if(!feed.next||feed.busy)return;
  publish({busy:true,error:''});
  try{
    const data=await getFresh('/notifications?limit=100&before='+encodeURIComponent(feed.next));
    const rows=Array.isArray(data?.rows)?data.rows:[],seen=new Set(feed.rows.map(row=>row.id));
    publish({rows:[...feed.rows,...rows.filter((row:NotificationItem)=>!seen.has(row.id))],unread:Number(data?.unread)||0,next:data?.next||null,busy:false});
  }catch{publish({busy:false,error:'Chưa tải được thông báo cũ hơn.'});}
}

export async function markNotificationsRead(ids:'all'|string[]){
  const selected=ids==='all'?new Set(feed.rows.map(row=>row.id)):new Set(ids);
  const now=new Date().toISOString(),rows=feed.rows.map(row=>selected.has(row.id)?{...row,read_at:row.read_at||now}:row);
  publish({rows,unread:rows.filter(row=>!row.read_at).length});
  const result=await postJson('/notifications/read',ids==='all'?{all:true}:{ids});
  if(result.status!==200)await loadNotifications(true);
  return result.status===200;
}

export async function updateNotificationSettings(patch:Partial<NotificationSettings>){
  const old=feed.settings,next={...old,...patch};publish({settings:next});
  const result=await postJson('/notifications/settings',next);
  if(result.status===200&&result.data?.settings)publish({settings:{...defaults,...result.data.settings}});
  else publish({settings:old});
  return result.status===200;
}
