import { SourceError, type DiscoveryStore } from './discovery';

export type SimilarAlbum = { title: string; artist: string; url: string; match: number; image?: string };
const nameKey = (value: string) => value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

export async function lastfmSimilarAlbums(artist: string, album: string, apiKey: string, store: DiscoveryStore, fetcher: typeof fetch = fetch, refresh = false) {
  const empty = { source: 'Last.fm', albums: [] as SimilarAlbum[] };
  artist = artist.trim(); album = album.trim();
  if (!artist || !album) return empty;
  const key = 'lastfm:similar-albums:v1:' + JSON.stringify([nameKey(artist), nameKey(album)]);
  const saved = refresh ? null : await store.get(key);
  if (saved) return saved;
  if (!apiKey) throw new SourceError('Chưa cấu hình kết nối Last.fm.');
  if (await store.get('cooldown:lastfm')) throw new SourceError('Last.fm đang giới hạn truy cập. Hãy thử lại sau.', 60);
  if (!await store.acquire('lastfm', 500)) throw new SourceError('Last.fm đang bận. Hãy thử lại sau.', 30);
  const qs = new URLSearchParams({ method: 'artist.getTopAlbums', artist, api_key: apiKey, format: 'json', autocorrect: '0', limit: '24' });
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
  if (body?.error) throw new SourceError('Chưa tải được album tương tự từ Last.fm.');
  const rows = body?.topalbums?.album;
  if (!Array.isArray(rows)) throw new SourceError('Last.fm trả dữ liệu chưa hợp lệ.');
  const seen = new Set([JSON.stringify([nameKey(artist), nameKey(album)])]);
  const albums: SimilarAlbum[] = [];
  for (const row of rows) {
    if (typeof row?.name !== 'string' || !row.name.trim() || typeof row.artist?.name !== 'string' || !row.artist.name.trim()) continue;
    const identity = JSON.stringify([nameKey(row.artist.name), nameKey(row.name)]);
    if (seen.has(identity)) continue;
    let url: URL;
    try { url = new URL(row.url); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || !['last.fm', 'www.last.fm'].includes(url.hostname) || url.username || url.password || url.port) continue;
    url.protocol = 'https:';
    if (nameKey(row.name) === nameKey(album)) continue;
    const match = Math.max(0.05, 1 - albums.length * 0.06);
    const result: SimilarAlbum = { title: row.name, artist: row.artist.name, url: url.href, match };
    const images = Array.isArray(row.image) ? row.image : [];
    for (const size of ['extralarge', 'large', 'medium', 'small']) {
      const value = images.find((image: any) => image?.size === size)?.['#text'];
      try {
        const image = new URL(value);
        if (['http:', 'https:'].includes(image.protocol) && ['lastfm.freetls.fastly.net', 'lastfm-img.freetls.fastly.net', 'userserve-ak.last.fm'].includes(image.hostname) && !image.username && !image.password && !image.port) {
          image.protocol = 'https:'; result.image = image.href; break;
        }
      } catch {}
    }
    seen.add(identity); albums.push(result);
  }
  const result = { source: 'Last.fm', albums: albums.sort((a, b) => b.match - a.match).slice(0, 12) };
  await store.put(key, result, result.albums.length ? 86400 : 3600);
  return result;
}
