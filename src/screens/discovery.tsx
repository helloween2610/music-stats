import { LastfmMetricValues } from '@/components/lastfm-track-metrics';
import { ShortcutTarget, songShortcut, artistShortcut, albumShortcut } from '@/components/shortcuts';
import { ArtworkRank } from '@/components/artwork-rank';
import { AppleMusicArtwork } from '@/components/apple-music-artwork';
import { Thumb } from '@/components/ui';
import { SongTitle } from '@/components/music-metadata';
import { ReleaseExclusionSettings } from '@/components/release-exclusion-settings';
import { durationLabel } from '@/lib/metadata';
import { ini } from '@/lib/fmt';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Ctx } from '@/vm';
import { albumId } from '@/lib/albums';
import { DiscoveryError, rememberReleaseAlbum, loadLyrics, loadSimilarTracks, openReleases, loadReleases, releaseDate, releaseGroup, releasePhase, releaseInWindow, releaseScanLabel, releaseSnapshot, subscribeReleases, vnDate, type Lyrics, type Release, type SimilarTrack } from '@/lib/discovery';

function Retry({ error, onRetry, compact = false }: { error: DiscoveryError; onRetry: () => void; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(()=>setNow(Date.now()), 1000); return ()=>clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.ceil((error.retryAt - now)/1000));
  const button = <button type="button" className="discovery-action" disabled={seconds>0} onClick={onRetry}>{seconds ? `Thử lại sau ${seconds}s` : 'Thử lại'}</button>;
  return compact ? button : <div className="discovery-error" role="status"><p>{error.message}</p>{button}</div>;
}
export function LyricsSection({ trackId }: { trackId: string }) {
  const [expanded, setExpanded] = useState(false), [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<Lyrics | null>(null), [error, setError] = useState<DiscoveryError | null>(null);
  useEffect(() => {
    if (!expanded || data) return;
    setError(null);
    if (!/^TR\d+$/.test(trackId || '')) { setData({status:'not_found',source:'LRCLIB'}); return; }
    const controller = new AbortController();
    loadLyrics(trackId, controller.signal).then(result=>{if(!controller.signal.aborted)setData(result);}).catch(e=>{
      if(!controller.signal.aborted)setError(e instanceof DiscoveryError ? e : new DiscoveryError('Chưa tải được lyrics. Hãy thử lại sau.'));
    });
    return ()=>controller.abort();
  }, [expanded, trackId, attempt]);
  return <section className="lyrics-section" aria-label="Lyrics">
    <button type="button" className="lyrics-toggle" aria-expanded={expanded} aria-controls={'lyrics-' + trackId} onClick={()=>setExpanded(value=>!value)}>
      <span>Lyrics</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div id={'lyrics-' + trackId} className="card pad">
      {error ? <Retry error={error} onRetry={()=>setAttempt(n=>n+1)} /> : !data ? <p className="t3" role="status">Đang tìm lời bài hát…</p>
        : data.status === 'found' ? <div className="lyrics-text">{data.text}</div>
        : <p className="t2">{data.status === 'instrumental' ? 'Bài nhạc không lời.' : 'Chưa tìm thấy lời phù hợp cho bài này.'}</p>}
      <a className="discovery-source" href="https://lrclib.net" target="_blank" rel="noreferrer">Nguồn: LRCLIB ↗</a>
    </div>}
  </section>;
}

