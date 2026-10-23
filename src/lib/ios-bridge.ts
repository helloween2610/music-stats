import { BROWSER_PREVIEW, IOS_APP } from "@/config";
import { appleMusicNativeUrl } from "@/lib/apple-music-opening";

export async function shareUrlInNativeApp(url: string, title = "Sổ Nghe Nhạc"): Promise<boolean> {
  if (!IOS_APP) return false;
  const { Share } = await import("@capacitor/share");
  await Share.share({ title, url });
  return true;
}

export async function openAppleMusicInNativeApp(url: string): Promise<boolean> {
  if (!IOS_APP) return false;
  const { AppLauncher } = await import("@capacitor/app-launcher");
  await AppLauncher.openUrl({ url: appleMusicNativeUrl(url) });
  return true;
}

export type NativeTrackAction = "play" | "playpause" | "next" | "last";
export type NativeTrackLookup = { artist?: string; title?: string; album?: string; storeId?: string };
export type NativeNowPlaying = {
  title: string; subtitle: string; album: string; persistentID: string; trackID?: string; year: string; statsLine: string;
  inLibrary?: boolean; scrobbles?: number; listeners?: number;
  plays?: number; minutes?: number; duration: number; elapsed: number; playing: boolean;
};
export type NativePlayerQueueItem = {
  id: string; trackID?: string; title: string; artist: string; album: string; year: string; statsLine: string;
  lastPlayed?: string;
  inLibrary?: boolean; scrobbles?: number; listeners?: number;
  plays?: number; minutes?: number; duration: number; current: boolean;
};
export type NativePlayerState = {
  nowPlaying: NativeNowPlaying;
  queue: NativePlayerQueueItem[];
  currentIndex: number;
  queueTitle: string;
  queueEditable: boolean;
  repeatMode: "none" | "all" | "one";
  shuffleMode: "off" | "songs";
  recentPlayStarts?: Record<string, string>;
};
export type NativeWidgetPlaylist = {
  id: string; name: string; path: string; rank: number; plays: number; trackCount: number; hue: number;
};
export type NativePlaylistTrackSummary = {
  id: string; persistentID?: string; title: string; subtitle: string; year: string; lastPlayed?: string;
};

const NATIVE_PLAYER_ORIGIN = "http://127.0.0.1:8765";
export const PREVIEW_PLAYER_COMMAND_EVENT = "stats:preview-player-command";

function previewPlayerCommand(detail: Record<string, string | number>) {
  window.dispatchEvent(new CustomEvent(PREVIEW_PLAYER_COMMAND_EVENT, { detail }));
}

