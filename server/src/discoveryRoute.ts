import { mergeReleases } from '../../shared/releases';
import { albumTracks } from './albumTracks';
import { memo } from './cache';
import { resolveAppleAlbum, resolveAppleDetail, resolveApplePlaylistSong, resolveApplePlaylistSongLine, validAlbumId } from './appleMusic';
import { lastfmMetadata } from './lastfmMetadata';
import { lastfmSimilar, similarLibraryTrack, type SimilarTrack } from './lastfmSimilar';
import { lastfmSimilarAlbums } from './lastfmSimilarAlbums';
import { lastfmNowPlaying } from './lastfmNowPlaying';
import { lastfmPerfectAlbumRecommendations, musicBrainzAlbumRecommendations, type AlbumRecommendationSeed } from './albumRecommendations';
import { vnToday } from './charts';
import type { Env } from './index';
import { lyrics, libraryArtists, releaseTracks, SourceError, type DiscoveryStore, type Track } from './discovery';
import { getReleaseScanSettings, type ReleaseScanSettings } from './releaseSettings';
export function discoveryStore(db: D1Database): DiscoveryStore {
  return {
    async catalogLookup(keys) {
      for(const key of keys){
        const row=await db.prepare('SELECT catalog_id FROM apple_catalog_links WHERE match_key=?1').bind(key).first<{catalog_id:string|null}>();
        if(row)return row.catalog_id;
      }
      return null;
    },
    async list(prefix) {
      const result=await db.prepare('SELECT body FROM discovery_cache WHERE substr(key,1,?1)=?2 AND expires>?3').bind(prefix.length,prefix,Date.now()).all<{body:string}>();
      return result.results.map(row=>JSON.parse(row.body));
    },
    async get(key) { const row = await db.prepare('SELECT body FROM discovery_cache WHERE key = ?1 AND expires > ?2').bind(key,Date.now()).first<{body:string}>(); return row ? JSON.parse(row.body) : null; },
    async put(key,value,seconds) {
      const body = JSON.stringify(value); if (body.length > 1_000_000) return;
      await db.batch([
        db.prepare('DELETE FROM discovery_cache WHERE expires < ?1').bind(Date.now()),
        db.prepare('INSERT OR REPLACE INTO discovery_cache (key,body,expires) VALUES (?1,?2,?3)').bind(key,body,Date.now()+seconds*1000),
      ]);
    },
    async acquire(provider,ms) {
      const now = Date.now();
      const row = await db.prepare(`INSERT INTO discovery_cache (key,body,expires) VALUES (?1,'null',?2)
        ON CONFLICT(key) DO UPDATE SET expires=excluded.expires WHERE discovery_cache.expires <= ?3 RETURNING key`).bind('rate:'+provider,now+ms,now).first();
      return !!row;
    },
  };
}
export async function discoveryRoute(url: URL, tracks: () => Promise<Track[]>, store: DiscoveryStore, lastfmApiKey = '', lastfmUser = '', releaseSettings:ReleaseScanSettings={watchlist:[],excluded:[],recentDays:90}): Promise<Response> {
  const json = (value: unknown, status = 200, headers = {}) => Response.json(value,{status,headers});
  try {
    if(url.pathname==='/discovery/now-playing'){
      const result=await lastfmNowPlaying(lastfmUser,lastfmApiKey,store);
      if(!result.track)return json(result);
      const library=await tracks(),libraryTrackId=similarLibraryTrack({...result.track,match:1,url:result.track.url || 'https://www.last.fm/'},library);
      const local=libraryTrackId?library.find(track=>track.id===libraryTrackId):undefined;
      return json({...result,track:{...result.track,...(local?{
        libraryTrackId:local.id,album:result.track.album || local.album || undefined,duration_s:local.duration_s || undefined,
        year:local.year || undefined,date_added:local.date_added || undefined,last_played:local.last_played || undefined,
        my_rating:local.my_rating || undefined,plays:local.plays,
      }:{})}});
    }
    if (url.pathname === '/discovery/lastfm') {
      const artist = url.searchParams.get('artist')?.trim(), title = url.searchParams.get('title')?.trim();
      if (!artist || !title || artist.length > 300 || title.length > 300) return json({error:'Tên bài hát hoặc nghệ sĩ chưa hợp lệ.'},400);
      // XML playlist-only songs have no local track ID. Preserve their exact edition/title.
      return json(await lastfmMetadata({id:'',artist,title}, lastfmApiKey, store, fetch, {exactTitle:true}));
    }
    if (url.pathname === '/discovery/similar-albums') {
      const artist = url.searchParams.get('artist')?.trim(), album = url.searchParams.get('album')?.trim();
      if (!artist || !album || artist.length > 300 || album.length > 300) return json({error:'Thông tin album chưa hợp lệ.'},400);
      return json(await lastfmSimilarAlbums(artist, album, lastfmApiKey, store));
    }
    const similarId = url.pathname.match(/^\/discovery\/similar\/(TR\d+)$/)?.[1];
    if (similarId) {
      const library = await tracks();
      const track = library.find(t => t.id === similarId);
      if (!track) return json({error:'Bài hát không còn khả dụng.'},404);
      const result = await lastfmSimilar(track, lastfmApiKey, store);
      // Re-evaluate ownership outside the Last.fm cache after library changes.
      return json({...result, tracks:result.tracks.map((item: SimilarTrack) => ({...item, libraryTrackId:similarLibraryTrack(item, library)}))});
    }
    const statsId = url.pathname.match(/^\/discovery\/lastfm\/(TR\d+)$/)?.[1];
    if (statsId) {
      const track = (await tracks()).find(t => t.id === statsId);
      return track ? json(await lastfmMetadata(track, lastfmApiKey, store)) : json({error:'Bài hát không còn khả dụng.'},404);
    }
    if (url.pathname === '/discovery/album-tracks') {
      const artist=url.searchParams.get('artist')?.trim(), title=url.searchParams.get('title')?.trim(), group=url.searchParams.get('id') || undefined;
      if(!artist || !title || artist.length>300 || title.length>300 || (group && !validAlbumId(group))) return json({error:'Thông tin album chưa hợp lệ.'},400);
      return json(await albumTracks(artist,title,group,store));
    }
    if (url.pathname === '/discovery/apple-music') {
      const artist = url.searchParams.get('artist')?.trim(), title = url.searchParams.get('title')?.trim();
      const kind = url.searchParams.get('kind') || 'album', album = url.searchParams.get('album')?.trim();
      if (kind === 'song' || kind === 'artist') {
        const trackId=url.searchParams.get('trackId');
        const local=kind==='song' && /^TR\d+$/.test(trackId || '') ? (await tracks()).find(track=>track.id===trackId) : undefined;
        const songArtist=local?.artist?.trim() || artist;
        const songTitle=local?.title?.trim() || title;
        const songAlbum=local?.album?.trim() || album;
        if (!songArtist || songArtist.length > 300 || (kind === 'song' && !songTitle) || (songTitle?.length || 0) > 300 || (songAlbum?.length || 0) > 300) return json({error:'Tên bài hát hoặc nghệ sĩ chưa hợp lệ.'},400);
        return json(await resolveAppleDetail({kind,artist:songArtist,title:kind === 'song' ? songTitle : undefined,album:kind === 'song' ? songAlbum : undefined,libraryTitle:url.searchParams.get('library')==='1' || !!local},store));
      }
      if (kind !== 'album') return json({error:'Loại liên kết chưa hợp lệ.'},400);
      const group = url.searchParams.get('id') || undefined;
      if (!artist || !title || artist.length > 300 || title.length > 300) return json({error:'Tên album hoặc nghệ sĩ chưa hợp lệ.'},400);
      if (group && !validAlbumId(group)) return json({error:'Mã album chưa hợp lệ.'},400);
      return json(await resolveAppleAlbum(artist,title,store,fetch,group));
    }
    if(url.pathname==='/discovery/apple-playlist-song'){
      const artist=url.searchParams.get('artist')?.trim(),title=url.searchParams.get('title')?.trim(),raw=url.searchParams.get('raw')?.trim();
      if(raw && raw.length>600)return json({error:'Dòng bài hát quá dài.'},400);
      if(!raw && (!artist || !title || artist.length>300 || title.length>300))return json({error:'Tên bài hát hoặc nghệ sĩ chưa hợp lệ.'},400);
      const found=raw ? await resolveApplePlaylistSongLine(raw,store) : await resolveApplePlaylistSong(artist!,title!,store);
      return found ? json(found) : json({error:'Chưa tìm thấy đúng bài này trên Apple Music.'},404);
    }
    if (url.pathname === '/discovery/release-artists') {
      const library=await tracks();
      const base=libraryArtists(releaseTracks(library,releaseSettings.excluded,[])).map(a=>a.name);
      const artists=libraryArtists(releaseTracks(library,releaseSettings.excluded,releaseSettings.watchlist)).map(a=>a.name);
      return json({artists,baseCount:base.length,total:artists.length,watchlist:releaseSettings.watchlist,excluded:releaseSettings.excluded,recentDays:releaseSettings.recentDays,updatedAt:releaseSettings.updatedAt});
    }
    if (url.pathname === '/discovery/upcoming') {
      let excluded:unknown=[];
      try { excluded=JSON.parse(url.searchParams.get('exclude') || '[]'); } catch { return json({error:'Danh sách loại trừ chưa hợp lệ.'},400); }
      if(!Array.isArray(excluded) || excluded.length>1000 || !excluded.every(n=>typeof n==='string' && n.length<=300))return json({error:'Danh sách loại trừ chưa hợp lệ.'},400);
      const eligible=releaseTracks(await tracks(),[...releaseSettings.excluded,...excluded],releaseSettings.watchlist);
      const releaseRow=(row:any)=>row && typeof row.id==='string' && !row.id.startsWith('itunes:')
        && (!Array.isArray(row.sources) || row.sources.some((source:unknown)=>source==='MusicBrainz' || source==='Bandcamp'));
      const artists=libraryArtists(eligible),allowed=new Set(artists.map(a=>a.name));
      const saved=store.list ? await store.list('release-snapshot:v1:') : [];
      let rows=mergeReleases(saved.flatMap(value=>Array.isArray(value.rows)?value.rows.filter(releaseRow):[])).filter(r=>allowed.has(r.artist));
      const artist=url.searchParams.get('artist');
      if(artist!==null){
        if(!artist.trim() || artist.length>300)return json({error:'Tên nghệ sĩ chưa hợp lệ.'},400);
        const folded=artist.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
        rows=rows.filter(row=>row.artist.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().includes(folded));
      }
      // Client requests are read-only. MusicBrainz/Bandcamp scans run from the
      // daily server schedule and update these saved pages in the background.
      const scan=await store.get('release-scan-state:v1');
      const total=Number(scan?.total)||artists.length;
      return json({rows,checked:Number(scan?.checked)||total,total,next:null,asOf:vnToday(),failed:[],unverified:0,recentDays:releaseSettings.recentDays,
        scan:scan?{cycleStartedAt:scan.cycleStartedAt,updatedAt:scan.updatedAt,completedAt:scan.completedAt,cursor:scan.cursor}:null});
    }
    const id = url.pathname.match(/^\/discovery\/lyrics\/(TR\d+)$/)?.[1];
    if (id) { const track = (await tracks()).find(t=>t.id===id); return track ? json(await lyrics(track,store)) : json({error:'Bài hát không còn khả dụng.'},404); }
    return json({error:'Không tìm thấy trang.'},404);
  } catch (e) {
    return json({error: e instanceof SourceError ? e.message : 'Chưa tải được dữ liệu từ nguồn. Hãy thử lại sau.'},503,{'Retry-After':String(e instanceof SourceError ? e.retryAfter : 30)});
  }
}
export async function workerDiscovery(env: Env, url: URL) {
  if (url.pathname === '/discovery/album-recommendations') {
    try {
      const refresh = url.searchParams.get('refresh') === '1';
      const today = vnToday();
      const from = new Date(Date.parse(today + 'T00:00:00Z') - 29 * 86400000).toISOString().slice(0, 10);
      const seeds = (await env.DB.prepare(`WITH x AS (
        SELECT t.album_id, MIN(t.album) AS title, MIN(COALESCE(t.album_artist,t.artist)) AS artist,
               COUNT(*) AS plays, SUM(COALESCE(t.duration_s,0)) / 3600.0 AS hours
        FROM plays p JOIN tracks t ON t.id=p.track_id
        WHERE p.play_date BETWEEN ?1 AND ?2 AND t.album_id IS NOT NULL
              AND t.album IS NOT NULL AND t.album NOT IN ('','0')
              AND COALESCE(t.album_artist,t.artist) IS NOT NULL AND COALESCE(t.album_artist,t.artist) NOT IN ('','0')
        GROUP BY t.album_id
      )
      SELECT album_id AS albumId,title,artist,plays,ROUND(hours,2) AS hours FROM x
      WHERE hours > 1 ORDER BY hours DESC, plays DESC, artist, title LIMIT 5`).bind(from, today).all<AlbumRecommendationSeed>()).results;
      const [owned, genres] = await Promise.all([
        env.DB.prepare(`SELECT DISTINCT COALESCE(album_artist,artist) AS artist, album AS title
        FROM tracks WHERE album IS NOT NULL AND album NOT IN ('','0')
              AND COALESCE(album_artist,artist) IS NOT NULL AND COALESCE(album_artist,artist) NOT IN ('','0')`).all<{artist:string;title:string}>(),
        env.DB.prepare(`SELECT genre, COUNT(*) AS n FROM plays p JOIN tracks t ON t.id=p.track_id
        WHERE p.play_date BETWEEN ?1 AND ?2 AND genre IS NOT NULL AND genre NOT IN ('','0')
        GROUP BY genre ORDER BY COUNT(*) DESC LIMIT 8`).bind(from, today).all<{genre:string}>(),
      ]);
      const key = (s: string) => s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
      const ownedKeys = new Set(owned.results.map(row => key(row.artist) + '\u001f' + key(row.title)));
      const store = discoveryStore(env.DB);
      const musicBrainz = await musicBrainzAlbumRecommendations(seeds, ownedKeys, store, fetch, genres.results.map(row => row.genre), refresh);
      const lastfmRows = await lastfmPerfectAlbumRecommendations(seeds, ownedKeys, env.LASTFM_API_KEY, store, fetch, refresh);
      return Response.json({...musicBrainz, rows:[...lastfmRows, ...musicBrainz.rows].slice(0, 24), source:'Last.fm + MusicBrainz'});
    } catch (e) {
      return Response.json(
        {error: e instanceof SourceError ? e.message : 'Chưa tải được album gợi ý. Hãy thử lại sau.'},
        {status:503,headers:{'Retry-After':String(e instanceof SourceError ? e.retryAfter : 30)}},
      );
    }
  }
  const statsId = url.pathname.match(/^\/discovery\/lastfm\/(TR\d+)$/)?.[1];
  if (statsId) return discoveryRoute(url, async () => {
    const track = await env.DB.prepare('SELECT id,title,artist,album_artist FROM tracks WHERE id = ?1').bind(statsId).first<Track>();
    return track ? [track] : [];
  }, discoveryStore(env.DB), env.LASTFM_API_KEY,env.LASTFM_USER);
  const settings=await getReleaseScanSettings(env.DB);
  return discoveryRoute(url,()=> memo(env,'discovery-tracks:v2:'+vnToday(), async()=> (await env.DB.prepare(`WITH counts AS (SELECT track_id,COUNT(*) AS n FROM plays WHERE play_date >= ?1 AND play_date <= ?2 GROUP BY track_id)
      SELECT t.id,title,artist,album_artist,album,genre,duration_s,year,date_added,last_played,my_rating,in_library,COALESCE(plays_to_12_2024,0)+COALESCE(c.n,0) AS plays
      FROM tracks t LEFT JOIN counts c ON c.track_id=t.id`).bind(env.LASTFM_FROM,vnToday()).all<Track>()).results),discoveryStore(env.DB),env.LASTFM_API_KEY,env.LASTFM_USER,settings);
}
