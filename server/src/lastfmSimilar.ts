import { lastfmMetadata } from './lastfmMetadata';
import { lyricTitle, SourceError, type DiscoveryStore, type Track } from './discovery';

export type SimilarTrack = { title: string; artist: string; url: string; match: number; scrobbles?: number; listeners?: number; album?: string; image?: string; duration_s?: number };
const nameKey = (value: string) => value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
export async function lastfmSimilar(track: Track, apiKey: string, store: DiscoveryStore, fetcher: typeof fetch = fetch) {
  const artist = track.artist?.trim() || track.album_artist?.trim(), title = lyricTitle(track.title);
  const empty = { source: 'Last.fm', tracks: [] as SimilarTrack[] };
  if (!artist || !title) return empty;
  const key = 'lastfm:similar:v2:' + JSON.stringify([nameKey(artist), nameKey(title)]);
  const saved = await store.get(key);
  if (saved) return saved;
  if (!apiKey) throw new SourceError('Chưa cấu hình kết nối Last.fm.');
  if (await store.get('cooldown:lastfm')) throw new SourceError('Last.fm đang giới hạn truy cập. Hãy thử lại sau.', 60);
  // Share the quota with track metadata, which may load on the same screen.
  if (!await store.acquire('lastfm', 500)) {
    await new Promise(resolve => setTimeout(resolve, 600));
    if (!await store.acquire('lastfm', 500)) throw new SourceError('Last.fm đang bận. Hãy thử lại sau.');
  }
  const qs = new URLSearchParams({ method: 'track.getSimilar', artist, track: title, api_key: apiKey, format: 'json', autocorrect: '0', limit: '10' });
  const res = await fetcher('https://ws.audioscrobbler.com/2.0/?' + qs, { signal: AbortSignal.timeout(10000) });
  if (res.status === 429) {
    await store.put('cooldown:lastfm', true, 60);
    throw new SourceError('Last.fm đang giới hạn truy cập. Hãy thử lại sau.', 60);
  }
  if (!res.ok) throw new SourceError('Chưa kết nối được Last.fm.');
  const body: any = await res.json();
  if (Number(body?.error) === 29) {
    await store.put('cooldown:lastfm', true, 60);
    throw new SourceError('Last.fm đang giới hạn truy cập. Hãy thử lại sau.', 60);
  }
  if (Number(body?.error) === 6) { await store.put(key, empty, 3600); return empty; }
  if (body?.error) throw new SourceError('Chưa tải được bài hát tương tự từ Last.fm.');
  const rows = body?.similartracks?.track;
  if (!Array.isArray(rows)) throw new SourceError('Last.fm trả dữ liệu chưa hợp lệ.');
  const seen = new Set([JSON.stringify([nameKey(artist), nameKey(title)])]);
  const tracks: SimilarTrack[] = [];
  for (const row of rows) {
    if (typeof row?.name !== 'string' || !row.name.trim() || typeof row.artist?.name !== 'string' || !row.artist.name.trim()) continue;
    const identity = JSON.stringify([nameKey(row.artist.name), nameKey(row.name)]);
    if (seen.has(identity)) continue;
    let url: URL;
    try { url = new URL(row.url); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || !['last.fm', 'www.last.fm'].includes(url.hostname) || url.username || url.password || url.port) continue;
    url.protocol = 'https:';
    const match = Number(row.match);
    if (!Number.isFinite(match) || match < 0) continue;
    seen.add(identity);
    tracks.push({ title: row.name, artist: row.artist.name, url: url.href, match });
  }
  const result = { source: 'Last.fm', tracks: tracks.sort((a,b) => b.match - a.match).slice(0,10), partial: false };
  // Bound cold-cache work; partial metadata must not hide the recommendation list.
  const deadline = Date.now() + 20000;
  let nextRequestAt = Date.now() + 550;
  let coolingDown = false;
  // Pace only uncached lookups. Reuse this request's cooldown state to keep D1
  // queries bounded for the ten-item batch; still acquire the shared quota.
  const pacedStore: DiscoveryStore = {
    ...store,
    get: key => key === 'cooldown:lastfm' ? Promise.resolve(coolingDown) : store.get(key),
    async put(key, value, seconds) {
      if (key === 'cooldown:lastfm') coolingDown = !!value;
      await store.put(key, value, seconds);
    },
    async acquire(provider, ms) {
      const delay = nextRequestAt - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      nextRequestAt = Date.now() + 550;
      return store.acquire(provider, ms);
    },
  };
  for (const item of result.tracks) {
    if (Date.now() >= deadline || coolingDown) { result.partial = true; break; }
    try {
      const info = await lastfmMetadata({id:'', title:item.title, artist:item.artist}, apiKey, pacedStore, fetcher,
        {exactTitle:true, timeoutMs:4000});
      if (info.status === 'found') {
        item.scrobbles = info.scrobbles; item.listeners = info.listeners;
        item.album = info.album; item.image = info.image; item.duration_s = info.duration_s;
      }
    } catch { result.partial = true; }
  }
  await store.put(key, result, result.partial ? 60 : result.tracks.length ? 86400 : 3600);
  return result;
}

/** Only navigate to an unambiguous, currently owned library recording. */
export function similarLibraryTrack(item: SimilarTrack, library: Track[]): string | undefined {
  const matches = library.filter(track => track.in_library !== 0
    && [track.artist, track.album_artist].some(artist => artist && nameKey(artist) === nameKey(item.artist))
    && nameKey(lyricTitle(track.title)) === nameKey(item.title));
  if (item.album) {
    const albumMatches = matches.filter(track => track.album && nameKey(track.album) === nameKey(item.album!));
    if (albumMatches.length === 1) return albumMatches[0].id;
    if (albumMatches.length > 1) return;
  }
  return matches.length === 1 ? matches[0].id : undefined;
}
