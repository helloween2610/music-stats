export type PlaylistTrack = {
  title: string; artist?: string; album?: string; albumArtist?: string; duration?: number;
  year?: number; persistentId?: string; inLibrary?: boolean; missing?: boolean;
};
export type Playlist = {id:string; name:string; folder:string; favourite?:boolean; path:string; items:string[]};
export type PlaylistSnapshot = {exportedAt:string|null; folders:string[]; playlists:Playlist[]; tracks:Record<string,PlaylistTrack>};
export function playlistMetricMode(folder:string,track:PlaylistTrack,libraryReady:boolean,owned:boolean) {
  if(!libraryReady)return 'waiting';
  return !owned || folder==='_New Music' ? 'community' : 'local';
}

let snapshot: Promise<PlaylistSnapshot> | undefined;
export function loadPlaylistSnapshot() {
  return snapshot ||= import('@/data/playlists.json').then(data=>data.default as PlaylistSnapshot).catch(error=>{snapshot=undefined;throw error;});
}
const key = (value: unknown) => String(value || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g,' ');
export function playlistLibraryIndex(rows: any[]) {
  const pid = new Map<string, any[]>(), identity = new Map<string, any[]>();
  for (const row of rows) {
    if (row.in_library !== 1) continue;
    if (row.apple_pid) pid.set(row.apple_pid,[...(pid.get(row.apple_pid)||[]),row]);
    const k = [row.title,row.artist || row.album_artist,row.album].map(key).join('\u001f');
    identity.set(k,[...(identity.get(k)||[]),row]);
  }
  return (track:PlaylistTrack) => {
    if (track.missing) return undefined;
    const matches = track.persistentId ? pid.get(track.persistentId) : undefined;
    if (matches?.length === 1) return matches[0];
    const byName = identity.get([track.title,track.artist || track.albumArtist,track.album].map(key).join('\u001f'));
    return byName?.length === 1 ? byName[0] : undefined;
  };
}

export const PLAYLIST_SORTS = ['Thứ tự gốc', 'Tên bài', 'Nghệ sĩ', 'Album', 'Năm mới nhất', 'Dài nhất'] as const;
export type PlaylistSort = typeof PLAYLIST_SORTS[number];
export function sortPlaylistRows<T extends {index:number;track:PlaylistTrack}>(rows:T[],sort:PlaylistSort):T[] {
  const text=(a?:string,b?:string)=>(a || '').localeCompare(b || '', 'vi', {numeric:true,sensitivity:'base'});
  return [...rows].sort((a,b)=>{
    const x=a.track,y=b.track;
    const delta=sort==='Tên bài'?text(x.title,y.title):sort==='Nghệ sĩ'?text(x.artist,y.artist):sort==='Album'?text(x.album,y.album):sort==='Năm mới nhất'?(y.year||0)-(x.year||0):sort==='Dài nhất'?(y.duration||0)-(x.duration||0):0;
    return delta || a.index-b.index;
  });
}
