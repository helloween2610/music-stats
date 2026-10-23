import { workerDiscovery } from "./discoveryRoute";
import { consumeLibrarySyncMessage } from "./libraryCloud";
import { playlistSnapshot } from "./playlistSnapshot";
import { beginReleaseCalendarScan, scanReleaseCalendar } from "./releaseSchedule";
import { periodRankHistory } from "./periodHistory";
import { syncLastfm } from "./lastfm";
import { matchPlays } from "./match";
import { songChart, vnToday, WINDOWS, type Window } from "./charts";
import { summary } from "./summary";
import { periodSongRank } from "./periodRank";
import { dailyThisWeek, hourlyToday, recentPlays } from "./today";
import { allTimeChart } from "./alltime";
import { artistChart, type ArtistWindow } from "./artistRank";
import { ensureSnapshots, scopedSongHistory, songHistory } from "./history";
import { overview, releaseYears } from "./overview";
import { newAdditions } from "./newAdditions";
import { ratings } from "./rating";
import { boardList, computeBoard, ensureBoard, type BoardKind } from "./board";
import { albumChart, albumHistory } from "./albumRank";
import { artistDetail, artistHistory, artistPointsMemo, artistsAllTime, artistsThisWeek } from "./artists";
import { addTitleRules, deleteTitleRule, librarySummary, listTitleRules, matchManually, searchLibrary, setRules, songDetail, unmatched } from "./library";
import { resetUnmatched } from "./match";
import { bumpThrottled, bumpVersion, cached, currentDataGeneration, meter } from "./cache";
import { songsAt } from "./memos";
import { artworkMap, fillArtwork } from "./artwork";
import { recordUsage, routeUsageKey, usage, type UsageCacheState } from "./usage";
import { isSyncHour } from "./schedule";
import { importLibrary, libraryMetadata, librarySyncRequest, libraryTracks, requestLibrarySync } from "./libraryImport";
import { importNativeLibrarySnapshot } from "./nativeLibrarySync";
import { getNotificationSettings, listNotifications, markNotificationsRead, runListeningNotifications, runReleaseNotifications, saveNotificationSettings } from "./notifications";
import { getReleaseScanSettings, saveReleaseScanSettings } from "./releaseSettings";
import { getPlaylistRankingSettings, savePlaylistRankingSettings } from "./playlistRankingSettings";
import { getSongRankingWeight, isSongRankingWeight, saveSongRankingWeight } from "./songRankingSettings";

