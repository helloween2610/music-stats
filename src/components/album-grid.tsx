import { ShortcutTarget, albumShortcut } from './shortcuts';
import { ArtworkRank } from './artwork-rank';
import { compactPlays, MusicMetadata } from './music-metadata';
import { Thumb } from './ui';

const playCount = (value?: string) => /(?: lượt|x)$/.test(value || '');

export function AlbumGrid({albums,showRank=false,hideArtist=false}:{albums:any[];showRank?:boolean;hideArtist?:boolean}) {
  return <div className="album-grid">{albums.map((r,k)=><ShortcutTarget key={r.ak || k} entity={albumShortcut(r)}><button type="button" className="album-tile" onClick={r.onTap} aria-label={`Mở album: ${r.title} · ${r.artist}`}>
    <div className="album-cover"><Thumb ini={r.ini} img={r.img} size={160}/><ArtworkRank rank={r.allTimeRank} change={r.allTimeChange} comparison={r.allTimeComparison}/></div>
    <div className="album-title">{showRank && <span className="t3">{r.rank}. </span>}{r.title}</div>
    {!hideArtist && <div className="sub13 ell">{r.artist}</div>}
    <MusicMetadata items={r.metadata}/>
    {(r.v || r.plays) && (() => {
      const first = playCount(r.v) ? r.plays : r.v;
      const second = playCount(r.v) ? r.v : r.plays;
      return <div className="tile-metrics num"><strong>{compactPlays(first)}</strong>{second && <span>{compactPlays(second)}</span>}</div>;
    })()}
  </button></ShortcutTarget>)}</div>;
}