async function nativePlayerRequest(path: string, params: Record<string, string | number> = {}, timeoutMs = 5000): Promise<any> {
  if (!IOS_APP || BROWSER_PREVIEW) throw new Error("Trình phát chỉ khả dụng trong app Stats trên iPhone.");
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${NATIVE_PLAYER_ORIGIN}${path}${query.size ? `?${query}` : ""}`, { cache: "no-store", signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "Chưa điều khiển được trình phát.");
    return data;
  } finally { clearTimeout(timeout); }
}

export async function loadNativePlayerState(): Promise<NativePlayerState | null> {
  if (!IOS_APP || BROWSER_PREVIEW) return null;
  return nativePlayerRequest("/player-state", {}, 2200);
}

export function nativePlayerArtworkUrl(persistentId: string): string {
  if (BROWSER_PREVIEW) return ({
    "32179B07F18FDDA3": "https://lastfm-img.freetls.fastly.net/i/u/300x300/9be9eee88ca6c86cdad2c2cfa79898a5.jpg",
    "077656E6388A953B": "https://lastfm-img.freetls.fastly.net/i/u/300x300/d82893add7e14bef7c540172caa9daa8.jpg",
    "B1F7E02DABD4FA9E": "https://lastfm-img.freetls.fastly.net/i/u/300x300/83f551dae7f9d07225237d4fb70f98e1.png",
  } as Record<string, string>)[persistentId] || "";
  return persistentId ? `${NATIVE_PLAYER_ORIGIN}/artwork?pid=${encodeURIComponent(persistentId)}` : "";
}

export async function controlNativePlayer(action: "playpause" | "next" | "previous" | "play" | "pause" | "repeat" | "shuffle"): Promise<void> {
  if (BROWSER_PREVIEW) return previewPlayerCommand({ type: "control", action });
  await nativePlayerRequest("/control", { action });
}

export async function seekNativePlayer(position: number): Promise<void> {
  if (BROWSER_PREVIEW) return previewPlayerCommand({ type: "seek", position: Math.max(0, position) });
  await nativePlayerRequest("/seek", { position: Math.max(0, position) });
}

export async function playNativeQueueItem(index: number): Promise<void> {
  if (BROWSER_PREVIEW) return previewPlayerCommand({ type: "queue-play", index });
  await nativePlayerRequest("/queue-play", { index });
}

export async function publishWidgetTopPlaylistsInNativeApp(playlists: NativeWidgetPlaylist[]): Promise<boolean> {
  if (!IOS_APP || BROWSER_PREVIEW) return false;
  const payload = JSON.stringify(playlists.slice(0, 4));
  const params = new URLSearchParams({ payload });
  const url = `${NATIVE_PLAYER_ORIGIN}/widget-playlists?${params.toString()}`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, { method: "POST" });
      if (response.ok) return true;
    } catch {
      // The native loopback server can become ready just after the webview.
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(250 * 2 ** attempt, 1200)));
  }
  return false;
}

export async function consumeWidgetPlaylistSelectionInNativeApp(): Promise<string> {
  if (!IOS_APP || BROWSER_PREVIEW) return "";
  const response = await fetch(`${NATIVE_PLAYER_ORIGIN}/widget-playlist-selection`);
  const data = await response.json().catch(() => null);
  return response.ok ? String(data?.playlist || "") : "";
}

export async function moveNativeQueueItem(from: number, to: number): Promise<void> {
  if (BROWSER_PREVIEW) return previewPlayerCommand({ type: "queue-move", from, to });
  await nativePlayerRequest("/queue-move", { from, to });
}

export async function removeNativeQueueItem(index: number): Promise<void> {
  if (BROWSER_PREVIEW) return previewPlayerCommand({ type: "queue-remove", index });
  await nativePlayerRequest("/queue-remove", { index });
}

export async function playTrackInNativeApp(persistentId: string, action: NativeTrackAction, track: NativeTrackLookup = {}): Promise<boolean> {
  if (!IOS_APP || (!persistentId && !track.storeId)) return false;
  if (BROWSER_PREVIEW) throw new Error("Preview web không điều khiển được Apple Music; hãy thử trên iPhone.");
  const params = new URLSearchParams({ pid: persistentId, action });
  if (track.artist) params.set("artist", track.artist);
  if (track.title) params.set("title", track.title);
  if (track.album) params.set("album", track.album);
  if (track.storeId) params.set("sid", track.storeId);
  const response = await fetch(`http://127.0.0.1:8765/track-action?${params.toString()}`);
  if (!response.ok) throw new Error("Chưa điều khiển được Apple Music.");
  return true;
}

export async function addPlaylistToPebbleInNativeApp(playlistId: string): Promise<boolean> {
  return setPlaylistPebbleFavoriteInNativeApp(playlistId, true);
}

