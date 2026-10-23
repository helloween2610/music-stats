import { BROWSER_PREVIEW, IOS_APP } from "@/config";
import { loadNativePlayerState, PREVIEW_PLAYER_COMMAND_EVENT, type NativeNowPlaying, type NativePlayerQueueItem, type NativePlayerState } from "@/lib/ios-bridge";

export type NativePlayerSnapshot = {
  state: NativePlayerState | null;
  loading: boolean;
  error: string;
};

const listeners = new Set<() => void>();
const previewLastPlayed = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600000).toISOString();
const previewQueue: NativePlayerQueueItem[] = [
  { id: "32179B07F18FDDA3", trackID: "TR03109", title: "Ride the White Storm", artist: "Atavistia", album: "Old Gods Awaken", year: "2026", statsLine: "63 ▲2", inLibrary: true, lastPlayed: previewLastPlayed(2), plays: 18, minutes: 126, duration: 421, current: true },
  { id: "077656E6388A953B", trackID: "TR02781", title: "Stand Ablaze", artist: "In Flames", album: "Subterranean", year: "1994", statsLine: "88 ▲86", inLibrary: true, lastPlayed: previewLastPlayed(5), plays: 41, minutes: 188, duration: 275, current: false },
  { id: "A18BD25B08D359D5", trackID: "TR02601", title: "Memento Mori 2.0 (2026 Remaster)", artist: "Aephanemer", album: "Memento Mori 2026 Remaster", year: "2026", statsLine: "185 ▼6", inLibrary: true, lastPlayed: previewLastPlayed(26), plays: 26, minutes: 198, duration: 453, current: false },
  { id: "B1F7E02DABD4FA9E", trackID: "TR03120", title: "Sleeping Sun", artist: "Nightwish", album: "Oceanborn", year: "1998", statsLine: "102 ▲14", inLibrary: true, lastPlayed: previewLastPlayed(30), plays: 33, minutes: 133, duration: 244, current: false },
  { id: "PREVIEW_MOONSHIELD", trackID: "TR02782", title: "Moonshield", artist: "In Flames", album: "The Jester Race", year: "1996", statsLine: "82 ▲88", inLibrary: true, lastPlayed: previewLastPlayed(42), plays: 17, minutes: 86, duration: 302, current: false },
  { id: "PREVIEW_EVER_DYING", trackID: "TR02783", title: "Ever Dying 2.0", artist: "In Flames", album: "Subterranean", year: "1994", statsLine: "150 ▲4", inLibrary: true, lastPlayed: previewLastPlayed(55), plays: 25, minutes: 153, duration: 366, current: false },
  { id: "PREVIEW_JESTER_RACE", trackID: "TR02784", title: "The Jester Race", artist: "In Flames", album: "The Jester Race", year: "1996", statsLine: "72 ▲19", inLibrary: true, lastPlayed: previewLastPlayed(68), plays: 19, minutes: 94, duration: 291, current: false },
  { id: "PREVIEW_RESIN", trackID: "TR02785", title: "Resin", artist: "In Flames", album: "Colony", year: "1999", statsLine: "507 ▼3", inLibrary: true, lastPlayed: previewLastPlayed(80), plays: 14, minutes: 48, duration: 202, current: false },
  { id: "PREVIEW_ARTIFACTS", trackID: "TR02786", title: "Artifacts of the Black Rain", artist: "In Flames", album: "The Jester Race", year: "1996", statsLine: "205 ▲8", inLibrary: true, lastPlayed: previewLastPlayed(96), plays: 25, minutes: 81, duration: 195, current: false },
];
const previewNowPlaying: NativeNowPlaying = {
  title: previewQueue[0].title, subtitle: previewQueue[0].artist, album: previewQueue[0].album,
  persistentID: previewQueue[0].id, trackID: previewQueue[0].trackID, year: previewQueue[0].year,
  statsLine: previewQueue[0].statsLine, inLibrary: true, plays: previewQueue[0].plays,
  minutes: previewQueue[0].minutes, duration: previewQueue[0].duration, elapsed: 85, playing: true,
};
const previewState: NativePlayerState = {
  nowPlaying: previewNowPlaying, queue: previewQueue, currentIndex: 0, queueTitle: "M01 In Flames Plt",
  queueEditable: true, repeatMode: "none", shuffleMode: "off",
};
let snapshot: NativePlayerSnapshot = { state: BROWSER_PREVIEW ? previewState : null, loading: IOS_APP, error: "" };
let pollTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let request: Promise<void> | null = null;

function publish(next: NativePlayerSnapshot) {
  snapshot = next;
  listeners.forEach(listener => listener());
}

export function nativePlayerSnapshot() {
  return snapshot;
}

