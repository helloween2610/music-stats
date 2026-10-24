import { LastfmMetricValues } from '@/components/lastfm-track-metrics';
import { ShortcutTarget, songShortcut, artistShortcut, albumShortcut } from '@/components/shortcuts';
import { ArtworkRank } from '@/components/artwork-rank';
import { AppleMusicArtwork } from '@/components/apple-music-artwork';
import { Chips, Thumb } from '@/components/ui';
import { SongTitle } from '@/components/music-metadata';
import { ReleaseExclusionSettings } from '@/components/release-exclusion-settings';
import { canonicalAlbum } from '@/lib/album-groups';
import { durationLabel } from '@/lib/metadata';
import { fmtH, ini, vn } from '@/lib/fmt';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Ctx } from '@/vm';
import { albumId } from '@/lib/albums';
import { DiscoveryError, isReleaseSaved, rememberReleaseAlbum, loadAlbumRecommendations, loadLyrics, loadSimilarTracks, openReleases, loadReleases, releaseDate, releaseGroup, releasePhase, releaseInWindow, releaseScanLabel, releaseSnapshot, savedReleaseAlbums, savedReleaseExclusions, setSavedReleaseExcluded, subscribeReleases, subscribeSavedReleases, vnDate, type AlbumRecommendation, type Lyrics, type Release, type SavedReleaseSource, type SimilarTrack } from '@/lib/discovery';
import { loadPlaylistSnapshot, type PlaylistSnapshot } from '@/lib/playlists';

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

