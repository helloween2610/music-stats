import { keyOf, normal, sourceJson, type DiscoveryStore } from './discovery';
import { lastfmSimilarAlbums } from './lastfmSimilarAlbums';

export type AlbumRecommendationSeed = {
  artist: string;
  title: string;
  albumId?: string | null;
  hours: number;
  plays: number;
};

export type AlbumRecommendation = {
  id: string;
  title: string;
  artist: string;
  date?: string;
  type: string;
  url: string;
  cover: string;
  score: number;
  matchedTags: string[];
  similarTo: AlbumRecommendationSeed;
  source: 'Last.fm' | 'MusicBrainz';
};

type Candidate = AlbumRecommendation & { rawScore: number };

const quote = (s: string) => '"' + s.replace(/[\\"]/g, '\\$&') + '"';
const mbid = (value: unknown) => typeof value === 'string' && /^[\da-f-]{36}$/i.test(value) ? value : '';
const cleanTag = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const friendlyGenre = (value: unknown) => cleanTag(value)
  .replace(/^melodeath metal$/, 'melodic death metal')
  .replace(/^symph\. metal$/, 'symphonic metal')
  .replace(/^symp\. metal$/, 'symphonic metal')
  .replace(/^viking \/ folk metal$/, 'viking metal')
  .replace(/^nhac viet$/, 'vietnamese');
const BROAD_TAGS = new Set(['metal','rock','death metal','heavy metal','hard rock','alternative rock','pop','pop rock','folk','folk metal']);
const tagWeight = (tag: string) => BROAD_TAGS.has(tag) ? 55 : tag.includes('melodic') || tag.includes('symphonic') || tag.includes('progressive') ? 140 : 105;
function focusedTags(tags: string[]) {
  const cleaned = [...new Set(tags.map(friendlyGenre).filter(tag => tag.length >= 3))];
  const specific = cleaned.filter(tag => !BROAD_TAGS.has(tag));
  return (specific.length ? specific : cleaned).slice(0, 3);
}

function albumKey(artist: string, title: string) {
  return normal(artist) + '\u001f' + normal(title);
}

function releaseType(group: any) {
  const secondary = Array.isArray(group?.['secondary-types']) ? group['secondary-types'] : [];
  return secondary.includes('Live') ? 'Live' : secondary.includes('Compilation') ? 'Compilation' : String(group?.['primary-type'] || 'Album');
}

function artistName(group: any) {
  const credit = Array.isArray(group?.['artist-credit']) ? group['artist-credit'] : [];
  return String(credit[0]?.artist?.name || group?.['artist-credit-phrase'] || '').trim();
}

function groupTags(group: any) {
  const tags = [...(Array.isArray(group?.genres) ? group.genres : []), ...(Array.isArray(group?.tags) ? group.tags : [])]
    .map((tag: any) => ({name: cleanTag(tag.name), count: Number(tag.count) || 0}))
    .filter(tag => tag.name && tag.name.length <= 60)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return [...new Map(tags.map(tag => [tag.name, tag])).values()].slice(0, 8);
}

async function releaseGroupDetail(id: string, store: DiscoveryStore, fetcher: typeof fetch) {
  return sourceJson(`https://musicbrainz.org/ws/2/release-group/${id}?` + new URLSearchParams({inc:'artist-credits+tags+genres',fmt:'json'}), 'mb-release-group', store, fetcher);
}

async function seedReleaseGroup(seed: AlbumRecommendationSeed, store: DiscoveryStore, fetcher: typeof fetch) {
  const key = 'album-rec:seed:' + await keyOf(JSON.stringify([seed.artist, seed.title]));
  const cached = await store.get(key);
  if (cached) return cached;
  const query = `artistname:${quote(seed.artist)} AND releasegroup:${quote(seed.title)} AND (primarytype:album OR primarytype:ep)`;
  const data = await sourceJson('https://musicbrainz.org/ws/2/release-group/?' + new URLSearchParams({query,fmt:'json',limit:'10'}), 'mb', store, fetcher);
  const rows = Array.isArray(data['release-groups']) ? data['release-groups'] : [];
  const exact = rows.find((group: any) => normal(group.title) === normal(seed.title)
    && (group['artist-credit'] || []).some((credit: any) => normal(credit.artist?.name) === normal(seed.artist)));
  const id = mbid(exact?.id);
  if (!id) {
    await store.put(key, {status:'not_found'}, 7 * 86400);
    return {status:'not_found'};
  }
  const detail = await releaseGroupDetail(id, store, fetcher);
  const result = {status:'found', id, tags: groupTags(detail).map(tag => tag.name)};
  await store.put(key, result, 30 * 86400);
  return result;
}

async function tagSearch(tag: string, store: DiscoveryStore, fetcher: typeof fetch) {
  const query = `tag:${quote(tag)} AND primarytype:album AND status:official`;
  return sourceJson('https://musicbrainz.org/ws/2/release-group/?' + new URLSearchParams({query,fmt:'json',limit:'50'}), 'mb', store, fetcher);
}

export async function musicBrainzAlbumRecommendations(
  seeds: AlbumRecommendationSeed[],
  ownedKeys: Set<string>,
  store: DiscoveryStore,
  fetcher: typeof fetch = fetch,
  fallbackGenres: string[] = [],
  refresh = false,
) {
  const cacheKey = 'album-rec:v5:' + await keyOf(JSON.stringify({seeds: seeds.map(s => [s.artist, s.title, s.hours]), fallbackGenres}));
  const cached = refresh ? null : await store.get(cacheKey);
  if (cached) return cached as {seeds: AlbumRecommendationSeed[]; rows: AlbumRecommendation[]; source: string};

  const seedTags = new Map<string, string[]>();
  for (const seed of seeds) {
    try {
      const found = await seedReleaseGroup(seed, store, fetcher);
      if (found?.status === 'found') seedTags.set(albumKey(seed.artist, seed.title), found.tags || []);
    } catch (error) {
      console.warn('album recommendation seed lookup failed', {seed: seed.title, error: error instanceof Error ? error.message : String(error)});
    }
  }

  const fallbackTags = focusedTags(fallbackGenres);
  const seedPlans = seeds.map(seed => ({
    seed,
    tags: focusedTags(seedTags.get(albumKey(seed.artist, seed.title)) || fallbackTags),
  })).filter(plan => plan.tags.length);
  if (!seedPlans.length) return {seeds, rows:[], source:'MusicBrainz'};

  const candidateBuckets = new Map<string, Map<string, Candidate>>();
  const globalCandidates = new Map<string, Candidate>();
  const seedKeys = new Set(seeds.map(seed => albumKey(seed.artist, seed.title)));
  for (const plan of seedPlans) {
    const planKey = albumKey(plan.seed.artist, plan.seed.title);
    const bucket = candidateBuckets.get(planKey) || new Map<string, Candidate>();
    candidateBuckets.set(planKey, bucket);
    for (const tag of plan.tags) {
      let data: any;
      try { data = await tagSearch(tag, store, fetcher); }
      catch (error) {
        console.warn('album recommendation tag search failed', {tag, error: error instanceof Error ? error.message : String(error)});
        continue;
      }
      for (const group of data['release-groups'] || []) {
        const id = mbid(group.id), title = String(group.title || '').trim(), artist = artistName(group);
        if (!id || !title || !artist || !['Album','EP'].includes(String(group['primary-type'] || ''))) continue;
        const key = albumKey(artist, title);
        if (seedKeys.has(key) || ownedKeys.has(key)) continue;
        const tags = focusedTags([tag, ...groupTags(group).map(t => t.name)]);
        const overlap = tags.filter(value => plan.tags.includes(value));
        if (!overlap.length) continue;
        const rawScore = tagWeight(tag) + overlap.length * 45 + Math.min(25, plan.seed.hours) + (Number(group.score) || 0) / 100 - (normal(artist) === normal(plan.seed.artist) ? 25 : 0);
        const existing = bucket.get(id);
        if (existing && existing.rawScore >= rawScore) continue;
        const candidate = {
          id, title, artist, date: group['first-release-date'] || undefined, type: releaseType(group),
          url: 'https://musicbrainz.org/release-group/' + id,
          cover: 'https://coverartarchive.org/release-group/' + id + '/front-250',
          score: Math.max(1, Math.min(99, Math.round(rawScore))),
          rawScore, matchedTags: overlap.slice(0, 2), similarTo: plan.seed, source:'MusicBrainz',
        } satisfies Candidate;
        bucket.set(id, candidate);
        const global = globalCandidates.get(id);
        if (!global || global.rawScore < rawScore) globalCandidates.set(id, candidate);
      }
    }
  }

  const chosen = new Map<string, Candidate>();
  for (const plan of seedPlans) {
    const planKey = albumKey(plan.seed.artist, plan.seed.title);
    const bucket = [...(candidateBuckets.get(planKey)?.values() || [])]
      .sort((a, b) => b.rawScore - a.rawScore || (b.date || '').localeCompare(a.date || '') || a.artist.localeCompare(b.artist));
    let added = 0;
    for (const candidate of bucket) {
      if (chosen.has(candidate.id)) continue;
      chosen.set(candidate.id, candidate);
      if (++added >= 3) break;
    }
  }
  for (const candidate of [...globalCandidates.values()].sort((a, b) => b.rawScore - a.rawScore)) {
    if (chosen.size >= 18) break;
    if (!chosen.has(candidate.id)) chosen.set(candidate.id, candidate);
  }
  const sorted = [...chosen.values()]
    .sort((a, b) => b.rawScore - a.rawScore || (b.date || '').localeCompare(a.date || '') || a.artist.localeCompare(b.artist));
  const top = sorted[0]?.rawScore || 0;
  const rows = sorted
    .filter(row => row.rawScore >= top - 45)
    .slice(0, 18)
    .map(({rawScore, ...row}) => row);
  const result = {seeds, rows, source:'MusicBrainz'};
  await store.put(cacheKey, result, 7 * 86400);
  return result;
}

export async function lastfmPerfectAlbumRecommendations(
  seeds: AlbumRecommendationSeed[],
  ownedKeys: Set<string>,
  apiKey: string,
  store: DiscoveryStore,
  fetcher: typeof fetch = fetch,
  refresh = false,
) {
  const rows: AlbumRecommendation[] = [];
  const seen = new Set(seeds.map(seed => albumKey(seed.artist, seed.title)));
  for (const seed of seeds) {
    try {
      const result = await lastfmSimilarAlbums(seed.artist, seed.title, apiKey, store, fetcher, refresh);
      for (const album of result.albums) {
        if (album.match < 1) continue;
        const key = albumKey(album.artist, album.title);
        if (seen.has(key) || ownedKeys.has(key)) continue;
        seen.add(key);
        rows.push({
          id: 'lastfm:' + await keyOf(JSON.stringify([album.artist, album.title, album.url])),
          title: album.title,
          artist: album.artist,
          type: 'Album',
          url: album.url,
          cover: album.image || '',
          score: 100,
          matchedTags: [],
          similarTo: seed,
          source: 'Last.fm',
        });
        break;
      }
    } catch (error) {
      console.warn('lastfm album recommendation failed', {seed: seed.title, error: error instanceof Error ? error.message : String(error)});
    }
  }
  return rows;
}