export async function setPlaylistPebbleFavoriteInNativeApp(playlistId: string, enabled: boolean): Promise<boolean> {
  if (!IOS_APP || !playlistId) return false;
  if (BROWSER_PREVIEW) throw new Error("Preview web chưa chọn được playlist Pebble; hãy thử trên iPhone.");
  const params = new URLSearchParams({ playlist: playlistId, enabled: enabled ? "1" : "0" });
  const response = await fetch(`http://127.0.0.1:8765/favorite?${params.toString()}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || (enabled ? "Chưa thêm được playlist vào Pebble." : "Chưa loại được playlist khỏi Pebble."));
  return true;
}

export async function loadPebblePlaylistFavoriteIdsInNativeApp(): Promise<Set<string> | null> {
  if (!IOS_APP || BROWSER_PREVIEW) return null;
  const response = await fetch("http://127.0.0.1:8765/all-playlists");
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data)) return null;
  const keys = new Set<string>();
  data.filter((playlist: any) => playlist?.favorite || playlist?.favourite).forEach((playlist: any) => {
    const id = String(playlist?.id || "");
    const name = String(playlist?.name || "").normalize("NFC").trim().toLocaleLowerCase("vi");
    if (id) keys.add(id);
    if (name) keys.add(`name:${name}`);
  });
  return keys;
}

export async function loadNativePlaylistLastPlayedInNativeApp(playlistId: string): Promise<Record<string, string>> {
  if (!IOS_APP || BROWSER_PREVIEW || !playlistId) return {};
  const rows = await nativePlayerRequest("/tracks", { playlist: playlistId }) as NativePlaylistTrackSummary[];
  if (!Array.isArray(rows)) return {};
  return rows.reduce<Record<string, string>>((result, row) => {
    const persistentId = String(row?.persistentID || "").replace(/^0x/i, "").toUpperCase();
    if (persistentId && row?.lastPlayed) result[persistentId] = row.lastPlayed;
    return result;
  }, {});
}

export async function openPlaylistInMusicNativeApp(playlistId: string): Promise<boolean> {
  if (!IOS_APP || !playlistId) return false;
  if (BROWSER_PREVIEW) throw new Error("Preview web chưa mở được Apple Music; hãy thử trên iPhone.");
  const params = new URLSearchParams({ playlist: playlistId });
  const response = await fetch(`http://127.0.0.1:8765/open-playlist?${params.toString()}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Chưa mở được playlist trong Apple Music.");
  return true;
}

export type NativePlaylistAction = "play" | "next";
export type NativeQueueStart = { persistentId?: string; artist?: string; title?: string };
export type NativeQueueItem = { persistentId?: string; artist?: string; title?: string; album?: string };

export async function playPlaylistInNativeApp(playlistId: string, action: NativePlaylistAction, start: NativeQueueStart = {}): Promise<boolean> {
  if (!IOS_APP || !playlistId) return false;
  if (BROWSER_PREVIEW) throw new Error("Preview web không điều khiển được Apple Music; hãy thử trên iPhone.");
  const params = new URLSearchParams({ playlist: playlistId, action });
  if (start.persistentId) params.set("track", start.persistentId);
  if (start.artist) params.set("artist", start.artist);
  if (start.title) params.set("title", start.title);
  const response = await fetch(`http://127.0.0.1:8765/play?${params.toString()}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Chưa phát được playlist trong Apple Music.");
  return true;
}

export async function playAlbumInNativeApp(artist: string, album: string, action: NativePlaylistAction, start: NativeQueueStart = {}): Promise<boolean> {
  if (!IOS_APP || !artist || !album) return false;
  if (BROWSER_PREVIEW) throw new Error("Preview web không điều khiển được Apple Music; hãy thử trên iPhone.");
  const params = new URLSearchParams({ artist, album, action });
  if (start.persistentId) params.set("track", start.persistentId);
  if (start.title) params.set("title", start.title);
  const response = await fetch(`http://127.0.0.1:8765/album-action?${params.toString()}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Chưa phát được album trong Apple Music.");
  return true;
}

export async function playSectionFromHereInNativeApp(items: NativeQueueItem[], index: number): Promise<boolean> {
  if (!IOS_APP) return false;
  if (BROWSER_PREVIEW) throw new Error("Preview web không điều khiển được Apple Music; hãy thử trên iPhone.");
  const ids=items.slice(Math.max(0,index)).map(item=>item.persistentId?.trim() || '').filter(Boolean);
  if(!ids.length)return false;
  const params=new URLSearchParams({ids:ids.join(',')});
  const response=await fetch(`http://127.0.0.1:8765/queue-action?${params.toString()}`);
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.error || 'Chưa tạo được hàng chờ từ section này.');
  return true;
}

export async function addTrackToPlaylistInNativeApp(playlistId:string, track:NativeTrackLookup):Promise<{alreadyInPlaylist:boolean}> {
  if (!IOS_APP || !playlistId) throw new Error('Chỉ thêm bài vào playlist được trên iPhone.');
  if (BROWSER_PREVIEW) throw new Error('Preview web chưa sửa được playlist Apple Music; hãy thử trên iPhone.');
  const params=new URLSearchParams({playlist:playlistId});
  if(track.storeId)params.set('sid',track.storeId);
  if(track.artist)params.set('artist',track.artist);
  if(track.title)params.set('title',track.title);
  if(track.album)params.set('album',track.album);
  const response=await fetch(`http://127.0.0.1:8765/playlist-add-track?${params.toString()}`,{method:'POST'});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.error || 'Chưa thêm được bài vào playlist.');
  return {alreadyInPlaylist:!!data?.alreadyInPlaylist};
}

export async function addTrackToLibraryInNativeApp(track: NativeTrackLookup = {}): Promise<boolean> {
  if (!IOS_APP || !track.storeId) return false;
  if (BROWSER_PREVIEW) throw new Error("Preview web chưa thêm được vào Apple Music; hãy thử trên iPhone.");
  const params = new URLSearchParams({ sid: track.storeId });
  if (track.artist) params.set("artist", track.artist);
  if (track.title) params.set("title", track.title);
  if (track.album) params.set("album", track.album);
  const response = await fetch(`http://127.0.0.1:8765/library-add?${params.toString()}`, { method: "POST" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Chưa thêm được vào Apple Music Library.");
  return true;
}

export async function syncLibraryInNativeApp(apiBase: string, apiToken: string): Promise<any | null> {
  if (!IOS_APP || BROWSER_PREVIEW) return null;
  const params = new URLSearchParams({ api: apiBase, token: apiToken });
  const response = await fetch(`http://127.0.0.1:8765/library-sync?${params.toString()}`, { method: "POST" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Không đọc được thư viện Apple Music trên iPhone.");
  return data;
}

export async function shareImageDataUrlInNativeApp(dataUrl: string, fileName = "so-nghe-nhac.png"): Promise<boolean> {
  if (!IOS_APP) return false;
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);
  if (!match) return false;
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const path = `${Date.now()}-${fileName}`;
  await Filesystem.writeFile({ path, data: match[1], directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({ title: "Sổ Nghe Nhạc", files: [uri] });
  return true;
}
