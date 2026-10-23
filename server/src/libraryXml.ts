import { SaxesParser } from "saxes";

type Row = Record<string, any>;
export const libraryKey = (v: unknown) => String(v || "").normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ");
const loose = (v: unknown) => libraryKey(v).replace(/[^\p{L}\p{N}]/gu, "");
const text = (v: unknown) => String(v || "").trim() || null;
const localDate = (v: unknown) => {
  if (!v) return null;
  const ms = Date.parse(String(v));
  if (!Number.isFinite(ms)) throw new Error("Library.xml chứa ngày không hợp lệ");
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 16);
};

/** Streaming plist reader: retain only track fields, never the large playlist arrays. */
export async function parseLibraryXml(stream: ReadableStream<Uint8Array>) {
  let depth = 0, inTracks = false, sawTracks = false, track: Row | null = null;
  let field = "", rootField = "", value = "", valueTag = "", exportedAt: string | null = null;
  let total = 0, playlistOnly = 0, bytes = 0;
  const best = new Map<string, Row>();
  const parser = new SaxesParser();
  parser.on("opentag", node => {
    depth++;
    if (node.name === "dict" && depth === 3 && rootField === "Tracks") { inTracks = sawTracks = true; }
    else if (node.name === "dict" && depth === 4 && inTracks) { track = {}; field = ""; }
    if ((track && depth === 5) || (!inTracks && depth === 3)) { value = ""; valueTag = node.name; }
  });
  parser.on("text", s => { if ((track && depth === 5) || (!inTracks && depth === 3)) value += s; });
  parser.on("cdata", s => { if (track && depth === 5) value += s; });
  parser.on("closetag", node => {
    if (track && depth === 5) {
      if (node.name === "key") field = value;
      else if (["string", "date", "integer", "real", "true", "false"].includes(valueTag)) {
        track[field] = valueTag === "true" ? true : valueTag === "false" ? false
          : valueTag === "integer" || valueTag === "real" ? Number(value) : value;
      }
    } else if (!inTracks && depth === 3) {
      if (node.name === "key") rootField = value;
      else if (rootField === "Date" && node.name === "date") exportedAt = localDate(value);
    }
    if (node.name === "dict" && depth === 4 && track) {
      const r = track;
      if (r["Playlist Only"] === true) playlistOnly++;
      else if (text(r.Name)) {
        total++;
        const row: Row = {
          title: text(r.Name), artist: text(r.Artist), album: text(r.Album), album_artist: text(r["Album Artist"]),
          genre: text(r.Genre), duration_s: r["Total Time"] ? Math.floor(r["Total Time"] / 1000) : null,
          year: r.Year || null, date_added: localDate(r["Date Added"]), comments: text(r.Comments),
          apple_plays: r["Play Count"] || 0, apple_skips: r["Skip Count"] || 0, my_rating: r.Rating || null,
          last_played: localDate(r["Play Date UTC"]), apple_pid: text(r["Persistent ID"]),
          library_metadata: JSON.stringify({ persistentId: r["Persistent ID"] || null,
            releaseDate: r["Release Date"]?.slice(0, 10) || null, updated: localDate(r["Date Modified"]),
            disc: r["Disc Number"] || 1, trackCount: r["Track Count"] || null, trackNumber: r["Track Number"] || null,
            loved: !!(r.Loved || r.Favorited), disliked: !!r.Disliked, albumRating: r["Album Rating"] ?? null,
            bpm: r.BPM || null, composer: r.Composer || null, artworkCount: r["Artwork Count"] || 0 }),
        };
        const key = [row.title, row.artist, row.album].map(libraryKey).join("\x1f");
        if (!best.has(key) || row.apple_plays > best.get(key)!.apple_plays) best.set(key, row);
      }
      track = null;
    }
    if (node.name === "dict" && depth === 3 && inTracks) inTracks = false;
    depth--;
  });
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 50_000_000) throw new Error("Library.xml vượt quá 50 MB");
      parser.write(decoder.decode(next.value, { stream: true }));
    }
    parser.write(decoder.decode()).close();
  } catch (e) { await reader.cancel().catch(() => {}); throw e; }
  finally { reader.releaseLock(); }
  if (!sawTracks || !best.size) throw new Error("Library.xml không có bài trong thư viện; chưa thay đổi dữ liệu");
  return { rows: [...best.values()], total, playlistOnly, exportedAt, bytes };
}