const isSyntheticReleaseId=(id:string)=>id.startsWith('playlist-recommend:') || id.startsWith('saved:');
function ReleaseCard({ release: r, c, saved, savedSource = 'other', sourceBadge, actions }: { release: Release; c: Ctx; saved: boolean; savedSource?: SavedReleaseSource; sourceBadge?:string; actions?: {label:string;symbol?:string;onRun:()=>void}[] }) {
  function openAlbum() {
    if(!isSyntheticReleaseId(r.id))rememberReleaseAlbum(r);
    c.go('album',albumId(r.artist,r.title));
  }
  const releaseId=isSyntheticReleaseId(r.id)?undefined:r.id;
  const entity={...albumShortcut({...r,releaseId,onTap:openAlbum,releaseSavedSource:savedSource}),actions};
  const dateLabel=r.date && sourceBadge && /^\d{4}$/.test(r.date) ? r.date : releaseDate(r.date);
  return <ShortcutTarget entity={entity}><article className={['release-card',saved?'is-saved':''].filter(Boolean).join(' ')}>
    <button type="button" className="release-cover" onClick={openAlbum} aria-label={`Mở album: ${r.title} · ${r.artist}`}>
      <span aria-hidden="true">{r.artist.split(/\s+/).map(s=>s[0]).slice(0,2).join('')}</span>
      <img src={r.cover} alt={`Bìa ${r.title}`} loading="lazy" onError={e=>{e.currentTarget.style.display='none';}} />
    </button>
    <button type="button" className="release-title" onClick={openAlbum}>{r.title}</button>
    <ShortcutTarget entity={artistShortcut({name:r.artist})}><button className="release-artist" onClick={()=>c.go('artist', r.artist)}>{r.artist}</button></ShortcutTarget>
    <div className="release-badges num">{r.date && <time dateTime={r.date}>{dateLabel}</time>}{sourceBadge ? <span>{sourceBadge}</span> : <span>{r.type}</span>}</div>
    {r.owned && <div className="release-owned">✓ Có trong thư viện</div>}
  </article></ShortcutTarget>;
}
function RecommendedAlbums({c}:{c:Ctx}) {
  const [data,setData]=useState<{seeds:any[];rows:AlbumRecommendation[];source:string}|null>(null),[error,setError]=useState<DiscoveryError|null>(null),[attempt,setAttempt]=useState(0);
  const [force,setForce]=useState(false);
  const [excluded,setExcluded]=useState<Set<string>>(()=>readRecommendationExclusions());
  useEffect(()=>{
    const controller=new AbortController();
    setError(null);
    loadAlbumRecommendations(controller.signal,force).then(result=>{if(!controller.signal.aborted)setData(result);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof DiscoveryError?e:new DiscoveryError('Chưa tải được album gợi ý.'));});
    return()=>controller.abort();
  },[attempt,force]);
  const refresh=()=>{setForce(true);setData(null);setAttempt(n=>n+1);};
  const exclude=(row:AlbumRecommendation)=>{
    const next=new Set(excluded);next.add(recommendationExcludeKey(row.artist,row.title));
    saveRecommendationExclusions(next);setExcluded(next);c.ptoast('Đã loại khỏi gợi ý');
  };
  const rows=data?.rows.filter(row=>!excluded.has(recommendationExcludeKey(row.artist,row.title))) || [];
  return <>
    <div className="release-tools">
      <div className="release-status t3" role="status">Top 5 Albums trong 30 ngày · chỉ lấy album nghe trên 1 giờ · nguồn {data?.source || 'MusicBrainz'}</div>
      {data?.seeds?.length ? <div className="release-status t3">Seed: {data.seeds.map(seed=>`${seed.title} (${fmtH(seed.hours)})`).join(' · ')}</div> : null}
      <div className="release-actions">
        <button type="button" className="discovery-action compact-action" disabled={!data && !error} onClick={refresh}>Quét lại</button>
        {error && <Retry compact error={error} onRetry={()=>setAttempt(n=>n+1)} />}
      </div>
    </div>
    {!data && !error ? <p className="pad t3" role="status">Đang tìm album tương tự…</p>
      : data && !data.seeds.length ? <div className="card pad release-empty"><strong>Chưa đủ album seed</strong><p className="t2">Cần ít nhất một album trong top 5 của 30 ngày gần đây có tổng thời lượng nghe trên 1 giờ.</p></div>
      : data && !rows.length ? <div className="card pad release-empty"><strong>Chưa có gợi ý phù hợp</strong><p className="t2">MusicBrainz/Last.fm chưa có thêm album phù hợp, hoặc các album hiện có đã bị loại khỏi gợi ý.</p></div>
      : data ? <div className="release-grid recommendation-grid">{rows.map(row=><RecommendationCard key={row.id} row={row} c={c} onExclude={()=>exclude(row)}/>)}</div> : null}
  </>;
}
const RECOMMENDATION_EXCLUDES='music-stats:album-recommendation-exclusions:v1';
const recommendationExcludeKey=(artist:string,title:string)=>JSON.stringify([artist,title].map(value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')));
function readRecommendationExclusions(){
  try { const value=JSON.parse(localStorage.getItem(RECOMMENDATION_EXCLUDES)||'[]'); return new Set(Array.isArray(value)?value.filter(item=>typeof item==='string'):[]); }
  catch { return new Set<string>(); }
}
function saveRecommendationExclusions(value:Set<string>){
  try { localStorage.setItem(RECOMMENDATION_EXCLUDES,JSON.stringify([...value].slice(-500))); } catch {}
}
function RecommendationCard({row,c,onExclude}:{row:AlbumRecommendation;c:Ctx;onExclude:()=>void}) {
  function openAlbum() {
    rememberReleaseAlbum({
      id: row.id,
      title: row.title,
      artist: row.artist,
      date: row.date || '',
      type: row.type || 'Album',
      owned: false,
      url: row.url,
      cover: row.cover,
      sources: row.source === 'MusicBrainz' ? ['MusicBrainz'] : undefined,
    });
    c.go('album',albumId(row.artist,row.title));
  }
  const shortcut={...albumShortcut({...row,releaseId:row.id,onTap:openAlbum,releaseSavedSource:'recommend'}),actions:[{label:'Exclude',symbol:'×',onRun:onExclude}]};
  return <ShortcutTarget entity={shortcut}><article className="release-card recommendation-card">
    <button type="button" className="release-cover" onClick={openAlbum} aria-label={`Mở album: ${row.title} · ${row.artist}`}>
      <span aria-hidden="true">{row.artist.split(/\s+/).map(s=>s[0]).slice(0,2).join('')}</span>
      {row.cover && <img src={row.cover} alt={`Bìa ${row.title}`} loading="lazy" onError={e=>{e.currentTarget.style.display='none';}} />}
    </button>
    <button type="button" className="release-title" onClick={openAlbum}>{row.title}</button>
    <ShortcutTarget entity={artistShortcut({name:row.artist})}><button className="release-artist" onClick={()=>c.go('artist', row.artist)}>{row.artist}</button></ShortcutTarget>
    <div className="release-badges num">{row.date && <time dateTime={row.date}>{releaseDate(row.date)}</time>}<span>{row.source}</span><span>{row.source==='Last.fm'?'100%':`${vn(row.score)} điểm`}</span></div>
    <div className="release-reason">Tương tự <strong>{row.similarTo.title}</strong></div>
  </article></ShortcutTarget>;
}
const releaseIdentity=(release:Pick<Release,'artist'|'title'>)=>JSON.stringify([release.artist,release.title].map(value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')));
const savedSourceName=(source:'all'|SavedReleaseSource)=>source==='all'?'Tất cả':source==='other'?'Khác':source==='recommend'?'Gợi ý':source==='playlistRecommend'?'Đề xuất':source==='recent'?'Mới phát hành':'Sắp ra mắt';
function uniqueReleases(rows:Release[]) {
  const seen=new Set<string>(), out:Release[]=[];
  rows.forEach(row=>{const key=releaseIdentity(row);if(!seen.has(key)){seen.add(key);out.push(row);}});
  return out;
}
function recommendedPlaylistAlbums(snapshot:PlaylistSnapshot|null):Release[] {
  const playlist=snapshot?.playlists.find(item=>/^A_Recommend albums?$/i.test(item.name.trim()));
  if(!playlist)return [];
  const rows:Release[]=[];
  const seen=new Set<string>();
  playlist.items.forEach((trackId,index)=>{
    const track=snapshot?.tracks[trackId];
    if(!track?.album)return;
    const artist=track.albumArtist || track.artist || '';
    if(!artist)return;
    const title=canonicalAlbum(artist,track.album);
    const key=releaseIdentity({artist,title});
    if(seen.has(key))return;
    seen.add(key);
    rows.push({
      id:'playlist-recommend:'+trackId+':'+index,
      title,artist,
      date:track.year&&track.year>0?String(track.year):'',
      type:'Album',
      owned:false,
      url:'',
      cover:'',
    });
  });
  return rows;
}
export function ReleasesScreen({ c }: { c: Ctx }) {
  const feed = useSyncExternalStore(subscribeReleases, releaseSnapshot);
  const savedRows = useSyncExternalStore(subscribeSavedReleases, savedReleaseAlbums);
  const savedExclusions = useSyncExternalStore(subscribeSavedReleases, savedReleaseExclusions);
  const [playlistSnapshot,setPlaylistSnapshot]=useState<PlaylistSnapshot|null>(null);
  const [savedSource,setSavedSource]=useState<'all'|SavedReleaseSource>('all');
  const mode=c.p.releaseMode, query=c.p.q;
  const setMode=(releaseMode:string)=>c.set(()=>({releaseMode}));
  const setQuery=(q:string)=>c.set(()=>({q}));
  useEffect(()=>{void openReleases();}, []);
  useEffect(()=>{
    let active=true;
    loadPlaylistSnapshot().then(snapshot=>{if(active)setPlaylistSnapshot(snapshot);}).catch(()=>{if(active)setPlaylistSnapshot(null);});
    return()=>{active=false;};
  },[]);
  const today = vnDate(), fold = (s: string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  const uncertain = feed.rows.filter(r=>releasePhase(r.date,today)==='unknown').length;
  const scanLabel = releaseScanLabel(feed.scan);
  const playlistRecommendRows=recommendedPlaylistAlbums(playlistSnapshot);
  const notExcluded=(release:Release)=>!savedExclusions.includes(releaseIdentity(release));
  const releaseYear=(release:Release)=>Number((release.date || '').slice(0,4)) || Infinity;
  const sortSaved=(items:Release[])=>[...items].sort((a,b)=>releaseYear(a)-releaseYear(b) || a.artist.localeCompare(b.artist,'vi',{numeric:true,sensitivity:'base'}) || a.title.localeCompare(b.title,'vi',{numeric:true,sensitivity:'base'}));
  const visibleSavedRows=savedRows.filter(notExcluded);
  const visiblePlaylistRecommendRows=playlistRecommendRows.filter(notExcluded);
  const savedPlaylistRecommendRows=uniqueReleases([...visiblePlaylistRecommendRows,...visibleSavedRows.filter(row=>(row.savedSource || 'other')==='playlistRecommend')]);
  const savedCounts=visibleSavedRows.reduce<Record<SavedReleaseSource,number>>((acc,row)=>{
    const source=row.savedSource || 'other';
    if(source!=='playlistRecommend')acc[source]=(acc[source]||0)+1;
    return acc;
  },{other:0,recommend:0,playlistRecommend:savedPlaylistRecommendRows.length,recent:0,upcoming:0});
  const savedAllRows=uniqueReleases([...visibleSavedRows,...visiblePlaylistRecommendRows]);
  const savedFilteredRows=sortSaved(savedSource==='all'?savedAllRows:savedSource==='playlistRecommend'?savedPlaylistRecommendRows:visibleSavedRows.filter(row=>(row.savedSource || 'other')===savedSource));
  const savedSourceLabel=savedSourceName(savedSource);
  const savedSourceOf=(release:Release):SavedReleaseSource=>{
    const stored=(release as typeof savedRows[number]).savedSource;
    if(stored)return stored;
    return playlistRecommendRows.some(row=>releaseIdentity(row)===releaseIdentity(release))?'playlistRecommend':'other';
  };
  const all = mode==='saved' ? savedFilteredRows : feed.rows.filter(r=>releaseInWindow(r.date,mode,today,feed.recentDays));
  const rows = all.filter(r=>fold(r.title+' '+r.artist).includes(fold(query.trim())));
  if(mode!=='saved')rows.sort((a,b)=>(mode==='recent' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.artist.localeCompare(b.artist));
  const groups = new Map<string, Release[]>();
  rows.forEach(r=>{const group=mode==='saved'?savedSourceLabel:releaseGroup(r.date,mode,today);groups.set(group,[...(groups.get(group)||[]),r]);});
  return <div className="releases-page">
    <div className="release-tabs" role="tablist" aria-label="Lịch phát hành">
      {[['recommend','Tương tự'],['saved','Saved'],['recent','Mới phát hành'],['upcoming','Sắp ra mắt'],['settings','⚙']].map(([id,label])=><button key={id} role="tab" aria-selected={mode===id} aria-label={id==='settings'?'Cài đặt':undefined} title={id==='settings'?'Cài đặt':undefined} className={['release-tab-button',id==='settings'?'icon-tab':'',mode===id?'on':''].filter(Boolean).join(' ')} onClick={()=>setMode(id)}>{label}</button>)}
    </div>
    {mode==='settings' ? <div className="release-tools"><ReleaseExclusionSettings embedded /></div> : mode==='recommend' ? <RecommendedAlbums c={c}/> : <>
      <div className="release-tools">
        <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm album, nghệ sĩ" aria-label="Tìm album, nghệ sĩ" />
        {mode==='saved' && <Chips compact style={{padding:'8px 0 0'}} items={[
          {label:`Tất cả ${savedAllRows.length}`,active:savedSource==='all',onTap:()=>setSavedSource('all')},
          {label:`Khác ${savedCounts.other}`,active:savedSource==='other',onTap:()=>setSavedSource('other')},
          {label:`Gợi ý ${savedCounts.recommend}`,active:savedSource==='recommend',onTap:()=>setSavedSource('recommend')},
          {label:`Đề xuất ${savedCounts.playlistRecommend}`,active:savedSource==='playlistRecommend',onTap:()=>setSavedSource('playlistRecommend')},
          {label:`Mới phát hành ${savedCounts.recent}`,active:savedSource==='recent',onTap:()=>setSavedSource('recent')},
          {label:`Sắp ra mắt ${savedCounts.upcoming}`,active:savedSource==='upcoming',onTap:()=>setSavedSource('upcoming')},
        ]}/>}
        <div className="release-status t3" role="status">{mode==='saved' ? `Saved · ${savedSourceLabel}` : mode==='recent' ? `${feed.recentDays} ngày gần đây` : '12 tháng tới'} · {all.length} bản phát hành
          {mode!=='saved' && feed.total>0 && <span> · Server {feed.checked}/{feed.total} nghệ sĩ</span>}
          {mode!=='saved' && scanLabel && <span> · {scanLabel}</span>}
        </div>
        {mode!=='saved' && feed.error && <div className="release-actions"><Retry compact error={feed.error} onRetry={()=>void loadReleases()} /></div>}
      </div>
      {[...groups].map(([label,items])=><section key={label}><h2 className="sec">{label}</h2><div className={'release-grid'+(mode==='saved'?' saved-release-grid':'')}>{items.map(r=>{
        const source=mode==='saved'?savedSourceOf(r):mode==='recent'?'recent':'upcoming';
        const shownRelease=source==='playlistRecommend'?{...r,owned:false}:r;
        return <ReleaseCard key={r.id} release={shownRelease} c={c} saved={isReleaseSaved(r)} savedSource={source} sourceBadge={mode==='saved'?savedSourceName(source):undefined} actions={mode==='saved'?[{label:'Exclude',symbol:'×',onRun:()=>{setSavedReleaseExcluded(r,true);c.ptoast('Đã ẩn album khỏi Saved.');}}]:undefined}/>;
      })}</div></section>)}
      {!rows.length && <div className="card pad release-empty"><div className="release-empty-icon" aria-hidden="true">♫</div>
        <strong>{mode==='saved' && !query ? 'Chưa có album Saved' : feed.busy ? 'Đang tải dữ liệu đã lưu…' : query ? 'Không có kết quả phù hợp' : 'Chưa tìm thấy bản phát hành'}</strong>
        <p className="t2">{query ? 'Thử tên album hoặc nghệ sĩ khác.' : mode==='saved' ? 'Long press một album ở bất kỳ đâu rồi chọn Saved để giữ lại vĩnh viễn.' : 'Lịch chỉ hiện các bản phát hành có dữ liệu từ nguồn, thuộc nghệ sĩ trong thư viện đã nghe trên 30 phút hoặc có bài Melodeath metal.'}</p>
      </div>}
    </>}
    <p className="release-footer t3">Nguồn lịch/gợi ý: <a href="https://musicbrainz.org" target="_blank" rel="noreferrer">MusicBrainz ↗</a> · <a href="https://bandcamp.com" target="_blank" rel="noreferrer">Bandcamp ↗</a> · Ảnh: Bandcamp / Cover Art Archive.<br/>
      Chạm bìa hoặc tên album để xem album. Chạm bìa lớn trong trang album để chia sẻ liên kết Apple Music.<br/>
      Lịch có thể chưa đầy đủ; ngày phát hành có thể thay đổi. Server quét lúc 07:30 mỗi ngày; app chỉ đọc danh sách đã lưu.
      {uncertain>0 && <span> {uncertain} mục mới có tháng/năm, chưa đủ thông tin để xếp lịch.</span>}
      {feed.unverified>0 && <span> Một số kết quả chưa xác minh đúng nghệ sĩ nên chưa hiển thị.</span>}
    </p>
  </div>;
}
