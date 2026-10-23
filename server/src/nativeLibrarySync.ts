import type { Env } from "./index";
import { bumpVersion } from "./cache";
import { importLibrary, libraryTracks } from "./libraryImport";
import { planLibraryImport } from "./libraryXml";
import { savePlaylistSnapshot, type PlaylistSnapshot } from "./playlistSnapshot";
import { catalogId, catalogKeys, type CatalogEntry } from "../../shared/apple-catalog";

type NativeTrack = {
  title?: unknown; artist?: unknown; album?: unknown; albumArtist?: unknown; genre?: unknown;
  duration_s?: unknown; year?: unknown; date_added?: unknown; comments?: unknown;
  apple_plays?: unknown; apple_skips?: unknown; my_rating?: unknown; last_played?: unknown;
  apple_pid?: unknown; catalog_id?: unknown; metadata?: unknown;
};

type NativeSnapshot = {
  source?: unknown;
  exportedAt?: unknown;
  tracks?: unknown;
  playlists?: unknown;
};

const text = (value: unknown) => String(value ?? "").trim() || null;
const number = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const integer = (value: unknown) => {
  const n = number(value);
  return n === null ? null : Math.round(n);
};
const dateText = (value: unknown) => {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(raw) ? raw : null;
};
const safeMetadata = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

function normalizeTrack(row: NativeTrack) {
  const title = text(row.title);
  if (!title) return null;
  const metadata = safeMetadata(row.metadata);
  const artist = text(row.artist);
  const album = text(row.album);
  const albumArtist = text(row.albumArtist) || artist;
  return {
    title,
    artist,
    album,
    album_artist: albumArtist,
    genre: text(row.genre),
    duration_s: integer(row.duration_s),
    year: integer(row.year),
    date_added: dateText(row.date_added),
    comments: text(row.comments),
    apple_plays: integer(row.apple_plays) ?? 0,
    apple_skips: integer(row.apple_skips) ?? 0,
    my_rating: integer(row.my_rating),
    last_played: dateText(row.last_played),
    apple_pid: text(row.apple_pid),
    library_metadata: JSON.stringify(metadata),
    catalog_id: catalogId(row.catalog_id),
  };
}

function catalogEntries(rows: ReturnType<typeof normalizeTrack>[]) {
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row || !row.catalog_id || !row.artist || !row.title || !row.album) continue;
    for (const library of [false, true]) {
      for (const key of catalogKeys(row.artist, row.title, row.album, library)) {
        const ids = grouped.get(key) ?? new Set<string>();
        ids.add(row.catalog_id);
        grouped.set(key, ids);
      }
    }
  }
  return [...grouped].map(([key, ids]): CatalogEntry => ({ key, id: ids.size === 1 ? [...ids][0] : null }));
}

async function publishCatalog(env: Env, entries: CatalogEntry[]) {
  if (!entries.length) return { keys: 0, changed: false };
  const existing = await env.DB.prepare("SELECT match_key,catalog_id FROM apple_catalog_links").all<{ match_key: string; catalog_id: string | null }>();
  const known = new Map(existing.results.map(row => [row.match_key, row.catalog_id]));
  const changed = entries.filter(entry => !known.has(entry.key) || known.get(entry.key) !== entry.id);
  for (let i = 0; i < changed.length; i += 100) {
    await env.DB.batch(changed.slice(i, i + 100).map(entry => env.DB.prepare(`INSERT INTO apple_catalog_links(match_key,catalog_id,source)
      VALUES (?1,?2,'iOS Music Library')
      ON CONFLICT(match_key) DO UPDATE SET catalog_id=excluded.catalog_id,source=excluded.source,imported_at=datetime('now')`)
      .bind(entry.key, entry.id)));
  }
  if (changed.length) {
    await env.DB.prepare("DELETE FROM discovery_cache WHERE key LIKE 'apple-detail:verified:%' OR key LIKE 'apple-album:verified:%'").run();
  }
  return { keys: changed.length, changed: changed.length > 0 };
}

function playlistSnapshot(value: unknown): PlaylistSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as PlaylistSnapshot;
  if (!Array.isArray(snapshot.playlists) || !snapshot.playlists.length || !snapshot.tracks || typeof snapshot.tracks !== "object") return null;
  return {
    exportedAt: typeof snapshot.exportedAt === "string" ? snapshot.exportedAt : null,
    folders: Array.isArray(snapshot.folders) ? snapshot.folders.filter(v => typeof v === "string") : ["Apple Music"],
    playlists: snapshot.playlists.filter(p => p && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.items)),
    tracks: snapshot.tracks,
    source: "iOS Music Library",
  };
}

export async function importNativeLibrarySnapshot(env: Env, body: NativeSnapshot) {
  const source = body.source === "ios-media-library" ? "iOS Music Library" : "Native Music Library";
  if (!Array.isArray(body.tracks)) return { error: "missing tracks" };
  if (body.tracks.length > 15000) return { error: "too many tracks" };

  const rows = body.tracks.map(track => normalizeTrack(track as NativeTrack)).filter((row): row is NonNullable<typeof row> => !!row);
  if (!rows.length) return { error: "empty library" };

  const existing = await libraryTracks(env, 0, 100_000);
  const plan = planLibraryImport(rows, existing as any);
  for (let i = 0; i < plan.upserts.length; i += 200) {
    const result = await importLibrary(env, { upserts: plan.upserts.slice(i, i + 200) as any });
    if ("error" in result) return result;
  }

  const catalog = await publishCatalog(env, catalogEntries(rows));
  const playlists = playlistSnapshot(body.playlists);
  const playlistsSaved = playlists ? await savePlaylistSnapshot(env, playlists) : false;
  const summary = {
    source,
    tracks: rows.length,
    added: plan.added,
    changed: plan.changed,
    missing: plan.missing,
    metadata_changed: plan.metadataChanged,
    matched: plan.matched,
    catalog_keys: catalog.keys,
    catalog_changed: catalog.changed,
    catalog_configured: true,
    playlists: playlistsSaved ? playlists!.playlists.length : undefined,
    playlist_entries: playlistsSaved ? playlists!.playlists.reduce((n, p) => n + p.items.length, 0) : undefined,
    file_modified: typeof body.exportedAt === "string" ? body.exportedAt : new Date().toISOString(),
  };
  await env.DB.prepare("INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES ('library_native_source',?1,datetime('now'))")
    .bind(JSON.stringify(summary)).run();
  await importLibrary(env, { finish: { changed: !!plan.upserts.length || catalog.changed || playlistsSaved, reset_match: plan.resetMatch, summary } });
  if (playlistsSaved && !plan.upserts.length && !catalog.changed) await bumpVersion(env, "playlist import", true);
  return { ok: true, summary };
}
