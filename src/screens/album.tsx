import { LastfmTrackMetrics } from '@/components/lastfm-track-metrics';
import { ShortcutTarget, albumShortcut, artistShortcut } from '@/components/shortcuts';
import { useEffect, useState } from 'react';
import { DiscoveryError, loadAlbumTracks, loadSimilarAlbums, vnDate, type AlbumCatalog, type SimilarAlbum } from '@/lib/discovery';
import { albumId, mergeAlbumTracks, unreleasedTrack } from '@/lib/albums';
import { durationLabel } from '@/lib/metadata';
import { ini } from '@/lib/fmt';
import { Ctx, VM } from '@/vm';
import { AppleMusicArtwork } from '@/components/apple-music-artwork';
import { compactPlays, MusicMetadata, SongTitle } from '@/components/music-metadata';
import { EmptyState, SampleChip, Thumb } from '@/components/ui';
import { SongListRow } from './main';


function SimilarAlbumsSection({ album, c }: { album: any; c: Ctx }) {
  const [albums, setAlbums] = useState<SimilarAlbum[] | null>(null), [error, setError] = useState<DiscoveryError | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!album?.artist || !album?.title) return;
    const controller = new AbortController();
    setError(null); setAlbums(null);
    loadSimilarAlbums(album.artist, album.title, controller.signal)
      .then(result => { if (!controller.signal.aborted) setAlbums(result); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof DiscoveryError ? e : new DiscoveryError('Chưa tải được album tương tự.')); });
    return () => controller.abort();
  }, [album?.artist, album?.title, attempt]);
  const openLocal = (r: SimilarAlbum) => c.go('album', albumId(r.artist, r.title));
  return <section className="similar-section" aria-label="Album tương tự">
    <div className="sec">Album tương tự <span className="t3" style={{fontSize:'var(--type-caption, 11px)',fontWeight:400}}>· Last.fm</span></div>
    <div className="card">
      {error ? <div className="pad discovery-error" role="status"><p>{error.message}</p><button type="button" className="discovery-action" onClick={() => setAttempt(n => n + 1)}>Thử lại</button></div>
        : !albums ? <p className="pad t3" role="status">Đang tìm album tương tự…</p>
        : !albums.length ? <p className="pad t2">Last.fm chưa có gợi ý album tương tự.</p>
        : albums.slice(0, 8).map(r => <AppleMusicArtwork key={r.url} className="row song-row similar-track" query={{kind:'album',artist:r.artist,title:r.title}} notify={c.ptoast} lazy>
          <div className="song-artwork"><Thumb ini={ini(r.title)} img={r.image} size={52}/></div>
          <div className="song-copy">
            <div className="sub13 ell tone-gray">{r.artist}</div>
            <div className="song-title-line"><button type="button" className="album-name-link acc ell" onClick={() => openLocal(r)}>{r.title}</button></div>
          </div>
          <div className="song-metrics num"><strong>{Math.round(r.match * 100)}%</strong><span className="t3">match</span></div>
        </AppleMusicArtwork>)}
    </div>
  </section>;
}