const passes: ((r: Row) => unknown[])[] = [
  r => [r.apple_pid],
  r => [libraryKey(r.title), r.date_added],
  r => [libraryKey(r.title), libraryKey(r.artist), libraryKey(r.album)],
  r => [loose(r.title), loose(r.artist), loose(r.album)],
  r => [loose(r.title), loose(r.artist), r.duration_s],
  r => [loose(r.title), loose(r.artist)],
  r => [loose(r.title), loose(r.album), r.duration_s],
];
const comments = (v: unknown) => [...new Set(String(v || "").split(",").map(s => s.trim()).filter(s => s && s !== "0"))].sort().join(",");

/** Existing IDs, dates and historical play baselines survive metadata changes. */
export function planLibraryImport(rows: Row[], tracks: Row[]) {
  const done = new Map<number, Row>(), used = new Set<string>();
  for (const keyOf of passes) {
    const exports = new Map<string, number[]>(), existing = new Map<string, Row[]>();
    const key = (r: Row) => { const parts = keyOf(r); return parts.some(v => v == null || v === "") ? null : JSON.stringify(parts); };
    rows.forEach((r, i) => { if (!done.has(i)) { const k = key(r); if (k) exports.set(k, [...(exports.get(k) || []), i]); } });
    tracks.forEach(r => { if (!used.has(r.id)) { const k = key(r); if (k) existing.set(k, [...(existing.get(k) || []), r]); } });
    for (const [k, indices] of exports) {
      const candidates = existing.get(k);
      if (indices.length !== 1 || !candidates?.length) continue;
      candidates.sort((a, b) => (b.logged || 0) - (a.logged || 0) || Number(a.id.slice(2)) - Number(b.id.slice(2)));
      done.set(indices[0], candidates[0]); used.add(candidates[0].id);
    }
  }
  const next: Record<string, number> = {};
  for (const [prefix, field] of Object.entries({ TR: "id", AT: "artist_id", AB: "album_id", GE: "genre_id" }))
    next[prefix] = 1 + Math.max(0, ...tracks.map(r => String(r[field] || "").startsWith(prefix) ? Number(r[field].slice(2)) || 0 : 0));
  const id = (prefix: string) => prefix + String(next[prefix]++).padStart(5, "0");
  const artists = new Map<string, string>(), albums = new Map<string, string>(), genres = new Map<string, string>();
  tracks.forEach(r => {
    if (r.artist_id) artists.set(loose(r.album_artist || r.artist), r.artist_id);
    if (r.album_id) albums.set(loose(r.album), r.album_id);
    if (r.genre_id) genres.set(libraryKey(r.genre), r.genre_id);
  });
  const lookup = (map: Map<string, string>, key: string, prefix: string) => {
    if (!key) return null;
    if (!map.has(key)) map.set(key, id(prefix));
    return map.get(key)!;
  };
  const upserts: Row[] = [];
  let added = 0, changed = 0, metadataChanged = 0, resetMatch = false;
  rows.forEach((r, i) => {
    const old = done.get(i);
    if (!old) {
      const albumArtist = r.album_artist || r.artist;
      upserts.push({ ...r, id: id("TR"), album_artist: albumArtist, in_library: 1, plays_to_12_2024: 0,
        artist_id: lookup(artists, loose(albumArtist), "AT"), album_id: lookup(albums, loose(r.album), "AB"),
        genre_id: lookup(genres, libraryKey(r.genre), "GE") });
      added++; resetMatch = true;
      return;
    }
    const patch: Row = { id: old.id };
    for (const field of ["title", "artist", "album", "album_artist", "genre", "duration_s", "year", "apple_plays", "apple_skips", "last_played", "apple_pid", "library_metadata"])
      if (r[field] != null && r[field] !== old[field]) patch[field] = r[field];
    if (comments(r.comments) !== comments(old.comments)) patch.comments = r.comments;
    if ((r.my_rating || 0) !== (old.my_rating || 0)) patch.my_rating = r.my_rating;
    if (old.in_library !== 1) patch.in_library = 1;
    if (Object.keys(patch).length > 1) {
      upserts.push(patch);
      if (Object.keys(patch).some(k => !["id", "apple_pid", "library_metadata"].includes(k))) changed++;
      else metadataChanged++;
      if (["title", "artist", "album", "album_artist"].some(k => k in patch)) resetMatch = true;
    }
  });
  const missing = tracks.filter(t => t.in_library === 1 && !used.has(t.id));
  // Membership removals happen after every successfully parsed/validated track is imported.
  upserts.push(...missing.map(t => ({ id: t.id, in_library: 0 })));
  return { upserts, added, changed, metadataChanged, missing: missing.length, resetMatch, matched: done.size };
}
