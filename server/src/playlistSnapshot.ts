import { SaxesParser } from "saxes";

const FOLDERS = ["_New Music", "00_COLLECTION"] as const;
type Row = Record<string, any>;
export type PlaylistTrack = {
  title: string; artist?: string; album?: string; albumArtist?: string; duration?: number;
  year?: number; persistentId?: string; inLibrary?: boolean; missing?: boolean;
};
export type Playlist = { id: string; name: string; folder: string; favourite?: boolean; path: string; items: string[] };
export type PlaylistSnapshot = { exportedAt: string | null; folders: string[]; playlists: Playlist[]; tracks: Record<string, PlaylistTrack>; source?: string };

type DictFrame = { type: "dict"; value: Row; key: string };
type ArrayFrame = { type: "array"; value: any[] };
type Frame = DictFrame | ArrayFrame;

function attach(parent: Frame | undefined, value: any) {
  if (!parent) return;
  if (parent.type === "array") parent.value.push(value);
  else if (parent.key) { parent.value[parent.key] = value; parent.key = ""; }
}

function primitive(tag: string, value: string) {
  if (tag === "true") return true;
  if (tag === "false") return false;
  if (tag === "integer" || tag === "real") return Number(value) || 0;
  return value;
}

function parsePlist(bytes: Uint8Array): Row {
  const stack: Frame[] = [];
  let root: any = null, value = "", valueTag = "";
  const parser = new SaxesParser();
  parser.on("opentag", node => {
    if (node.name === "dict") stack.push({ type: "dict", value: {}, key: "" });
    else if (node.name === "array") stack.push({ type: "array", value: [] });
    else if (["key", "string", "date", "integer", "real", "true", "false"].includes(node.name)) { value = ""; valueTag = node.name; }
  });
  parser.on("text", s => { if (valueTag) value += s; });
  parser.on("cdata", s => { if (valueTag) value += s; });
  parser.on("closetag", node => {
    if (node.name === "dict" || node.name === "array") {
      const frame = stack.pop();
      if (!frame) return;
      if (stack.length) attach(stack[stack.length - 1], frame.value);
      else root = frame.value;
      return;
    }
    if (node.name === "key") {
      const frame = stack[stack.length - 1];
      if (frame?.type === "dict") frame.key = value;
      valueTag = "";
      return;
    }
    if (["string", "date", "integer", "real", "true", "false"].includes(node.name)) {
      attach(stack[stack.length - 1], primitive(node.name, value));
      valueTag = "";
    }
  });
  parser.write(new TextDecoder().decode(bytes)).close();
  if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("Library.xml không đọc được playlist");
  return root;
}

function folderPath(p: Row, byId: Map<string, Row>) {
  const names: string[] = [], seen = new Set<string>();
  while (p) {
    const pid = String(p["Playlist Persistent ID"] || "");
    if (!pid || seen.has(pid)) return null;
    seen.add(pid);
    if (p.Folder) {
      if (!p["Parent Persistent ID"]) return [String(p.Name || ""), ...names.reverse()];
      names.push(String(p.Name || ""));
    }
    p = byId.get(String(p["Parent Persistent ID"] || "")) as Row;
  }
  return null;
}

export function parsePlaylistSnapshot(bytes: Uint8Array): PlaylistSnapshot {
  const data = parsePlist(bytes);
  const playlists: Row[] = Array.isArray(data.Playlists) ? data.Playlists : [];
  const source: Record<string, Row> = data.Tracks && typeof data.Tracks === "object" ? data.Tracks : {};
  const byId = new Map<string, Row>();
  for (const p of playlists) {
    const id = String(p["Playlist Persistent ID"] || "");
    if (id) byId.set(id, p);
  }
  const selected: Playlist[] = [], tracks: Record<string, PlaylistTrack> = {};
  for (const p of playlists) {
    const path = folderPath(p, byId) || ["Apple Music"];
    const favourite = !!(p.Favorited || p.Loved);
    if (p.Folder || (!FOLDERS.includes(path[0] as any) && !favourite)) continue;
    const items: string[] = [];
    const playlistItems: Row[] = Array.isArray(p["Playlist Items"]) ? p["Playlist Items"] : [];
    for (const item of playlistItems) {
      const tid = String(item["Track ID"] || "");
      if (!tid) continue;
      const row = source[tid];
      items.push(tid);
      if (tracks[tid]) continue;
      if (!row) { tracks[tid] = { title: "Bài chưa có thông tin trong XML", missing: true }; continue; }
      tracks[tid] = {
        title: String(row.Name || ""), artist: String(row.Artist || row["Album Artist"] || ""),
        album: String(row.Album || ""), albumArtist: String(row["Album Artist"] || ""),
        duration: row["Total Time"] ? Math.floor(Number(row["Total Time"]) / 1000) : 0, year: Number(row.Year || 0),
        persistentId: String(row["Persistent ID"] || ""), inLibrary: row["Playlist Only"] !== true,
      };
    }
    selected.push({ id: String(p["Playlist Persistent ID"] || p.Name || selected.length), name: String(p.Name || ""), favourite,
      folder: path[0], path: path.join(" / "), items });
  }
  selected.sort((a, b) => {
    const ia = FOLDERS.includes(a.folder as any) ? FOLDERS.indexOf(a.folder as any) : FOLDERS.length;
    const ib = FOLDERS.includes(b.folder as any) ? FOLDERS.indexOf(b.folder as any) : FOLDERS.length;
    return ia - ib || a.path.localeCompare(b.path, "vi", { sensitivity: "base", numeric: true }) || a.name.localeCompare(b.name, "vi", { sensitivity: "base", numeric: true });
  });
  const exportedAt = data.Date ? String(data.Date) : null;
  return { exportedAt, folders: [...FOLDERS], playlists: selected, tracks, source: "Library.xml" };
}

export async function savePlaylistSnapshot(env: { DB: D1Database }, snapshot: PlaylistSnapshot) {
  if (!snapshot.playlists.length) return false;
  await env.DB.prepare("INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES ('playlist_snapshot',?1,datetime('now'))")
    .bind(JSON.stringify(snapshot)).run();
  return true;
}

export async function playlistSnapshot(env: { DB: D1Database }) {
  const row = await env.DB.prepare("SELECT value FROM sync_state WHERE key='playlist_snapshot'").first<{ value: string }>();
  return row ? JSON.parse(row.value) as PlaylistSnapshot : null;
}
