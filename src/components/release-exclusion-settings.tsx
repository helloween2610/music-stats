import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadReleaseArtists, releaseExclusions, releaseSnapshot, setReleaseExcluded, subscribeReleases, isReleaseExcluded } from '@/lib/discovery';

export function ReleaseExclusionSettings() {
  useSyncExternalStore(subscribeReleases,releaseSnapshot);
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');
  const [artists,setArtists]=useState<string[]|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!open || artists)return;
    let active=true;setError('');
    loadReleaseArtists().then(rows=>{if(active)setArtists(rows);}).catch(()=>{if(active)setError('Chưa tải được danh sách nghệ sĩ.');});
    return ()=>{active=false;};
  },[open,artists,attempt]);
  const excluded=releaseExclusions();
  const fold=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('vi');
  const choices=[...new Set([...(artists || []),...excluded])].sort((a,b)=>a.localeCompare(b,'vi')).filter(n=>fold(n).includes(fold(query)));
  return <>
    <div className="cap">Lịch phát hành</div>
    <div className="card">
      <button className="playlist-link" aria-expanded={open} aria-controls="release-exclusions" onClick={()=>setOpen(v=>!v)}>
        <span className="playlist-link-copy"><span className="title15">Loại trừ nghệ sĩ</span><span className="sub13" style={{display:'block'}}>{excluded.length ? `${excluded.length} nghệ sĩ đã loại trừ` : 'Đang theo dõi tất cả nghệ sĩ đủ điều kiện'}</span></span><span aria-hidden="true" className="t3">{open?'−':'+'}</span>
      </button>
      {open && <div id="release-exclusions" className="release-exclusion-settings-body">
        <p className="sub13" style={{marginBottom:8}}>Nghệ sĩ trong thư viện · nghe trên 30 phút All time hoặc có bài Melodeath metal.</p>
        <p className="sub13">Chọn nghệ sĩ để bỏ qua khi quét và ẩn khỏi Mới phát hành, Sắp ra mắt. Bỏ chọn để theo dõi lại.</p>
        <input className="release-exclusion-search" type="search" aria-label="Tìm nghệ sĩ để loại trừ" placeholder="Tìm nghệ sĩ" value={query} onChange={e=>setQuery(e.target.value)}/>
        <div className="sub13" role="status">{excluded.length} nghệ sĩ đã chọn · Lưu trên thiết bị này</div>
        {error && <p role="alert" className="sub13">{error} <button className="discovery-action" onClick={()=>setAttempt(n=>n+1)}>Thử lại</button></p>}
        {!artists && !error && <p role="status" className="sub13">Đang tải nghệ sĩ…</p>}
        <div className="release-exclusion-list">
          {choices.map(name=><label key={name} className="release-exclusion-option"><span>{name}</span><input type="checkbox" checked={isReleaseExcluded(name)} onChange={e=>{try{setReleaseExcluded(name,e.target.checked);setError('');}catch{setError('Chưa lưu được lựa chọn. Hãy thử lại.');}}}/></label>)}
          {artists && !choices.length && <p className="sub13">Không tìm thấy nghệ sĩ phù hợp.</p>}
        </div>
      </div>}
    </div>
  </>;
}