export function SimilarTracksSection({ trackId, c, ranks = {}, changes = {}, comparisons = {} }: { trackId: string; c: Ctx; ranks?:Record<string,number>;changes?:Record<string,number>;comparisons?:Record<string,string> }) {
  const section = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false), [attempt, setAttempt] = useState(0);
  const [tracks, setTracks] = useState<SimilarTrack[] | null>(null), [error, setError] = useState<DiscoveryError | null>(null);
  useEffect(() => {
    if (!section.current || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e=>e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, {rootMargin:'180px'});
    observer.observe(section.current); return ()=>observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    setError(null);
    if (!/^TR\d+$/.test(trackId || '')) { setTracks([]); return; }
    const controller = new AbortController();
    loadSimilarTracks(trackId, controller.signal).then(result=>{if(!controller.signal.aborted)setTracks(result);}).catch(e=>{
      if(!controller.signal.aborted)setError(e instanceof DiscoveryError ? e : new DiscoveryError('Chưa tải được bài hát tương tự. Hãy thử lại sau.'));
    });
    return ()=>controller.abort();
  }, [visible, trackId, attempt]);
  return <section ref={section} aria-label="Bài hát tương tự" className="similar-section">
    <div className="sec">Bài hát tương tự <span className="t3" style={{fontSize: "var(--type-caption, 11px)",fontWeight:400}}>· Last.fm</span></div>
    <div className="similar-metrics-note t3">Scrobbles · lượt nghe trung bình mỗi người trên Last.fm</div>
    <div className="card">
      {error ? <div className="pad"><Retry error={error} onRetry={()=>setAttempt(n=>n+1)} /></div>
        : !tracks ? <p className="pad t3" role="status">Đang tìm bài hát tương tự…</p>
        : !tracks.length ? <p className="pad t2">Last.fm chưa có gợi ý cho bài này.</p>
        : tracks.map(track=><SimilarTrackRow key={track.url} track={track} rank={track.libraryTrackId ? ranks[track.libraryTrackId] : undefined} c={c} change={track.libraryTrackId ? changes[track.libraryTrackId] : undefined} comparison={track.libraryTrackId ? comparisons[track.libraryTrackId] : undefined} />)}
    </div>
  </section>;
}
function SimilarTrackRow({track,rank,c,change,comparison}: {track:SimilarTrack; rank?:number; c:Ctx;change?:number;comparison?:string}) {
  const content = <>
          <div className="song-artwork"><Thumb ini={ini(track.title)} img={track.image} size={52} /><ArtworkRank rank={rank} change={change} comparison={comparison} /></div>
          <div className="song-copy">
            <div className="sub13 ell tone-gray">{track.artist}</div>
            <SongTitle title={track.title} tone={track.libraryTrackId?'gray':'muted'} items={track.duration_s ? [{text:durationLabel(track.duration_s), title:'Độ dài bài hát', tone:'gray'}] : []} />
            {track.album && <div className="song-album-line"><div className="song-album ell" title={track.album}>{track.album}</div></div>}
          </div>
          <div className="song-metrics num">
            <LastfmMetricValues scrobbles={track.scrobbles} listeners={track.listeners} outsideLibrary={!track.libraryTrackId}/>

          </div>
  </>;
  return track.libraryTrackId
    ? <ShortcutTarget entity={songShortcut({...track,tid:track.libraryTrackId})}><button type="button" className="row song-row similar-track" onClick={()=>c.go('song',track.libraryTrackId!)} aria-label={`Mở bài hát trong thư viện: ${track.title}`}>{content}</button></ShortcutTarget>
    : <AppleMusicArtwork className="row song-row similar-track" query={{kind:'song',artist:track.artist,title:track.title,album:track.album}} notify={c.ptoast} lazy>{content}</AppleMusicArtwork>;
}

