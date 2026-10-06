import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {Thumb} from '@/components/ui';
import {albumId} from '@/lib/albums';
import {rememberReleaseAlbum} from '@/lib/discovery';
import {loadMoreNotifications,loadNotifications,markNotificationsRead,notificationSnapshot,subscribeNotifications,updateNotificationSettings,type NotificationArtwork,type NotificationItem,type NotificationSettings} from '@/lib/notifications';
import {vnToday} from '@/lib/fmt';
import type {Ctx} from '@/vm';

const labels:Record<keyof NotificationSettings,string>={
  songRanks:'Thay đổi hạng bài hát',artistRanks:'Thay đổi hạng nghệ sĩ',artistRhythm:'Nghệ sĩ quá nhịp nghe',forgottenArtists:'Nghệ sĩ bị bỏ quên',releases:'Bản phát hành',dailyDigest:'Tóm tắt trong ngày',
};
const groupOf=(row:NotificationItem,today:string)=>{
  const day=row.event_at.slice(0,10),delta=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);
  const weekday=(new Date(today+'T00:00:00Z').getUTCDay()+6)%7;
  return delta===0?'Hôm nay':delta>0&&delta<=weekday?'Tuần này':'Trước đó';
};
const timeOf=(value:string)=>{
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return match?`${match[3]}/${match[2]} · ${match[4]}:${match[5]}`:value;
};
const artOf=(row:NotificationItem,artwork:NotificationArtwork)=>{
  if(row.entity_kind==='song')return {img:artwork.tracks[row.entity_id||''],label:row.payload?.title||row.entity_id||'♫',round:false};
  if(row.entity_kind==='artist')return {img:artwork.artists[row.entity_id||''],label:row.entity_id||'NS',round:true};
  if(row.entity_kind==='release')return {img:row.payload?.cover||artwork.albums[`${row.payload?.artist||''}\u001f${row.payload?.title||''}`],label:row.payload?.title||'Album',round:false};
  return {img:'',label:'TT',round:false};
};
const artistDigestText=(row:NotificationItem)=>{
  const artist=String(row.payload?.artist||row.entity_id||'Nghệ sĩ');
  if(row.type==='artist_month_rank_1')return `${artist} lên #1 tháng`;
  if(row.type==='artist_forgotten')return `${artist} bị bỏ quên`;
  return row.body.replace(/\.$/,'');
};
const dailyDigestBody=(row:NotificationItem,rows:NotificationItem[])=>{
  if(row.type!=='daily_digest')return row.body;
  const day=row.event_at.slice(0,10);
  const items=rows.filter(item=>item.type!=='daily_digest'&&item.event_at.slice(0,10)===day);
  const artistItems=items.filter(item=>item.type.startsWith('artist_')&&item.type!=='artist_overdue');
  const details=artistItems.map(artistDigestText);
  const shown=details.slice(0,4);
  const artistPart=shown.length ? `${shown.join(' · ')}${details.length>shown.length?` · +${details.length-shown.length} artist`:''}` : '';
  const songCount=Number(row.payload?.songs)||items.filter(item=>item.type.startsWith('song_')).length;
  const releaseCount=Number(row.payload?.releases)||items.filter(item=>item.type.startsWith('release_')).length;
  const parts=[songCount&&`${songCount} thay đổi bài hát`,artistPart,releaseCount&&`${releaseCount} bản phát hành`].filter(Boolean);
  return parts.length?parts.join(' · ')+'.':row.body;
};

function NotificationArt({row,rows,artwork}:{row:NotificationItem;rows:NotificationItem[];artwork:NotificationArtwork}){
  if(row.type==='daily_digest'){
    const items=rows.filter(item=>item.type!=='daily_digest').slice(0,3);
    return <div className="notification-art notification-art-stack" aria-hidden="true">{items.map(item=>{const art=artOf(item,artwork);return <Thumb key={item.id} ini={art.label.slice(0,2).toUpperCase()} img={art.img} round={art.round} size={25}/>;})}</div>;
  }
  const art=artOf(row,artwork);
  return <div className={`notification-art${art.round?' round':''}`}><Thumb ini={art.label.slice(0,2).toUpperCase()} img={art.img} round={art.round} size={42}/></div>;
}

