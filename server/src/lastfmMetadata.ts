import { lyricTitle, SourceError, type DiscoveryStore, type Track } from './discovery';

export type LastfmMetadata = {
  status: 'found' | 'not_found';
  source: 'Last.fm';
  listeners?: number;
  scrobbles?: number;
  album?: string;
  image?: string;
  duration_s?: number;
  updatedAt: string;
};
const nameKey = (value: string) => value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
function count(value: unknown): number | undefined {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/** Global Last.fm counters, independent of the user's listening history. */
export async function lastfmMetadata(track: Track, apiKey: string, store: DiscoveryStore, fetcher: typeof fetch = fetch, options: { exactTitle?: boolean; timeoutMs?: number } = {}): Promise<LastfmMetadata> {
  const artist = track.artist?.trim() || track.album_artist?.trim();
  // Remove the library's personal version suffix; preserve live/remaster edition names.
  const title = options.exactTitle ? track.title.trim() : lyricTitle(track.title);
  const missing: LastfmMetadata = { status: 'not_found', source: 'Last.fm', updatedAt: new Date().toISOString() };
  if (!artist || !title) return missing;
  const key = 'lastfm:track:v2:' + JSON.stringify([nameKey(artist), nameKey(title)]);
  const saved = await store.get(key);
  if (saved) return saved;
  if (!apiKey) throw new SourceError('Chưa cấu hình kết nối Last.fm.');
  const cooldown = await store.get('cooldown:lastfm');
  if (cooldown) throw new SourceError('Last.fm đang bận. Hãy thử lại sau.', 30);
  if (!await store.acquire('lastfm', 500)) throw new SourceError('Last.fm đang bận. Hãy thử lại sau.', 30);
  const qs = new URLSearchParams({ method: 'track.getInfo', artist, track: title, api_key: apiKey, format: 'json', autocorrect: '0' });
  const response = await fetcher('https://ws.audioscrobbler.com/2.0/?' + qs, { signal: AbortSignal.timeout(options.timeoutMs ?? 10000) });
  if (response.status === 429) {
    await store.put('cooldown:lastfm', true, 60);
    throw new SourceError('Last.fm đang giới hạn truy cập. Hãy thử lại sau.', 60);
  }
  if (!response.ok) throw new SourceError('Chưa kết nối được Last.fm.');
  const body: any = await response.json();
  if (Number(body?.error) === 29) {
    await store.put('cooldown:lastfm', true, 60);
    throw new SourceError('Last.fm đang giới hạn truy cập. Hãy thử lại sau.', 60);
  }
  if (Number(body?.error) === 6) { await store.put(key, missing, 3600); return missing; }
  if (body?.error) throw new SourceError('Chưa tải được số liệu từ Last.fm.');
  const info = body?.track;
  if (!info || typeof info.name !== 'string' || typeof info.artist?.name !== 'string') throw new SourceError('Last.fm trả dữ liệu chưa hợp lệ.');
  if (nameKey(info.name) !== nameKey(title) || nameKey(info.artist.name) !== nameKey(artist)) {
    await store.put(key, missing, 3600); return missing;
  }
  const listeners = count(info.listeners), scrobbles = count(info.playcount);
  if (listeners === undefined || scrobbles === undefined) throw new SourceError('Last.fm chưa trả đủ số liệu cho bài này.');
  const result: LastfmMetadata = { status: 'found', source: 'Last.fm', listeners, scrobbles, updatedAt: new Date().toISOString() };
  if (typeof info.album?.title === 'string' && info.album.title.trim()) result.album = info.album.title.trim();
  const duration = count(info.duration);
  if (duration && duration > 0) result.duration_s = Math.floor(duration / 1000);
  const images = Array.isArray(info.album?.image) ? info.album.image : [];
  for (const size of ['extralarge', 'large', 'medium', 'small']) {
    const value = images.find((image: any) => image?.size === size)?.['#text'];
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && ['lastfm.freetls.fastly.net', 'userserve-ak.last.fm'].includes(url.hostname) && !url.username && !url.password && !url.port) {
        url.protocol = 'https:'; result.image = url.href; break;
      }
    } catch {}
  }
  await store.put(key, result, 86400);
  return result;
}