/** Calendar week (Mon–Sun) or month containing `asOf`; the period runs to its end. */
function calendarPeriod(kind: "week" | "month", asOf: string) {
  const d = new Date(asOf + "T00:00:00Z");
  if (kind === "month") {
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { from: asOf.slice(0, 8) + "01", to: end.toISOString().slice(0, 10) };
  }
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

/** The calendar week or month before the one starting on `from`. */
function previousPeriod(kind: "week" | "month", from: string) {
  const dayBefore = new Date(Date.parse(from + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  return calendarPeriod(kind, dayBefore);
}

/** Add previous rank and change (previous − rank; null previous = new entry, "MỚI" in the app). */
function withChange<T extends { rank: number }>(rows: T[], before: T[], key: (r: T) => string) {
  const prev = new Map<string, number>();
  for (const r of before) if (!prev.has(key(r))) prev.set(key(r), r.rank);
  return rows.map((r) => {
    const p = prev.get(key(r)) ?? null;
    return { ...r, previous: p, change: p === null ? null : p - r.rank };
  });
}

export interface Env {
  DB: D1Database;
  LIBRARY_QUEUE: Queue<WorkerQueueMessage>;
  LIBRARY_SHARE_ID: string;
  SYNC_DATA_URL?: string;
  SYNC_FILES_JSON?: string;
  LASTFM_USER: string;
  LASTFM_FROM: string;
  LASTFM_API_KEY: string;
  APP_TOKEN: string;
  READ_TOKEN?: string;
  USER_TOKEN?: string;
}

export type WorkerQueueMessage={kind?:"library-sync";jobId:string}|{kind:"release-scan"};

// The Zalo mini app (a web page inside Zalo) calls this API from another origin.
// Every route except /health needs the bearer token, so any origin may call it.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-expose-headers": "Retry-After, x-cache, x-rows-read, x-data-generation",
  "access-control-max-age": "86400",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });

/**
 * Three tokens:
 *   APP_TOKEN   everything (scripts, the Mac library sync)
 *   USER_TOKEN  the user's own mini app build: reads, the two sync buttons, manual match, rule switches
 *   READ_TOKEN  design tools / previews that keep the token in a shared file: reads and the two sync buttons
 * The sync buttons only fetch new data; match and rules are the only user edits, and both can be redone.
 */
const SYNC_POSTS = new Set(["/sync", "/library/sync-request"]);
const USER_POSTS = new Set([...SYNC_POSTS, "/library/native-sync", "/library/match", "/library/title-rules", "/settings/rules", "/settings/release-scan", "/settings/playlist-ranking", "/settings/song-ranking", "/notifications/read", "/notifications/settings"]);
const USER_DELETES = new Set(["/library/title-rules"]);

function authorized(req: Request, env: Env) {
  const header = req.headers.get("authorization") ?? "";
  if (env.APP_TOKEN && header === `Bearer ${env.APP_TOKEN}`) return true;
  const path = new URL(req.url).pathname;
  const allowed = (posts: Set<string>, deletes = new Set<string>()) =>
    req.method === "GET" || (req.method === "POST" && posts.has(path)) || (req.method === "DELETE" && deletes.has(path));
  if (env.USER_TOKEN && header === `Bearer ${env.USER_TOKEN}`) return allowed(USER_POSTS, USER_DELETES);
  if (env.READ_TOKEN && header === `Bearer ${env.READ_TOKEN}`) return allowed(SYNC_POSTS);
  return false;
}

export default {
  async queue(batch: MessageBatch<WorkerQueueMessage>, env: Env) {
    const m = meter(env.DB);
    try {
      const menv={...env,DB:m.db};
      for(const message of batch.messages){
        if('jobId' in message.body){
          await consumeLibrarySyncMessage(message as Message<{jobId:string}>,menv);
          continue;
        }
        try {
          const state=await scanReleaseCalendar(menv,9);
          if(state.cursor===null && !state.failed.length)await runReleaseNotifications(menv,vnToday()).catch(error=>console.warn('release notifications failed',error));
          if(state.cursor!==null || state.failed.length){
            const retrying=state.cursor===null;
            await env.LIBRARY_QUEUE.send({kind:'release-scan'},{delaySeconds:retrying?60:2});
          }
          message.ack();
        } catch(error){
          console.warn('release scan chunk failed',{attempt:message.attempts,error:error instanceof Error?error.message:String(error)});
          message.retry({delaySeconds:60});
        }
      }
    }
    finally { await recordUsage(env.DB, m.rowsRead(), m.rowsWritten(), "library"); }
  },
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/health") return json({ ok: true });
    if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);

    const m = meter(env.DB);
    const menv: Env = { ...env, DB: m.db };
    let res: Response;
    const bypassCache = req.method !== "GET" || NO_CACHE.has(url.pathname) || url.pathname.startsWith("/discovery/") || url.searchParams.has("nocache");
    try {
      res = bypassCache
        ? await route(req, menv, url)
        : await cached(menv, cacheKey(url), isSlow(url), () => route(req, menv, url));
    } catch (e) {
      // Return the reason with CORS headers (an uncaught error reaches the browser as a CORS failure).
      const message = e instanceof Error ? e.message : String(e);
      const limit = /daily row (read|write) limit/i.test(message);
      res = json({ error: limit ? "d1_daily_limit" : "server_error", message }, limit ? 503 : 500);
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    headers.set("x-data-generation", String(await currentDataGeneration(menv)));
    headers.set("x-rows-read", String(m.rowsRead()));
    const cacheState: UsageCacheState = res.status >= 400 ? "error"
      : ["hit", "coalesced"].includes(res.headers.get("x-cache") || "") ? "hit"
      : res.headers.get("x-cache") === "miss" ? "miss"
      : "bypass";
    if (!headers.has("x-cache")) headers.set("x-cache", cacheState);
    ctx.waitUntil(recordUsage(env.DB, m.rowsRead(), m.rowsWritten(), "request", {
      routeKey: routeUsageKey(url, req.method), cacheState, status: res.status,
    }));
    return new Response(res.body, { status: res.status, headers });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const releaseScan=event.cron==='30 0 * * *'; // 07:30 in Vietnam (Cloudflare cron uses UTC)
    if (!releaseScan && !isSyncHour(new Date(event.scheduledTime))) return;
    const m = meter(env.DB);
    const raw = env.DB;
    env = { ...env, DB: m.db };
    ctx.waitUntil((async () => {
      try { await cron(); } finally { await recordUsage(raw, m.rowsRead(), m.rowsWritten(), "cron"); }
    })());
    async function cron() {
      if(releaseScan){
        await beginReleaseCalendarScan(env);
        await env.LIBRARY_QUEUE.send({kind:'release-scan'});
        return;
      }
      const sync = await syncLastfm(env);
      const match = await matchPlays(env);
      await runListeningNotifications(env,vnToday()).catch(error=>console.warn('listening notifications failed',error));
      // New month / week / year periods can only appear once a day: check them on the first run of
      // each VN day (and keep checking until a run finds nothing missing).
      const today = vnToday();
      const checked = await env.DB.prepare("SELECT value FROM sync_state WHERE key = 'periods_checked'").first<{ value: string }>();
      let snaps: string[] = [], board: string[] = [];
      if (checked?.value !== today) {
        snaps = await ensureSnapshots(env, today);
        board = await ensureBoard(env, today);
        if (!snaps.length && !board.length) {
          await env.DB.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('periods_checked', ?1, datetime('now'))")
            .bind(today).run();
        }
      }
      // a few pictures per run (Last.fm / Deezer); the free plan allows ~50 subrequests per run
      // pictures don't change any number, so they don't make cached numbers stale (/artwork isn't cached)
      await fillArtwork(env, 15).catch(() => undefined);
      const changed = sync.inserted || sync.deleted || match.matched || snaps.length || board.length;
      await bumpThrottled(env, changed ? `+${sync.inserted} −${sync.deleted} plays, ${match.matched} matched, ${snaps.length + board.length} periods` : null);
    }
  },
} satisfies ExportedHandler<Env, WorkerQueueMessage>;