export function NotificationsScreen({c}:{c:Ctx}){
  const feed=useSyncExternalStore(subscribeNotifications,notificationSnapshot,notificationSnapshot);
  useEffect(()=>{void loadNotifications();},[]);
  const groups=useMemo(()=>{
    const map=new Map<string,NotificationItem[]>(),today=vnToday();
    feed.rows.forEach(row=>{const key=groupOf(row,today);map.set(key,[...(map.get(key)||[]),row]);});return map;
  },[feed.rows]);
  async function open(row:NotificationItem){
    if(!row.read_at)void markNotificationsRead([row.id]);
    if(row.type==='daily_digest'){
      c.go('overview',null,{scope:'Tháng',sel:{},rankFocus:undefined});
    }else if(row.entity_kind==='song'&&row.entity_id){
      c.set(()=>({rankFocus:{key:JSON.stringify(['song',row.entity_id]),kind:'song',label:row.payload?.title||row.title,request:Date.now()}}));
      c.go('top100');
    }else if(row.type==='artist_month_rank_1'&&row.entity_id){
      const asOf=String(row.payload?.asOf||vnToday()),scope=String(row.payload?.scope||asOf.slice(0,7));
      c.go('periodTop',`artists~${scope}~${asOf}`,{periodFilter:'Tất cả',periodSort:'Giờ nghe'});
    }else if(row.entity_kind==='artist'&&row.entity_id)c.go('artist',row.entity_id);
    else if(row.entity_kind==='release'&&row.payload?.artist&&row.payload?.title){
      rememberReleaseAlbum({id:row.payload.releaseId||row.entity_id,title:row.payload.title,artist:row.payload.artist,date:row.payload.date||'',type:row.payload.type||'Album',owned:false,url:row.payload.url||'',cover:row.payload.cover||'',sources:row.payload.sources});
      c.go('album',albumId(row.payload.artist,row.payload.title));
    }else c.go('trend');
  }
  return <div className="notifications-page">
    <div className="notification-toolbar">
      <span className="t3">{feed.unread?`${feed.unread} chưa đọc`:'Đã đọc tất cả'}</span>
      <div><button type="button" onClick={()=>void loadNotifications(true)}>Cập nhật</button>{feed.unread>0&&<button type="button" onClick={()=>void markNotificationsRead('all')}>Đọc tất cả</button>}</div>
    </div>
    {feed.error&&<div className="card notification-error" role="status">{feed.error}</div>}
    {!feed.rows.length&&!feed.busy&&!feed.error&&<div className="card notification-empty"><span aria-hidden="true">♢</span><strong>Chưa có thông báo</strong><p className="t2">Server sẽ lưu các thay đổi quan trọng sau những lần đồng bộ tiếp theo.</p></div>}
    {feed.busy&&!feed.rows.length&&<div className="notification-loading t3" role="status">Đang tải thông báo…</div>}
    {[...groups].map(([group,rows])=><section key={group} className="notification-group"><h2 className="sec">{group}</h2><div className="card notification-list">
      {rows.map(row=><button type="button" key={row.id} className={`notification-row priority-${row.priority}${row.read_at?' read':' unread'}`} onClick={()=>void open(row)}>
        <NotificationArt row={row} rows={feed.rows} artwork={feed.artwork}/><span className="notification-copy"><strong>{row.title}</strong><span>{dailyDigestBody(row,feed.rows)}</span><time>{timeOf(row.event_at)}</time></span>{!row.read_at&&<span className="notification-dot" aria-label="Chưa đọc"/>}
      </button>)}
    </div></section>)}
    {feed.next&&<button type="button" className="notification-more" disabled={feed.busy} onClick={()=>void loadMoreNotifications()}>{feed.busy?'Đang tải…':'Tải thông báo cũ hơn'}</button>}
    <section className="notification-settings" aria-label="Loại thông báo"><div className="card">
      {(Object.keys(labels) as (keyof NotificationSettings)[]).map(key=><label key={key} className="notification-setting"><span>{labels[key]}</span><input type="checkbox" checked={feed.settings[key]} onChange={async e=>{if(!await updateNotificationSettings({[key]:e.target.checked}))c.ptoast('Chưa lưu được cài đặt thông báo.');}}/></label>)}
    </div></section>
  </div>;
}


export function NotificationsPopup({c,close}:{c:Ctx;close:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const node=dialog.current;
    node?.showModal();
    return()=>node?.close();
  },[]);
  const context={...c,go:(...args:Parameters<Ctx['go']>)=>{close();c.go(...args);}};
  return <dialog ref={dialog} className="notification-popup" aria-labelledby="notification-popup-title" onCancel={close} onClose={close} onClick={e=>{if(e.target===e.currentTarget)close();}}>
    <div className="notification-popup-content">
      <header><h2 id="notification-popup-title">Thông báo</h2><button type="button" autoFocus aria-label="Đóng thông báo" onClick={close}>×</button></header>
      <div className="notification-popup-scroll"><NotificationsScreen c={context}/></div>
    </div>
  </dialog>;
}
