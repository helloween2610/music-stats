// Links scrobbles (plays.track_id IS NULL) to library tracks.
// Order: aliases (title replacement rules first, then learned ones) → exact title + artist (+ album)
// → title without a "(… Remaster)" suffix → title without a leading track number ("084 Time 2.1").
// Plays that still don't match stay NULL and show up in the app's "unmatched" queue.
// Each play is tried once (match_tried = 1); call resetUnmatched() after the library or aliases change.
import type { Env } from "./index";
import { getRules } from "./library";

const BATCH = 200;

/**
 * Must equal key() in scripts/build_import_sql.py. NFC first: the Apple export writes accents as
 * separate marks ("e" + U+0301) while Last.fm sends "é".
 */
export function matchKey(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

/** "084 beyond the dark sun 2.1" → "beyond the dark sun 2.1" (Lark "Title (lower)": numbers below 101). */
export function stripTrackNo(key: string): string {
  const m = key.match(/^(\d{3}) (.+)$/);
  return m && Number(m[1]) < 101 ? m[2] : key;
}

/** "Memento Mori 2.0 (2026 Remaster)" → "memento mori 2.0" */
export function stripRemaster(key: string): string {
  return key.replace(/\s*[([][^)\]]*remaster[^)\]]*[)\]]\s*$/i, "").replace(/\s+-\s+[^-]*remaster(ed)?(\s+\d{4})?$/i, "").trim();
}

interface Unmatched {
  id: number;
  title: string;
  artist: string;
  album: string | null;
}

export async function matchPlays(env: Env): Promise<{ checked: number; matched: number }> {
  const { results: plays } = await env.DB.prepare(
    // Only Last.fm plays: the Lark log keeps Lark's own links (blank = "not in library") for parity.
    "SELECT id, title, artist, album FROM plays WHERE track_id IS NULL AND match_tried = 0 AND source = 'lastfm' ORDER BY id DESC LIMIT ?1",
  )
    .bind(BATCH)
    .all<Unmatched>();
  if (!plays.length) return { checked: 0, matched: 0 };

  const keys = plays.map((p) => ({
    id: p.id,
    artist: matchKey(p.artist),
    title: matchKey(p.title),
    album: matchKey(p.album),
  }));

  // One round trip per strategy: free Workers have a small CPU and subrequest budget.
  const aliasQ = env.DB.prepare(
    `SELECT track_id FROM aliases WHERE key_artist = ?1 AND key_title = ?2
     ORDER BY (origin = 'rule') DESC, (key_album = ?3) DESC LIMIT 1`,
  );
  const trackQ = env.DB.prepare(
    `SELECT id FROM tracks WHERE key_title = ?2 AND (key_artist = ?1 OR key_album_artist = ?1)
     ORDER BY (key_album = ?3) DESC LIMIT 1`,
  );

  const found = new Map<number, string>();
  const tryStrategy = async (pending: typeof keys, stmt: D1PreparedStatement, titleOf: (k: (typeof keys)[0]) => string) => {
    if (!pending.length) return;
    const res = await env.DB.batch(pending.map((k) => stmt.bind(k.artist, titleOf(k), k.album)));
    res.forEach((r, i) => {
      const row = r.results[0] as { track_id?: string; id?: string } | undefined;
      const tid = row?.track_id ?? row?.id;
      if (tid) found.set(pending[i].id, tid);
    });
  };

  // Leading track numbers come from Lark's numbered titles; strip them before anything else.
  for (const k of keys) k.title = stripTrackNo(k.title);
  await tryStrategy(keys, aliasQ, (k) => k.title);
  await tryStrategy(keys.filter((k) => !found.has(k.id)), trackQ, (k) => k.title);
  // Rule "Gộp bản remaster vào bài gốc" (on by default).
  const { mergeRemaster } = await getRules(env);
  if (mergeRemaster) await tryStrategy(
    keys.filter((k) => !found.has(k.id) && stripRemaster(k.title) !== k.title),
    trackQ,
    (k) => stripRemaster(k.title),
  );

  const upd = env.DB.prepare("UPDATE plays SET track_id = ?2, match_tried = 1 WHERE id = ?1");
  await env.DB.batch(keys.map((k) => upd.bind(k.id, found.get(k.id) ?? null)));
  return { checked: plays.length, matched: found.size };
}

export async function resetUnmatched(env: Env) {
  await env.DB.prepare("UPDATE plays SET match_tried = 0 WHERE track_id IS NULL AND source = 'lastfm'").run();
}
