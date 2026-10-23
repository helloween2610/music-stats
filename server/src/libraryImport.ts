import type { Env } from "./index";
import { bumpVersion } from "./cache";
import { matchKey, matchPlays } from "./match";

const COLUMNS = [
  "title", "artist", "album_artist", "album", "genre", "duration_s", "year", "date_added", "comments",
  "apple_plays", "apple_skips", "my_rating", "last_played", "plays_to_12_2024", "artist_id", "album_id",
  "genre_id", "in_library", "apple_pid", "library_metadata",
] as const;
type Column = (typeof COLUMNS)[number];
const KEYS: Record<string, string> = { title: "key_title", artist: "key_artist", album_artist: "key_album_artist", album: "key_album" };

/** One page of the library with each track's logged play count (to pick between duplicates). */
export async function libraryTracks(env: Env, offset: number, limit: number) {
  const { results } = await env.DB.prepare(
    `WITH c AS (SELECT track_id, COUNT(*) AS n FROM plays WHERE track_id IS NOT NULL GROUP BY track_id)
     SELECT t.id, ${COLUMNS.map((c) => "t." + c).join(", ")}, COALESCE(t.rank_weight_custom, t.rank_weight, 1) AS rank_weight, COALESCE(c.n, 0) AS logged
     FROM tracks t LEFT JOIN c ON c.track_id = t.id ORDER BY t.id LIMIT ?1 OFFSET ?2`,
  ).bind(limit, offset).all();
  return results;
}

/** Stable metadata only; listening counts continue through statistics APIs. */
export async function libraryMetadata(env: Env, offset: number, limit: number) {
  return (await env.DB.prepare(`SELECT id, ${COLUMNS.join(", ")}, COALESCE(rank_weight_custom, rank_weight, 1) AS rank_weight FROM tracks ORDER BY id LIMIT ?1 OFFSET ?2`).bind(limit,offset).all()).results;
}

interface ImportBody {
  upserts?: ({ id: string } & Partial<Record<Column, string | number | null>>)[];
  // changed: rows were sent in this run (else only the request is closed, the cache stays)
  finish?: { reset_match?: boolean; summary?: unknown; changed?: boolean };
}

export type SyncRequest = { status: "idle" | "pending" | "done" | "failed"; requested_at?: string; done_at?: string; summary?: unknown; mode?: "cloud"; job_id?: string; phase?: string; error?: string };

/** State of the library sync button: idle, pending, failed or done (with the summary). */
export async function librarySyncRequest(env: Env): Promise<SyncRequest> {
  const row = await env.DB.prepare("SELECT value FROM sync_state WHERE key = 'library_request'").first<{ value: string }>();
  return row ? JSON.parse(row.value) : { status: "idle" };
}

/** The app's button enqueues one background job; concurrent taps share that job. */
export async function requestLibrarySync(env: Env) {
  const next: SyncRequest = { status: "pending", mode: "cloud", job_id: crypto.randomUUID(), requested_at: new Date().toISOString(), phase: "Đang kiểm tra dữ liệu thư viện…" };
  const claim = await env.DB.prepare(`INSERT INTO sync_state (key, value, updated_at) VALUES ('library_request', ?1, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    WHERE json_extract(sync_state.value, '$.status') != 'pending'
       OR sync_state.updated_at < datetime('now', '-15 minutes') RETURNING value`).bind(JSON.stringify(next)).first();
  if (!claim) return librarySyncRequest(env);
  try { await env.LIBRARY_QUEUE.send({ kind: "library-sync", jobId: next.job_id! }); }
  catch { await setLibraryRequest(env, { ...next, status: "failed", error: "Chưa gửi được yêu cầu đồng bộ. Hãy thử lại." }); throw new Error("Không gửi được yêu cầu đồng bộ"); }
  return next;
}

export async function setLibraryRequest(env: Env, state: SyncRequest) {
  await env.DB.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('library_request', ?1, datetime('now'))")
    .bind(JSON.stringify(state)).run();
}

/** Insert new tracks and update changed fields of existing ones; `finish` closes the run. */
export async function importLibrary(env: Env, body: ImportBody) {
  const rows = body.upserts ?? [];
  if (rows.length > 200) return { error: "at most 200 rows per request" };
  const stmts: D1PreparedStatement[] = [];
  for (const row of rows) {
    if (!/^TR\d+$/.test(row.id ?? "")) return { error: `bad id ${row.id}` };
    const cols = COLUMNS.filter((c) => c in row);
    const values: unknown[] = cols.map((c) => row[c] ?? null);
    const all = [...cols] as string[];
    for (const c of cols) if (KEYS[c]) { all.push(KEYS[c]); values.push(matchKey(row[c] as string | null)); }
    if (!all.length) continue;
    const ph = all.map((_, i) => `?${i + 2}`);
    // New tracks come with every column (title is NOT NULL); changed ones only with what changed.
    stmts.push(env.DB.prepare(row.title !== undefined
      ? `INSERT INTO tracks (id, ${all.join(", ")}) VALUES (?1, ${ph.join(", ")})
         ON CONFLICT (id) DO UPDATE SET ${all.map((c, i) => `${c} = ${ph[i]}`).join(", ")}, updated_at = datetime('now')`
      : `UPDATE tracks SET ${all.map((c, i) => `${c} = ${ph[i]}`).join(", ")}, updated_at = datetime('now') WHERE id = ?1`,
    ).bind(row.id, ...values));
  }
  if (stmts.length) await env.DB.batch(stmts);

  let match = null;
  if (body.finish) {
    const req = await librarySyncRequest(env);
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('library', ?1, datetime('now'))")
        .bind(JSON.stringify(body.finish.summary ?? {})),
      env.DB.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('library_request', ?1, datetime('now'))")
        .bind(JSON.stringify({ ...req, status: "done", done_at: new Date().toISOString(), summary: body.finish.summary ?? null })),
    ]);
    // Library changes move all-time numbers too (durations, baselines, new tracks): drop every cached result.
    if (body.finish.changed !== false) await bumpVersion(env, "library import", true);
    // New or renamed tracks: let the matcher retry unmatched Last.fm scrobbles (cron continues the rest).
    // Lark log rows stay as Lark left them, so pre-12/2024 numbers keep matching Lark.
    if (body.finish.reset_match) {
      await env.DB.prepare("UPDATE plays SET match_tried = 0 WHERE track_id IS NULL AND source = 'lastfm' AND match_tried = 1").run();
      match = await matchPlays(env);
    }
  }
  return { written: stmts.length, match };
}