export function AlbumScreen({vm,c}:{vm:VM;c:Ctx}) {
  const album=vm.album;
  const identity=JSON.stringify([album?.artist,album?.title,album?.releaseId]);
  const [catalog,setCatalog]=useState<{identity:string;data:AlbumCatalog|null}|null>(null);
  const expanded=!!album;
  const [error,setError]=useState(''), [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!album || !expanded)return;
    const controller=new AbortController();
    setError('');setCatalog(null);
    loadAlbumTracks(album.artist,album.title,album.releaseId,controller.signal).then(data=>{
      if(!controller.signal.aborted)setCatalog({identity,data});
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message || 'Chưa tải được danh sách bài hát.');});
    return ()=>controller.abort();
  },[identity,attempt,expanded]);
  const current=catalog?.identity===identity ? catalog : null;
  const full=expanded?current?.data:null;
  const rows=album ? full ? mergeAlbumTracks(full.tracks,album.songs) : album.songs.map((r:any)=>({...r,local:r})) : [];
  const today=vnDate();
  const discs=[...new Set<number>(rows.map((r:any)=>r.disc))];
  if(!album)return <EmptyState title="Không tìm thấy album" note="Album này chưa có bài hát trong dữ liệu thư viện."/>;
  return <>
    <SampleChip show={vm.sampleChip} text={vm.chipText}/>
    <div className="album-detail-header">
      <AppleMusicArtwork query={{kind:'album',artist:album.artist,title:album.title,releaseId:album.releaseId}} notify={c.ptoast}>
        <Thumb ini={album.ini} img={album.img} size={112}/>
      </AppleMusicArtwork>
      <div className="album-detail-copy">
        <ShortcutTarget entity={albumShortcut(album)}><h1>{album.title}</h1></ShortcutTarget>
        {album.artist && <ShortcutTarget entity={artistShortcut({name:album.artist,onTap:album.goArtist})}><button type="button" className="album-artist-link" onClick={album.goArtist}>{album.artist}</button></ShortcutTarget>}
        <MusicMetadata items={album.metadata}/>
      </div>
    </div>
    {album.metrics.length>0 && <div className="artist-summary-metrics">
      {album.metrics.map((m:any,i:number)=><div key={m.label} className="stat-box">
        <div className={`num metric-value${i===1?' metric-duration':''}`}>{m.value}</div>
        <div className="t2 metric-label">{m.label}</div>
      </div>)}
    </div>}
    <div className="album-tracks" aria-label="Bài hát trong album">
    {error ? <div className="card pad t2" role="status">{error} <button type="button" className="discovery-action" onClick={()=>setAttempt(n=>n+1)}>Thử lại</button></div>
      : !current ? <div className="card pad t3" role="status">Đang tải danh sách đầy đủ…</div>
      : !full && <div className="card pad t2" role="status">Chưa tìm thấy danh sách đầy đủ của phiên bản này. <button type="button" className="discovery-action" onClick={()=>setAttempt(n=>n+1)}>Thử lại</button></div>}
    {discs.map(disc=><section key={disc}>
      {discs.length>1 && <div className="cap">Đĩa {disc}</div>}
      <div className="card song-list">{rows.filter((r:any)=>r.disc===disc).map((r:any)=>r.local ? <div key={r.id || r.tid}>
        <SongListRow r={{...r.local,trackNumber:r.trackNumber,titleTone:unreleasedTrack(r.local.releaseDate || r.releaseDate,today)?'unreleased':r.local.gone?'muted':r.local.titleTone,metadata:[
          {text:compactPlays(r.local.metric),title:'Lượt nghe',tone:'gold'},
          {text:r.local.listening,title:'Thời gian nghe',tone:'gray'},
          ...(r.local.metadata?.filter((m:any)=>m.title!=='Năm phát hành') || []),
        ].filter((m:any)=>m.text)}} right={expanded ? <LastfmTrackMetrics artist={r.local.artist} title={r.local.title} trackId={r.local.tid} outsideLibrary={!!r.local.gone && !unreleasedTrack(r.local.releaseDate || r.releaseDate,today)}/> : undefined} hideAlbum hideArtist/>
        {r.local.gone && <div className="album-removed t3">Không còn trong thư viện</div>}
      </div> : <AppleMusicArtwork key={r.id} className="row song-row similar-track" query={{kind:'song',artist:r.artist,title:r.title,album:album.title}} notify={c.ptoast} lazy>
        <div className="song-artwork"><Thumb ini={ini(r.title)} img={album.img} size={52}/></div>
        <div className="song-copy">
          <SongTitle title={r.title} tone={unreleasedTrack(r.releaseDate,today)?'unreleased':'muted'} trackNumber={r.trackNumber} items={r.duration_s ? [{text:durationLabel(r.duration_s),title:'Độ dài bài hát',tone:'gray'}] : []}/>
        </div>
        <LastfmTrackMetrics artist={r.artist} title={r.title} outsideLibrary={!unreleasedTrack(r.releaseDate,today)}/>
      </AppleMusicArtwork>)}</div>
    </section>)}
    {full && <div className="album-catalog-source t3">{full.tracks.length} bài · <a href={full.sourceUrl} target="_blank" rel="noreferrer">{full.source} ↗</a></div>}
    </div>
    <div className="card album-info" aria-label="Thông tin album">{album.info.map((r:any)=><div className="album-info-row" key={r.k}>
      <span className="t2">{r.k}</span><span className={`num tone-${r.tone || 'gray'}`}>{r.v}</span>
    </div>)}</div>
    <SimilarAlbumsSection album={album} c={c}/>
  </>;
}
