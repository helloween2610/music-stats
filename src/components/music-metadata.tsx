import {MetadataHelp} from './metadata-help';
import type { MetaItem } from '@/lib/metadata';

// Keep rating metadata available; title color is the visible rating indicator.
export const SHOW_METADATA_RATING = false;
const durationItem = (m: MetaItem) => m.title === 'Độ dài bài hát';
export const compactPlays = (value?: string) => value?.replace(/(\d[\d.,]*)\s+lượt/g, '$1x');

export function SongTitle({ title, tone = 'gray', items, large = false, trackNumber }: { title: string; tone?: string; items?: MetaItem[]; large?: boolean; trackNumber?: number }) {
  const duration = items?.find(durationItem);
  const rating=items?.find(m=>m.title==='Đánh giá của bạn');
  const name=<div className={`title15 ell tone-${tone}`} title={title}>{title}</div>;
  return <div className={'song-title-line' + (large ? ' large' : '')}>
    {Number.isInteger(trackNumber) && trackNumber! > 0 && <span className="song-track-number num" aria-label={`Track ${trackNumber}`}>{trackNumber}.</span>}
    {rating ? <MetadataHelp item={{...rating,detail:title}}>{name}</MetadataHelp> : name}
    {duration && <MetadataHelp item={duration}><span className={`song-duration num tone-${duration.tone || 'gray'}`} title={`Độ dài bài hát: ${duration.text}`} aria-label={`Độ dài bài hát: ${duration.text}`}>{duration.text}</span></MetadataHelp>}
  </div>;
}

export function MusicMetadata({ items, hideAdded = false }: { items?: MetaItem[]; hideAdded?: boolean }) {
  const rest = items?.filter(m => !durationItem(m) && (!hideAdded || m.title !== 'Thêm vào thư viện') && (SHOW_METADATA_RATING || m.title !== 'Đánh giá của bạn'));
  if (!rest?.length) return null;
  return <div className="music-metadata num">{rest.map((m, i) =>
    <MetadataHelp key={i} item={m}><span style={m.color ? {color:m.color} : undefined} className={`tone-${m.tone || 'gray'}`} title={`${m.title}: ${m.detail || m.text}`} aria-label={`${m.title}: ${m.detail || m.text}`}>{m.text}</span></MetadataHelp>
  )}</div>;
}