export async function refreshNativePlayer(): Promise<void> {
  if (BROWSER_PREVIEW) return;
  if (!IOS_APP) return;
  if (request) return request;
  request = loadNativePlayerState()
    .then(state => publish({ state, loading: false, error: "" }))
    .catch(error => publish({
      state: snapshot.state,
      loading: false,
      error: error instanceof Error ? error.message : "Chưa đọc được trình phát.",
    }))
    .finally(() => { request = null; });
  return request;
}

function nowPlayingFromQueue(item: NativePlayerQueueItem, playing: boolean): NativeNowPlaying {
  return {
    title: item.title, subtitle: item.artist, album: item.album, persistentID: item.id, trackID: item.trackID,
    year: item.year, statsLine: item.statsLine, inLibrary: item.inLibrary, scrobbles: item.scrobbles,
    listeners: item.listeners, plays: item.plays, minutes: item.minutes, duration: item.duration, elapsed: 0, playing,
  };
}

function selectPreviewQueueItem(state: NativePlayerState, index: number) {
  const safeIndex = Math.max(0, Math.min(index, state.queue.length - 1));
  const item = state.queue[safeIndex];
  if (!item) return state;
  const queue = state.queue.map((track, itemIndex) => ({ ...track, current: itemIndex === safeIndex }));
  return { ...state, queue, currentIndex: safeIndex, nowPlaying: nowPlayingFromQueue(item, true) };
}

function handlePreviewCommand(event: Event) {
  const state = snapshot.state;
  if (!BROWSER_PREVIEW || !state) return;
  const detail = (event as CustomEvent<Record<string, string | number>>).detail || {};
  let next = state;
  if (detail.type === "control") {
    const action = String(detail.action || "");
    if (action === "playpause") next = { ...state, nowPlaying: { ...state.nowPlaying, playing: !state.nowPlaying.playing } };
    else if (action === "play" || action === "pause") next = { ...state, nowPlaying: { ...state.nowPlaying, playing: action === "play" } };
    else if (action === "next") next = selectPreviewQueueItem(state, state.currentIndex + 1 < state.queue.length ? state.currentIndex + 1 : 0);
    else if (action === "previous") next = selectPreviewQueueItem(state, state.currentIndex > 0 ? state.currentIndex - 1 : state.queue.length - 1);
    else if (action === "repeat") next = { ...state, repeatMode: state.repeatMode === "none" ? "all" : state.repeatMode === "all" ? "one" : "none" };
    else if (action === "shuffle") next = { ...state, shuffleMode: state.shuffleMode === "off" ? "songs" : "off" };
  } else if (detail.type === "seek") {
    next = { ...state, nowPlaying: { ...state.nowPlaying, elapsed: Math.min(state.nowPlaying.duration, Number(detail.position) || 0) } };
  } else if (detail.type === "queue-play") {
    next = selectPreviewQueueItem(state, Number(detail.index) || 0);
  } else if (detail.type === "queue-move") {
    const queue = [...state.queue], from = Number(detail.from), to = Number(detail.to);
    const [item] = queue.splice(from, 1);
    if (item) queue.splice(to, 0, item);
    next = { ...state, queue, currentIndex: queue.findIndex(track => track.current) };
  } else if (detail.type === "queue-remove") {
    const queue = state.queue.filter((_, index) => index !== Number(detail.index));
    next = { ...state, queue, currentIndex: queue.findIndex(track => track.current) };
  }
  publish({ state: next, loading: false, error: "" });
}

function start() {
  if ((!IOS_APP && !BROWSER_PREVIEW) || clockTimer) return;
  if (IOS_APP) {
    void refreshNativePlayer();
    pollTimer = setInterval(() => { if (!document.hidden) void refreshNativePlayer(); }, 1500);
  }
  clockTimer = setInterval(() => {
    const state = snapshot.state;
    if (!state?.nowPlaying.playing || state.nowPlaying.elapsed >= state.nowPlaying.duration) return;
    publish({ ...snapshot, state: { ...state, nowPlaying: { ...state.nowPlaying, elapsed: state.nowPlaying.elapsed + 1 } } });
  }, 1000);
  if (BROWSER_PREVIEW) window.addEventListener(PREVIEW_PLAYER_COMMAND_EVENT, handlePreviewCommand);
  else {
    window.addEventListener("focus", refreshNativePlayer);
    document.addEventListener("visibilitychange", refreshNativePlayer);
  }
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  if (clockTimer) clearInterval(clockTimer);
  pollTimer = null;
  clockTimer = null;
  window.removeEventListener(PREVIEW_PLAYER_COMMAND_EVENT, handlePreviewCommand);
  window.removeEventListener("focus", refreshNativePlayer);
  document.removeEventListener("visibilitychange", refreshNativePlayer);
}

export function subscribeNativePlayer(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stop();
  };
}