// Cheap, per-user-action or debug routes are never cached.
const NO_CACHE = new Set(["/library/generation", "/library/metadata", "/library/sync-request", "/artwork", "/usage", "/library/title-rules", "/status", "/recent", "/library", "/library/playlists", "/library/unmatched", "/library/search", "/settings/rules", "/settings/release-scan", "/settings/playlist-ranking", "/settings/song-ranking", "/board/compute", "/notifications", "/notifications/settings"]);

/** All-time / history / detail numbers (see cache.ts); today and period charts are fast. */
function isSlow(url: URL) {
  const p = url.pathname, w = url.searchParams.get("window");
  if (["/summary", "/daily", "/artists/week", "/new-additions", "/library/tracks"].includes(p)) return false;
  if ((p === "/charts/songs" || p === "/charts/artists") && w !== "at" && w !== "ft0424") return false;
  return true;
}

/** Path + sorted query + today's date (responses without asOf depend on the day). */
function cacheKey(url: URL) {
  const q = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  const schema = url.pathname === "/summary" ? "|progress-comparison-v1"
    : url.pathname === "/daily" ? "|weekday-average-v1"
    : url.pathname === "/new-additions" ? "|library-only-v3"
    : url.pathname === "/history/songs" ? "|last-played-v1"
    : url.pathname.startsWith("/song/") ? "|rank-replay-v1"
    : "";
  return `${url.pathname}?${q}|${vnToday()}${schema}`;
}

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const num = (name: string, def: number, max: number) => Math.min(Number(url.searchParams.get(name) ?? def) || def, max);
  if (url.pathname.startsWith("/discovery/") && req.method === "GET") return workerDiscovery(env, url);

  if (url.pathname === "/status") {
    const plays = await env.DB.prepare(
      "SELECT source, COUNT(*) AS n, MIN(play_date) AS first, MAX(play_date) AS last FROM plays GROUP BY source",
    ).all();
    const sync = await env.DB.prepare("SELECT key, value, updated_at FROM sync_state").all();
    return json({ plays: plays.results, sync: sync.results, usage: await usage(env) });
  }

  if (url.pathname === "/sync" && req.method === "POST") {
    // Sync button: at most once a minute, so repeated taps don't spend the D1 quota.
    const last = await env.DB.prepare("SELECT updated_at FROM sync_state WHERE key = 'lastfm'").first<{ updated_at: string }>();
    const ago = last ? (Date.now() - Date.parse(last.updated_at.replace(" ", "T") + "Z")) / 1000 : Infinity;
    if (ago < 60) return json({ skipped: true, reason: "vừa đồng bộ", updated_at: last!.updated_at });
    const sync = await syncLastfm(env);
    const match = await matchPlays(env);
    await runListeningNotifications(env,vnToday()).catch(error=>console.warn('listening notifications failed',error));
    if (sync.inserted || sync.deleted || match.matched) await bumpVersion(env, `sync: +${sync.inserted} −${sync.deleted} plays, ${match.matched} matched`);
    return json({ sync, match });
  }

  if(url.pathname==='/notifications')return json(await listNotifications(env,num('limit',50,100),url.searchParams.get('before')));
  if(url.pathname==='/notifications/read'&&req.method==='POST'){
    await markNotificationsRead(env,await req.json().catch(()=>({})));
    return json({ok:true});
  }
  if(url.pathname==='/notifications/settings'){
    if(req.method==='POST')return json({settings:await saveNotificationSettings(env,await req.json().catch(()=>({})))});
    return json({settings:await getNotificationSettings(env)});
  }

  if (url.pathname === "/summary") {
    return json(await summary(env, url.searchParams.get("asOf") ?? vnToday()));
  }

  if (url.pathname === "/recent") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 200);
    return json({ rows: await recentPlays(env, limit) });
  }

  if (url.pathname === "/history/period") {
    const scope = url.searchParams.get("scope") ?? "";
    const kind = url.searchParams.get("kind") ?? "songs";
    const asOf = url.searchParams.get("asOf") ?? vnToday();
    if (!/^(ft0424|week|\d{4}(-(?:0[1-9]|1[0-2]))?)$/.test(scope) || !["songs", "artists", "monthSongs"].includes(kind)
      || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf))) return json({ error: "invalid period" }, 400);
    return json(await periodRankHistory(env, scope, asOf, kind, url.searchParams.get("sort") ?? "hours", Number(url.searchParams.get("limit")) || 5000));
  }

  if (url.pathname === "/daily") {
    const asOf = url.searchParams.get("asOf") ?? vnToday();
    const [days, byHour] = await Promise.all([dailyThisWeek(env, asOf), hourlyToday(env, asOf)]);
    return json({ asOf, days, byHour });
  }

  if (url.pathname === "/charts/songs") {
    const window = url.searchParams.get("window") ?? "1m";
    const asOf = url.searchParams.get("asOf") ?? vnToday();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 5000);
    if (window === "at" || window === "ft0424") {
      const rows = window === "at" ? (await songsAt(env, asOf)).slice(0, limit) : await allTimeChart(env, window, asOf, limit);
      return json({ window, asOf, rows });
    }
    if (window === "week" || window === "month") {
      const { from, to } = calendarPeriod(window, asOf);
      const prev = previousPeriod(window, from);
      const [rows, before] = await Promise.all([
        periodSongRank(env, window, from, to, limit),
        periodSongRank(env, window, prev.from, prev.to, 5000),
      ]);
      return json({ window, from, to, previousPeriod: prev, rows: withChange(rows, before, (r) => r.track_id) });
    }
    if (!(window in WINDOWS)) return json({ error: `window must be week, month, at, ft0424 or one of ${Object.keys(WINDOWS)}` }, 400);
    return json({ window, asOf, rows: await songChart(env, window as Window, asOf, limit) });
  }

  if (url.pathname === "/charts/artists") {
    const window = (url.searchParams.get("window") ?? "1m") as ArtistWindow;
    const valid: ArtistWindow[] = ["at", "ft0424", "7d", "1m", "100d", "week", "month"];
    if (!valid.includes(window)) return json({ error: `window must be one of ${valid}` }, 400);
    const asOf = url.searchParams.get("asOf") ?? vnToday();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 5000);
    const period = window === "week" || window === "month" ? calendarPeriod(window, asOf) : null;
    if (period) {
      const prev = previousPeriod(window as "week" | "month", period.from);
      const [rows, before] = await Promise.all([
        artistChart(env, window, asOf, period.from, limit),
        artistChart(env, window, prev.to, prev.from, 100000),
      ]);
      return json({ window, asOf, from: period.from, previousPeriod: prev, rows: withChange(rows, before, (r) => r.artist) });
    }
    const rows = await artistChart(env, window, asOf, asOf, limit);
    return json({ window, asOf, rows });
  }

  if (url.pathname === "/charts/albums") {
    const asOf = url.searchParams.get("asOf") ?? vnToday();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 5000);
    return json({ window: "at", asOf, rows: await albumChart(env, asOf, limit) });
  }

  if (url.pathname === "/history/albums") {
    const asOf = url.searchParams.get("asOf") ?? vnToday();
    const artist = url.searchParams.get("artist")?.trim() ?? "";
    const album = url.searchParams.get("album")?.trim() ?? "";
    if (!artist || !album) return json({ error: "artist and album are required" }, 400);
    return json({ asOf, artist, album, ...(await albumHistory(env, asOf, artist, album, num("months", 36, 60))) });
  }

  if (url.pathname === "/points/artists") {
    const asOf = url.searchParams.get("asOf") ?? vnToday();
    return json({ asOf, ...(await artistPointsMemo(env, asOf)) });
  }

  if (url.pathname === "/board") {
    const kind = url.searchParams.get("kind") as BoardKind | null;
    if (kind && !["ww", "mm", "yy"].includes(kind)) return json({ error: "kind must be ww, mm or yy" }, 400);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 200);
    return json({ periods: await boardList(env, kind, limit) });
  }

  const asOfParam = url.searchParams.get("asOf") ?? vnToday();

  if (url.pathname === "/artists/alltime") {
    const sort = url.searchParams.get("sort") ?? "hours";
    if (!["hours", "plays", "points"].includes(sort)) return json({ error: "sort must be hours, plays or points" }, 400);
    return json(await artistsAllTime(env, asOfParam, sort as "hours" | "plays" | "points", num("limit", 100, 5000)));
  }

  if (url.pathname === "/artists/week") {
    return json(await artistsThisWeek(env, asOfParam, num("limit", 10, 50)));
  }

  if (url.pathname === "/history/artists") {
    return json({ asOf: asOfParam, ...(await artistHistory(env, asOfParam, num("months", 12, 60), num("top", 50, 300))) });
  }

  const artistPath = url.pathname.match(/^\/artist\/(.+)$/);
  if (artistPath) {
    const detail = await artistDetail(env, decodeURIComponent(artistPath[1]), asOfParam);
    return detail ? json(detail) : json({ error: "artist not found" }, 404);
  }

  const songPath = url.pathname.match(/^\/song\/([^/]+)$/);
  if (songPath) {
    const detail = await songDetail(env, decodeURIComponent(songPath[1]), asOfParam);
    return detail ? json(detail) : json({ error: "song not found" }, 404);
  }

  if (url.pathname === "/library") {
    return json({ ...(await librarySummary(env)), libraryRequest: await librarySyncRequest(env), usage: await usage(env) });
  }

  if (url.pathname === "/library/playlists") {
    const snapshot = await playlistSnapshot(env);
    return snapshot ? json(snapshot) : json({ error: "playlist snapshot not found" }, 404);
  }

  if (url.pathname === "/library/unmatched") {
    return json({ rows: await unmatched(env, num("limit", 30, 100), Number(url.searchParams.get("offset") ?? 0) || 0) });
  }

  if (url.pathname === "/library/search") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return json({ error: "q needs at least 2 characters" }, 400);
    return json({ q, ...(await searchLibrary(env, q, num("limit", 15, 50))) });
  }

  if (url.pathname === "/library/match" && req.method === "POST") {
    const out = await matchManually(env, (await req.json().catch(() => ({}))) as any);
    if (!("error" in out)) await bumpVersion(env, "manual match", true);
    return json(out, "error" in out ? 400 : 200);
  }

  if (url.pathname === "/library/sync-request") {
    if (req.method === "POST") return json(await requestLibrarySync(env));
    return json(await librarySyncRequest(env));
  }

  if (url.pathname === "/library/native-sync" && req.method === "POST") {
    const out = await importNativeLibrarySnapshot(env, (await req.json().catch(() => ({}))) as any);
    return json(out, "error" in out ? 400 : 200);
  }

  if (url.pathname === "/library/generation") {
    const row = await env.DB.prepare("SELECT generation FROM library_generation WHERE id=1").first<{generation:number}>();
    return json({generation:String(row?.generation ?? 0)});
  }
  if (url.pathname === "/library/metadata") {
    const generation = await env.DB.prepare("SELECT generation FROM library_generation WHERE id=1").first<{generation:number}>();
    const rows = await libraryMetadata(env,Number(url.searchParams.get("offset") ?? 0)||0,num("limit",1000,1000));
    const after = await env.DB.prepare("SELECT generation FROM library_generation WHERE id=1").first<{generation:number}>();
    if (generation?.generation !== after?.generation || String(after?.generation) !== url.searchParams.get("generation")) return json({error:"library_changed"},409);
    return json({generation:String(after?.generation),rows});
  }

  if (url.pathname === "/library/tracks") {
    return json({ rows: await libraryTracks(env, Number(url.searchParams.get("offset") ?? 0) || 0, num("limit", 1000, 1000)) });
  }

  if (url.pathname === "/library/import" && req.method === "POST") {
    const out = await importLibrary(env, (await req.json().catch(() => ({}))) as any);
    return json(out, "error" in out ? 400 : 200);
  }

  if (url.pathname === "/usage") return json(await usage(env));

  if (url.pathname === "/artwork") return json(await artworkMap(env));

  if (url.pathname === "/artwork/fill" && req.method === "POST") {
    const out = await fillArtwork(env, Math.min(Number(url.searchParams.get("n") ?? 20) || 20, 20));
    return json(out);
  }

  if (url.pathname === "/library/title-rules") {
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as any;
      const list = Array.isArray(body) ? body : Array.isArray(body?.rules) ? body.rules : [];
      // also accept the {b, c} shape of the user's rule list (b = Last.fm title, c = library title)
      const rules = list.map((r: any) => ({ from: r.from ?? r.b, to: r.to ?? r.c, artist: r.artist, track_id: r.track_id }));
      const results = await addTitleRules(env, rules);
      await resetUnmatched(env);
      await bumpVersion(env, "title rules", true);
      return json({ results });
    }
    if (req.method === "DELETE") {
      const out = await deleteTitleRule(env, url.searchParams.get("from") ?? "");
      await bumpVersion(env, "title rules", true);
      return json(out);
    }
    return json({ rules: await listTitleRules(env) });
  }

  if (url.pathname === "/settings/rules") {
    if (req.method === "POST") {
      const rules = await setRules(env, (await req.json().catch(() => ({}))) as any);
      await resetUnmatched(env); // let the matcher retry with the new rules
      await bumpVersion(env, "rules", true);
      return json({ rules });
    }
    return json({ rules: (await librarySummary(env)).rules });
  }

  if (url.pathname === "/settings/release-scan") {
    if (req.method === "POST") return json({ settings: await saveReleaseScanSettings(env.DB, await req.json().catch(() => ({}))) });
    return json({ settings: await getReleaseScanSettings(env.DB) });
  }

  if (url.pathname === "/settings/playlist-ranking") {
    if (req.method === "POST") return json({ settings: await savePlaylistRankingSettings(env.DB, await req.json().catch(() => ({}))) });
    return json({ settings: await getPlaylistRankingSettings(env.DB) });
  }

  if (url.pathname === "/settings/song-ranking") {
    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { track_id?: string; weight?: number; contextual?: boolean };
      const weight = typeof body.weight === "number" ? body.weight : body.contextual === true ? 0.8 : body.contextual === false ? 1 : NaN;
      if (!body.track_id || !isSongRankingWeight(weight)) return json({ error: "track_id and weight (0.7, 0.8, 0.9, or 1) are required" }, 400);
      const setting = await saveSongRankingWeight(env, body.track_id, weight);
      if (!setting) return json({ error: "song not found" }, 404);
      await bumpVersion(env, `song ranking: ${body.track_id} ${setting.weight}`, true);
      return json({ setting });
    }
    const setting = await getSongRankingWeight(env, url.searchParams.get("track_id") ?? "");
    return setting ? json({ setting }) : json({ error: "song not found" }, 404);
  }

  if (url.pathname === "/board/compute") {
    // Recompute one period without storing it (used to compare with Lark's board).
    const kind = url.searchParams.get("kind") as BoardKind;
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!["ww", "mm", "yy"].includes(kind) || !/^\d{4}-\d\d-\d\d$/.test(from) || !/^\d{4}-\d\d-\d\d$/.test(to)) {
      return json({ error: "kind (ww|mm|yy), from and to (YYYY-MM-DD) are required" }, 400);
    }
    return json({ kind, from, to, entries: await computeBoard(env, kind, from, to) });
  }

  if (url.pathname === "/history/songs") {
    const asOf = url.searchParams.get("asOf") ?? vnToday();
    const top = Math.min(Number(url.searchParams.get("top") ?? 100) || 100, 5000);
    const months = Math.min(Number(url.searchParams.get("months") ?? 18) || 18, 36);
    return json({ asOf, ...(await songHistory(env, asOf, top, months)) });
  }

  if (url.pathname === "/history/song-ranks") {
    const ids = (url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    if (!ids.length) return json({ error: "ids is required" }, 400);
    const months = Math.min(Number(url.searchParams.get("months") ?? 36) || 36, 60);
    return json(await scopedSongHistory(env, ids, months));
  }

  if (url.pathname === "/new-additions") {
    const scope = url.searchParams.get("scope") ?? "", asOf = url.searchParams.get("asOf") ?? vnToday();
    if (!/^\d{4}(-(?:0[1-9]|1[0-2]))?$/.test(scope) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf))
      return json({ error: "scope must be YYYY or YYYY-MM; asOf must be YYYY-MM-DD" }, 400);
    return json(await newAdditions(env, scope, asOf, num("limit", 25, 5000)));
  }
  if (url.pathname === "/overview") {
    const scope = url.searchParams.get("scope") ?? "all";
    if (!/^(all|ft0424|week|15d|1m|\d{4}|\d{4}-\d{2})$/.test(scope)) return json({ error: "scope must be all, ft0424, week, 15d, 1m, YYYY or YYYY-MM" }, 400);
    return json(await overview(env, scope, url.searchParams.get("asOf") ?? vnToday(), num("limit", 25, 5000)));
  }

  if (url.pathname === "/ratings") {
    return json({ rows: await ratings(env, url.searchParams.get("asOf") ?? vnToday()) });
  }

  if (url.pathname === "/release-years") {
    return json({ rows: await releaseYears(env) });
  }

  if (url.pathname === "/snapshots" && req.method === "POST") {
    const added = await ensureSnapshots(env, vnToday());
    const board = await ensureBoard(env, vnToday());
    if (added.length || board.length) await bumpVersion(env, `snapshots: ${[...added, ...board].join(", ")}`);
    return json({ added, board });
  }

  if (url.pathname === "/match" && req.method === "POST") {
    const match = await matchPlays(env);
    if (match.matched) await bumpVersion(env, `match: ${match.matched}`);
    return json(match);
  }

  return json({ error: "not found" }, 404);
}