function ReleaseCard({ release: r, c }: { release: Release; c: Ctx }) {
  function openAlbum() {
    rememberReleaseAlbum(r);
    c.go('album',albumId(r.artist,r.title));
  }
  return <ShortcutTarget entity={albumShortcut({...r,releaseId:r.id,onTap:openAlbum})}><article className="release-card">
    <button type="button" className="release-cover" onClick={openAlbum} aria-label={`Mở album: ${r.title} · ${r.artist}`}>
      <span aria-hidden="true">{r.artist.split(/\s+/).map(s=>s[0]).slice(0,2).join('')}</span>
      <img src={r.cover} alt={`Bìa ${r.title}`} loading="lazy" onError={e=>{e.currentTarget.style.display='none';}} />
    </button>
    <button type="button" className="release-title" onClick={openAlbum}>{r.title}</button>
    <ShortcutTarget entity={artistShortcut({name:r.artist})}><button className="release-artist" onClick={()=>c.go('artist', r.artist)}>{r.artist}</button></ShortcutTarget>
    <div className="release-badges num"><time dateTime={r.date}>{releaseDate(r.date)}</time><span>{r.type}</span></div>
    {r.owned && <div className="release-owned">✓ Có trong thư viện</div>}
  </article></ShortcutTarget>;
}
export function ReleasesScreen({ c }: { c: Ctx }) {
  const feed = useSyncExternalStore(subscribeReleases, releaseSnapshot);
  const mode=c.p.releaseMode, query=c.p.q;
  const setMode=(releaseMode:string)=>c.set(()=>({releaseMode}));
  const setQuery=(q:string)=>c.set(()=>({q}));
  useEffect(()=>{void openReleases();}, []);
  const today = vnDate(), fold = (s: string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  const uncertain = feed.rows.filter(r=>releasePhase(r.date,today)==='unknown').length;
  const scanLabel = releaseScanLabel(feed.scan);
  const all = feed.rows.filter(r=>releaseInWindow(r.date,mode,today,feed.recentDays));
  const rows = all.filter(r=>fold(r.title+' '+r.artist).includes(fold(query.trim())))
    .sort((a,b)=>(mode==='recent' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.artist.localeCompare(b.artist));
  const groups = new Map<string, Release[]>();
  rows.forEach(r=>{const group=releaseGroup(r.date,mode,today);groups.set(group,[...(groups.get(group)||[]),r]);});
  return <div className="releases-page">
    <div className="release-tabs" role="tablist" aria-label="Lịch phát hành">
      {[['recent','Mới phát hành'],['upcoming','Sắp ra mắt'],['settings','Cài đặt']].map(([id,label])=><button key={id} role="tab" aria-selected={mode===id} className={mode===id?'on':''} onClick={()=>setMode(id as 'recent'|'upcoming'|'settings')}>{label}</button>)}
    </div>
    {mode==='settings' ? <div className="release-tools"><ReleaseExclusionSettings embedded /></div> : <>
      <div className="release-tools">
        <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm album, nghệ sĩ" aria-label="Tìm album, nghệ sĩ" />
        <div className="release-status t3" role="status">{mode==='recent' ? `${feed.recentDays} ngày gần đây` : '12 tháng tới'} · {all.length} bản phát hành
          {feed.total>0 && <span> · Server {feed.checked}/{feed.total} nghệ sĩ</span>}
          {scanLabel && <span> · {scanLabel}</span>}
        </div>
        {feed.error && <div className="release-actions"><Retry compact error={feed.error} onRetry={()=>void loadReleases()} /></div>}
      </div>
      {[...groups].map(([label,items])=><section key={label}><h2 className="sec">{label}</h2><div className="release-grid">{items.map(r=><ReleaseCard key={r.id} release={r} c={c}/>)}</div></section>)}
      {!rows.length && <div className="card pad release-empty"><div className="release-empty-icon" aria-hidden="true">♫</div>
        <strong>{feed.busy ? 'Đang tải dữ liệu đã lưu…' : query ? 'Không có kết quả phù hợp' : 'Chưa tìm thấy bản phát hành'}</strong>
        <p className="t2">{query ? 'Thử tên album hoặc nghệ sĩ khác.' : 'Lịch chỉ hiện các bản phát hành có dữ liệu từ nguồn, thuộc nghệ sĩ trong thư viện đã nghe trên 30 phút hoặc có bài Melodeath metal.'}</p>
      </div>}
    </>}
    <p className="release-footer t3">Nguồn lịch: <a href="https://musicbrainz.org" target="_blank" rel="noreferrer">MusicBrainz ↗</a> · <a href="https://bandcamp.com" target="_blank" rel="noreferrer">Bandcamp ↗</a> · Ảnh: Bandcamp / Cover Art Archive.<br/>
      Chạm bìa hoặc tên album để xem album. Chạm bìa lớn trong trang album để chia sẻ liên kết Apple Music.<br/>
      Lịch có thể chưa đầy đủ; ngày phát hành có thể thay đổi. Server quét lúc 07:30 mỗi ngày; app chỉ đọc danh sách đã lưu.
      {uncertain>0 && <span> {uncertain} mục mới có tháng/năm, chưa đủ thông tin để xếp lịch.</span>}
      {feed.unverified>0 && <span> Một số kết quả chưa xác minh đúng nghệ sĩ nên chưa hiển thị.</span>}
    </p>
  </div>;
}
