import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { loadReleaseArtistList, releaseExclusions, releaseFilterEnabled, releaseSnapshot, saveReleaseScanSettings, setReleaseExcluded, setReleaseFilterEnabled, subscribeReleases, isReleaseExcluded, type ReleaseArtistList } from '@/lib/discovery';

const fold=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('vi');
const parseNames=(value:string)=>[...new Set(value.split(/[\n,]+/).map(s=>s.trim().replace(/\s+/g,' ')).filter(Boolean))];

export function ReleaseExclusionSettings({ inline=false, embedded=false }: { inline?: boolean; embedded?: boolean } = {}) {
  useSyncExternalStore(subscribeReleases,releaseSnapshot);
  const [open,setOpen]=useState(inline || embedded),[query,setQuery]=useState('');
  const [data,setData]=useState<ReleaseArtistList|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [watchText,setWatchText]=useState(''),[saving,setSaving]=useState(false),[savedNote,setSavedNote]=useState('');
  useEffect(()=>{
    if(!open || data)return;
    let active=true;setError('');
    loadReleaseArtistList().then(rows=>{if(!active)return;setData(rows);setWatchText(rows.watchlist.join('\n'));}).catch(()=>{if(active)setError('Chưa tải được danh sách nghệ sĩ.');});
    return ()=>{active=false;};
  },[open,data,attempt]);
  const localExcluded=releaseExclusions(),serverExcluded=data?.excluded || [],excluded=embedded?serverExcluded:localExcluded,filterOn=releaseFilterEnabled();
  const choices=useMemo(()=>[...new Set([...(data?.artists || []),...excluded])]
    .sort((a,b)=>a.localeCompare(b,'vi')).filter(n=>fold(n).includes(fold(query))),[data,excluded,query]);
  const watchlist=parseNames(watchText);
  const total=data?.total ?? data?.artists.length ?? 0;
  const base=data?.baseCount ?? Math.max(0,total-(data?.watchlist.length || 0));
  const recentDays=data?.recentDays || 90;
  const body=<div id="release-exclusions" className="release-exclusion-settings-body">
    <div className="release-scan-summary" role="status">
      <span><strong>{total || '—'}</strong> nghệ sĩ đang quét</span>
      <span>{base || '—'} từ thư viện</span>
      <span>{data?.watchlist.length || 0} watchlist</span>
      <span>{excluded.length} đang bỏ qua</span>
    </div>
    {embedded && <div className="release-setting-block"><span className="title15">Khoảng quét mới phát hành</span><div className="release-days-toggle" role="radiogroup" aria-label="Khoảng quét mới phát hành">{([90,180] as const).map(days=><button key={days} type="button" role="radio" aria-checked={recentDays===days} className={recentDays===days?'on':''} onClick={async()=>{
      if(days===recentDays)return;
      const previous=recentDays;setData(d=>d?{...d,recentDays:days}:d);setError('');
      try{const saved=await saveReleaseScanSettings({watchlist:data?.watchlist || watchlist,excluded:serverExcluded,recentDays:days});setData(d=>d?{...d,recentDays:saved.recentDays || days,watchlist:saved.watchlist,excluded:saved.excluded}:d);}
      catch(err){setData(d=>d?{...d,recentDays:previous}:d);setError(err instanceof Error?err.message:'Chưa lưu được khoảng quét.');}
    }}>{days} ngày</button>)}</div><p className="sub13">Áp dụng cho tab Mới phát hành và lần cron quét server kế tiếp.</p></div>}
    {!embedded && <label className="release-filter-toggle"><input type="checkbox" checked={filterOn} onChange={e=>setReleaseFilterEnabled(e.target.checked)}/><span>Áp dụng bộ lọc bỏ qua trên máy này</span></label>}
    <p className="sub13">{embedded ? 'Danh sách tự động lấy từ thư viện: nghệ sĩ nghe trên 30 phút All time hoặc có bài Melodeath metal. Đánh dấu một nghệ sĩ để server bỏ qua trong lần quét kế tiếp.' : 'Danh sách tự động lấy từ thư viện: nghệ sĩ nghe trên 30 phút All time hoặc có bài Melodeath metal. Tắt công tắc để xem lại cả các nghệ sĩ đã bỏ qua.'}</p>
    <input className="release-exclusion-search" type="search" aria-label="Tìm nghệ sĩ đang quét" placeholder="Tìm trong danh sách nghệ sĩ đang quét" value={query} onChange={e=>setQuery(e.target.value)}/>
    {error && <p role="alert" className="sub13">{error} <button className="discovery-action" onClick={()=>setAttempt(n=>n+1)}>Thử lại</button></p>}
    {!data && !error && <p role="status" className="sub13">Đang tải nghệ sĩ…</p>}
    <div className="release-exclusion-list">
      {choices.map(name=>{
        const manual=(data?.watchlist || []).some(n=>fold(n)===fold(name));
        const checked=embedded?serverExcluded.some(n=>fold(n)===fold(name)):isReleaseExcluded(name);
        return <label key={name} className="release-exclusion-option"><span>{name}{manual && <em>watchlist</em>}</span><input type="checkbox" checked={checked} onChange={async e=>{
          if(!embedded){try{setReleaseExcluded(name,e.target.checked);setError('');}catch{setError('Chưa lưu được lựa chọn. Hãy thử lại.');}return;}
          const next=e.target.checked?[...serverExcluded.filter(n=>fold(n)!==fold(name)),name]:serverExcluded.filter(n=>fold(n)!==fold(name));
          setData(d=>d?{...d,excluded:next}:d);setError('');
          try{const saved=await saveReleaseScanSettings({watchlist:data?.watchlist || watchlist,excluded:next,recentDays});setData(d=>d?{...d,excluded:saved.excluded,watchlist:saved.watchlist,recentDays:saved.recentDays || recentDays}:d);}
          catch(err){setData(d=>d?{...d,excluded:serverExcluded}:d);setError(err instanceof Error?err.message:'Chưa lưu được bộ lọc quét.');}
        }}/></label>;
      })}
      {data && !choices.length && <p className="sub13">Không tìm thấy nghệ sĩ phù hợp.</p>}
    </div>
    <div className="release-watchlist-editor">
      <label className="title15" htmlFor="release-watchlist">Watchlist nghệ sĩ thủ công</label>
      <p className="sub13">Thêm nghệ sĩ chưa nằm trong bộ lọc thư viện, ví dụ Alcest. Mỗi dòng một nghệ sĩ hoặc cách nhau bằng dấu phẩy. Cron server sẽ quét từ lần chạy kế tiếp.</p>
      <textarea id="release-watchlist" value={watchText} onChange={e=>{setWatchText(e.target.value);setSavedNote('');}} placeholder={'Alcest\nOpeth'} rows={Math.max(3,Math.min(8,watchText.split('\n').length+1))}/>
      <div className="release-watchlist-actions"><button className="discovery-action" disabled={saving} onClick={async()=>{
        setSaving(true);setError('');setSavedNote('');
        try{
          const saved=await saveReleaseScanSettings({watchlist,excluded:serverExcluded,recentDays});
          setData(d=>d?{...d,watchlist:saved.watchlist,excluded:saved.excluded,recentDays:saved.recentDays || recentDays,artists:[...new Set([...d.artists,...saved.watchlist])],total:Math.max(d.baseCount+saved.watchlist.length,d.total)}:d);
          setWatchText(saved.watchlist.join('\n'));setSavedNote('Đã lưu watchlist trên server.');
        }catch(e){setError(e instanceof Error?e.message:'Chưa lưu được watchlist.');}
        finally{setSaving(false);}
      }}>{saving?'Đang lưu…':'Lưu watchlist'}</button><span className="sub13">{watchlist.length} nghệ sĩ</span>{savedNote && <span className="sub13 ok">{savedNote}</span>}</div>
    </div>
  </div>;
  if(embedded)return <div className="card release-scan-panel release-scan-panel-embedded"><div className="release-scan-heading"><span className="title15">Nghệ sĩ đang quét</span><span className="sub13">{total ? `${total} nghệ sĩ · ${excluded.length} bỏ qua · ${data?.watchlist.length || 0} watchlist` : 'Danh sách scan, bộ lọc và watchlist'}</span></div>{body}</div>;
  return <>
    {!inline && <div className="cap">Lịch phát hành</div>}
    <div className={inline?'card release-scan-panel':'card'}>
      <button className="playlist-link" aria-expanded={open} aria-controls="release-exclusions" onClick={()=>setOpen(v=>!v)}>
        <span className="playlist-link-copy"><span className="title15">Nghệ sĩ đang quét</span><span className="sub13" style={{display:'block'}}>{total ? `${total} nghệ sĩ · ${excluded.length} bỏ qua · ${data?.watchlist.length || 0} watchlist` : 'Xem danh sách scan, bộ lọc và watchlist'}</span></span><span aria-hidden="true" className="t3">{open?'−':'+'}</span>
      </button>
      {open && body}
    </div>
  </>;
}
