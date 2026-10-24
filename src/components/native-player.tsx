import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  controlNativePlayer,
  moveNativeQueueItem,
  nativePlayerArtworkUrl,
  removeNativeQueueItem,
  seekNativePlayer,
  type NativePlayerQueueItem,
} from "@/lib/ios-bridge";
import { nativePlayerSnapshot, refreshNativePlayer, subscribeNativePlayer } from "@/lib/native-player";
import { ShortcutTarget, artistShortcut, useShortcutDetail, useShortcutMenu, type ShortcutEntity } from "@/components/shortcuts";
import { SongListeningMetrics } from "@/components/song-listening-metrics";
import { SongMonthlyHistoryChart } from "@/components/song-monthly-history-chart";
import { LastfmMetricValues } from "@/components/lastfm-track-metrics";
import { fmtMin, fmtWhen } from "@/lib/fmt";
import { elapsedAgeLabel, lastPlayedColor } from "@/lib/metadata";
import { getFresh } from "@/lib/api";
import type { MetaItem } from "@/lib/metadata";
import type { Ctx } from "@/vm";

const hasTrack = (title?: string) => !!title && title !== "Nothing playing";
const time = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

type PlayerIconName = "play" | "pause" | "next" | "previous" | "up" | "down" | "trash" | "close" | "queue" | "repeat" | "shuffle";

function PlayerIcon({ name }: { name: PlayerIconName }) {
  const paths: Record<PlayerIconName, ReactNode> = {
    play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
    pause: <path d="M7 5h4v14H7zM14 5h4v14h-4z" fill="currentColor" stroke="none" />,
    next: <><path d="M6 5v14l9-7z" fill="currentColor" stroke="none" /><path d="M17 5v14" /></>,
    previous: <><path d="M18 5v14l-9-7z" fill="currentColor" stroke="none" /><path d="M7 5v14" /></>,
    up: <path d="m7 14 5-5 5 5" />,
    down: <path d="m7 10 5 5 5-5" />,
    trash: <><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14" /></>,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    queue: <><path d="M4 6h12M4 11h12M4 16h8" /><path d="M18 13v7M18 13l3 1M18 20a2 2 0 1 1-2-2" /></>,
    repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
    shuffle: <><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function rankBadge(statsLine?: string) {
  const match = String(statsLine || "").match(/#?(\d+)\s*(?:(▲|\+|▼|-)\s*(\d+))?/);
  if (!match) return null;
  return { rank: match[1], change: match[3], up: match[2] === "▲" || match[2] === "+" };
}

function PlayerArtwork({ id, title, className, statsLine, ...props }: {
  id: string; title: string; className: string; statsLine?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const badge = rankBadge(statsLine);
  return <div {...props} className={className} aria-hidden={props.tabIndex == null ? true : undefined}>
    <span className="native-art-initials">{initials || "♪"}</span>
    {!failed && id && <img src={nativePlayerArtworkUrl(id)} alt="" draggable={false} onError={() => setFailed(true)} />}
    {badge && <span className="native-art-rank"><b>{badge.rank}</b>{badge.change && <small className={badge.up ? "up" : "down"}>{badge.up ? "▲" : "▼"}{badge.change}</small>}</span>}
  </div>;
}

function playerShortcut(track: {
  id: string; trackID?: string; title: string; artist: string; album: string; year?: string; duration: number;
}, queueContext?: ShortcutEntity["queueContext"]): ShortcutEntity {
  const metadata: MetaItem[] = [
    { text: time(track.duration), title: "Độ dài bài hát", tone: "gray" },
    track.year ? { text: track.year, title: "Năm phát hành", tone: "green" } : null,
  ].filter(Boolean) as MetaItem[];
  return {
    kind: "song", id: track.trackID, title: track.title, artist: track.artist, album: track.album,
    applePid: track.id, image: nativePlayerArtworkUrl(track.id), metadata, queueContext,
  };
}

function useNativeSongDetail(track?: { trackID?: string; title: string; subtitle: string }) {
  const [result, setResult] = useState<{ trackID: string; detail: any } | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    if (!track?.title || !track.subtitle) return () => { active = false; };
    void (async () => {
      let trackID = track.trackID || "";
      if (!trackID) {
        const search = await getFresh(`/library/search?q=${encodeURIComponent(track.title)}&limit=15`);
        const fold = (value: unknown) => String(value || "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("vi").trim();
        const hit = (search?.songs || []).find((song: any) => fold(song.title) === fold(track.title) && fold(song.artist) === fold(track.subtitle));
        trackID = hit?.track_id || "";
      }
      if (!trackID) return;
      const detail = await getFresh(`/song/${encodeURIComponent(trackID)}?history=v2`);
      if (active) setResult({ trackID, detail });
    })().catch(() => {});
    return () => { active = false; };
  }, [track?.trackID, track?.title, track?.subtitle]);
  return result;
}

type NativeListeningTrack = Pick<NativePlayerQueueItem, "inLibrary" | "scrobbles" | "listeners" | "plays" | "minutes" | "duration">;

function NativePlayerHistory({ detail, track }: { detail: any; track?: NativeListeningTrack }) {
  return <section className="native-player-history" aria-label="Lượt nghe và lịch sử hạng">
    {track && <div className="native-player-history-metrics"><NativeListeningMetrics track={track} /></div>}
    <SongMonthlyHistoryChart detail={detail} className="native-player-history-chart" />
  </section>;
}

function NativeListeningMetrics({ track, inline = false }: { track: NativeListeningTrack; inline?: boolean }) {
  if (track.inLibrary === false) {
    return <div className="song-metrics num native-lastfm-listening">
      <LastfmMetricValues scrobbles={track.scrobbles} listeners={track.listeners} />
    </div>;
  }
  return <SongListeningMetrics plays={`${Number(track.plays) || 0} lượt`} listening={fmtMin(Number(track.minutes) || 0)} duration={track.duration} timeFirst forceTimeFirst={inline} inline={inline} />;
}

function NativeQueueListeningStatus({ track }: { track: NativePlayerQueueItem }) {
  if (track.inLibrary !== false) {
    const lastPlayed = track.lastPlayed;
    const age = lastPlayed ? elapsedAgeLabel(lastPlayed) : "—";
    return <span className="native-queue-last-played" style={lastPlayed ? { color: lastPlayedColor(lastPlayed) } : undefined}
      title={lastPlayed ? `Lần nghe cuối: ${fmtWhen(lastPlayed)}` : "Chưa có lần nghe"}>{lastPlayed ? `▷${age}` : "—"}</span>;
  }
  return <NativeListeningMetrics track={track} inline />;
}

async function runPlayerAction(action: () => Promise<unknown>, notify: (message: string) => void) {
  try {
    await action();
    await refreshNativePlayer();
    return true;
  } catch (error) {
    notify(error instanceof Error ? error.message : "Chưa điều khiển được trình phát.");
    return false;
  }
}

export function NativeMiniPlayer({ hidden, open, notify }: { hidden?: boolean; open: () => void; notify: (message: string) => void }) {
  const { state } = useSyncExternalStore(subscribeNativePlayer, nativePlayerSnapshot, nativePlayerSnapshot);
  const now = state?.nowPlaying;
  const visible = !hidden && hasTrack(now?.title);
  useEffect(() => {
    const height = visible ? "82px" : "0px";
    document.documentElement.style.setProperty("--mini-player-h", height);
    document.body.style.setProperty("--mini-player-h", height);
    return () => {
      document.documentElement.style.setProperty("--mini-player-h", "0px");
      document.body.style.setProperty("--mini-player-h", "0px");
    };
  }, [visible]);
  if (!visible || !now) return null;
  const progress = now.duration > 0 ? Math.min(100, now.elapsed / now.duration * 100) : 0;
  const total = state?.queue.length ?? 0;
  const currentIndex = state?.currentIndex ?? -1;
  const remaining = total ? Math.max(0, total - (currentIndex >= 0 ? currentIndex + 1 : 0)) : 0;
  const shortcut = playerShortcut({ id: now.persistentID, trackID: now.trackID, title: now.title, artist: now.subtitle, album: now.album, year: now.year, duration: now.duration });
  return <div className="native-mini-player" role="group" aria-label="Bài đang phát">
    <ShortcutTarget entity={shortcut}><button type="button" className="native-mini-main" onClick={open} aria-label={`Menu bài hát: ${now.title}. Chạm hai lần để mở Đang phát`}>
      <PlayerArtwork id={now.persistentID} title={now.title} statsLine={now.inLibrary === false ? undefined : now.statsLine} className="native-mini-art" />
      <span className="native-mini-copy">
        <span className="ell">{now.subtitle}</span>
        <strong><span className="native-mini-title">{now.title}</span><small>{time(now.duration)}</small></strong>
        <span className="native-mini-bottom">
          <span className="native-mini-album-line">
            {now.album && <span className="native-mini-album ell">{now.album}</span>}
            {now.year && <span className="native-mini-year">{now.year}</span>}
            {total > 0 && <span className="native-mini-queue-count" aria-label={`${remaining} bài còn lại trong tổng số ${total} bài`}>{remaining}/{total}<b aria-hidden="true">♪</b></span>}
          </span>
        </span>
      </span>
    </button></ShortcutTarget>
    <button type="button" className="native-mini-control" aria-label="Bài trước"
      onClick={() => void runPlayerAction(() => controlNativePlayer("previous"), notify)}><PlayerIcon name="previous" /></button>
    <button type="button" className="native-mini-control" aria-label={now.playing ? "Tạm dừng" : "Phát"}
      onClick={() => void runPlayerAction(() => controlNativePlayer("playpause"), notify)}><PlayerIcon name={now.playing ? "pause" : "play"} /></button>
    <button type="button" className="native-mini-control" aria-label="Bài tiếp theo"
      onClick={() => void runPlayerAction(() => controlNativePlayer("next"), notify)}><PlayerIcon name="next" /></button>
    <span className="native-mini-progress" style={{ "--player-progress": `${progress}%` } as CSSProperties} />
  </div>;
}

export function NativeAppBackdrop() {
  const artworkID=useSyncExternalStore(subscribeNativePlayer, backdropArtworkID, backdropArtworkID);
  if (!artworkID) return null;
  const artwork = nativePlayerArtworkUrl(artworkID);
  return <div className="native-app-backdrop" aria-hidden="true">
    <img key={artwork} src={artwork} alt="" />
  </div>;
}

function backdropArtworkID() {
  const now=nativePlayerSnapshot().state?.nowPlaying;
  return now && hasTrack(now.title)?now.persistentID:'';
}

type QueueDragPreview = { from: number; target: number; mode: "move" | "remove" } | null;
const QUEUE_ROW_HEIGHT = 66;

function QueueRow({ item, queue, index, busy, editable, shiftY, onPreview, onMove, onRemove }: {
  item: NativePlayerQueueItem; queue: NativePlayerQueueItem[]; index: number; busy: boolean;
  editable: boolean; shiftY: number;
  onPreview: (preview: QueueDragPreview) => void;
  onMove: (to: number) => void; onRemove: () => void;
}) {
  const count = queue.length;
  const currentIndex = queue.findIndex(track => track.current);
  const firstMovableIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  const openShortcut = useShortcutMenu();
  const openShortcutDetail = useShortcutDetail();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const tapTimer = useRef<ReturnType<typeof setTimeout>>();
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>();
  const recoveryTimer = useRef<ReturnType<typeof setTimeout>>();
  const frame = useRef<number>();
  const skipClick = useRef(false);
  const settling = useRef(false);
  const gesture = useRef({ tracking: false, active: false, mode: "none" as "none" | "move" | "remove", x: 0, y: 0, dx: 0, dy: 0, target: index });
  const pointerMoveHandler = useRef<(event: globalThis.PointerEvent) => void>(() => {});
  const pointerUpHandler = useRef<() => void>(() => {});
  const resetHandler = useRef<() => void>(() => {});
  const [drag, setDrag] = useState({ active: false, mode: "none" as "none" | "move" | "remove", dx: 0, dy: 0, target: index });
  useEffect(() => () => {
    clearTimeout(timer.current);
    clearTimeout(tapTimer.current);
    clearTimeout(dismissTimer.current);
    clearTimeout(recoveryTimer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
  }, []);
  const reset = () => {
    clearTimeout(timer.current);
    clearTimeout(tapTimer.current);
    tapTimer.current = undefined;
    clearTimeout(dismissTimer.current);
    clearTimeout(recoveryTimer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    gesture.current.tracking = false;
    gesture.current.active = false;
    gesture.current.mode = "none";
    settling.current = false;
    onPreview(null);
    setDrag({ active: false, mode: "none", dx: 0, dy: 0, target: index });
  };
  const paintDrag = (next: { active: boolean; mode: "none" | "move" | "remove"; dx: number; dy: number; target: number }) => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      setDrag(next);
    });
  };
  const menu = () => openShortcut?.(playerShortcut({ ...item, trackID: item.trackID }, {
    kind: "section",
    items: queue.map(track => ({ persistentId: track.id, artist: track.artist, title: track.title, album: track.album })),
    index,
  }));
  const detail = () => openShortcutDetail?.(playerShortcut({ ...item, trackID: item.trackID }));
  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (busy || settling.current || !event.isPrimary || event.button !== 0) return;
    gesture.current = { tracking: true, active: false, mode: "none", x: event.clientX, y: event.clientY, dx: 0, dy: 0, target: index };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      gesture.current.active = true;
      skipClick.current = true;
      setDrag({ active: true, mode: "none", dx: 0, dy: 0, target: index });
    }, 520);
  };
  const pointerMove = (event: globalThis.PointerEvent) => {
    const current = gesture.current;
    if (!current.tracking) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.active) {
      if (editable && dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        clearTimeout(timer.current);
        current.active = true;
        current.mode = "remove";
        skipClick.current = true;
        onPreview({ from: index, target: index, mode: "remove" });
      } else {
        if (Math.hypot(dx, dy) > 10) clearTimeout(timer.current);
        return;
      }
    }
    event.preventDefault();
    current.dx = dx; current.dy = dy;
    if (!editable) return;
    if (current.mode === "none") {
      if (dx < -18 && Math.abs(dx) > Math.abs(dy)) {
        current.mode = "remove";
        onPreview({ from: index, target: index, mode: "remove" });
      } else if (Math.abs(dy) > 18) {
        current.mode = "move";
        onPreview({ from: index, target: index, mode: "move" });
      }
    }
    if (current.mode === "remove") {
      const offset = Math.max(-Math.min(320, window.innerWidth * .72), Math.min(0, dx));
      paintDrag({ active: true, mode: "remove", dx: offset, dy: 0, target: index });
    } else if (current.mode === "move") {
      const distance = Math.abs(dy);
      const rowOffset = distance < 46 ? 0 : 1 + Math.floor((distance - 46) / QUEUE_ROW_HEIGHT);
      const target = Math.max(firstMovableIndex, Math.min(count - 1, index + Math.sign(dy) * rowOffset));
      if (target !== current.target) {
        current.target = target;
        onPreview({ from: index, target, mode: "move" });
      }
      paintDrag({ active: true, mode: "move", dx: 0, dy, target: current.target });
    }
  };
  const pointerUp = () => {
    if (!gesture.current.tracking) return;
    clearTimeout(timer.current);
    const current = gesture.current;
    if (!current.active) return;
    skipClick.current = true;
    if (current.mode === "remove" && current.dx <= -Math.min(96, window.innerWidth * .24)) {
      settling.current = true;
      gesture.current.tracking = false;
      gesture.current.active = false;
      onPreview(null);
      setDrag({ active: false, mode: "remove", dx: -window.innerWidth, dy: 0, target: index });
      dismissTimer.current = setTimeout(onRemove, 150);
      recoveryTimer.current = setTimeout(reset, 900);
      return;
    } else if (current.mode === "move" && current.target !== index) {
      const target = current.target;
      settling.current = true;
      gesture.current.tracking = false;
      gesture.current.active = false;
      onMove(target);
      reset();
      return;
    }
    else if (current.mode === "none") menu();
    reset();
  };
  pointerMoveHandler.current = pointerMove;
  pointerUpHandler.current = pointerUp;
  resetHandler.current = reset;
  useEffect(() => {
    const touchMove = (event: globalThis.TouchEvent) => {
      if (gesture.current.active) event.preventDefault();
    };
    const pointerMoveListener = (event: globalThis.PointerEvent) => pointerMoveHandler.current(event);
    const pointerUpListener = () => pointerUpHandler.current();
    const pointerCancel = () => resetHandler.current();
    window.addEventListener("pointermove", pointerMoveListener, { passive: false });
    window.addEventListener("pointerup", pointerUpListener);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", pointerMoveListener);
      window.removeEventListener("pointerup", pointerUpListener);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("touchmove", touchMove);
    };
  }, []);
  const rowStyle = { "--queue-drag-x": `${drag.dx}px`, "--queue-drag-y": `${drag.mode === "move" ? drag.dy : 0}px`, "--queue-shift-y": `${shiftY}px` } as CSSProperties;
  return <div className={`native-queue-row${item.current ? " current" : ""}${shiftY ? " shifting" : ""}${drag.active ? " gesture-active" : ""}${drag.mode === "remove" ? " swiping" : ""}${drag.mode === "move" ? " moving" : ""}`}
    style={rowStyle}>
    <span className="native-queue-delete-cue" aria-hidden="true"><PlayerIcon name="trash" /></span>
    <button type="button" className="native-queue-play" onClick={event => {
      event.preventDefault();
      event.stopPropagation();
      if (skipClick.current) { skipClick.current = false; return; }
      if (tapTimer.current) {
        clearTimeout(tapTimer.current);
        tapTimer.current = undefined;
        detail();
      } else {
        tapTimer.current = setTimeout(() => {
          tapTimer.current = undefined;
          menu();
        }, 300);
      }
    }} onPointerDown={pointerDown}
    onContextMenu={event => {
      clearTimeout(tapTimer.current);
      tapTimer.current = undefined;
      event.preventDefault();
      if (gesture.current.tracking) return;
      skipClick.current = true;
      menu();
    }}
    disabled={busy} aria-label={`Chạm để mở menu, chạm hai lần để mở chi tiết: ${item.title}`}>
      <PlayerArtwork id={item.id} title={item.title} statsLine={item.statsLine} className="native-queue-art" />
      <span className="native-queue-copy">
        <strong className="ell">{item.title} <small>{time(item.duration)}</small></strong>
        <span className="ell">{item.artist}{item.year ? ` ${item.year}` : ""}</span>
      </span>
      <span className="native-queue-status"><NativeQueueListeningStatus track={item} /></span>
    </button>
  </div>;
}

export function NowPlayingScreen({ c }: { c: Ctx }) {
  const snapshot = useSyncExternalStore(subscribeNativePlayer, nativePlayerSnapshot, nativePlayerSnapshot);
  const state = snapshot.state;
  const now = state?.nowPlaying;
  const songDetail = useNativeSongDetail(now);
  const [busy, setBusy] = useState(false);
  const [seek, setSeek] = useState<number | null>(null);
  const [queueDragPreview, setQueueDragPreview] = useState<QueueDragPreview>(null);
  const [optimisticQueue, setOptimisticQueue] = useState<NativePlayerQueueItem[] | null>(null);
  const [dismissOffset, setDismissOffset] = useState(0);
  const [dismissSettling, setDismissSettling] = useState(false);
  const optimisticTimer = useRef<ReturnType<typeof setTimeout>>();
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>();
  const playerScroll = useRef<HTMLDivElement>(null);
  const dismissGesture = useRef({ tracking: false, active: false, x: 0, y: 0, lastY: 0, startedAt: 0 });
  const close = () => c.back();
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => setSeek(null), [now?.persistentID]);
  useEffect(() => {
    const timer = setTimeout(() => void refreshNativePlayer(), 550);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => () => {
    clearTimeout(optimisticTimer.current);
    clearTimeout(dismissTimer.current);
  }, []);
  const beginDismiss = (x: number, y: number) => {
    if ((playerScroll.current?.scrollTop || 0) > 1 || dismissSettling) return;
    dismissGesture.current = { tracking: true, active: false, x, y, lastY: y, startedAt: performance.now() };
  };
  const moveDismiss = (x: number, y: number, preventDefault: () => void) => {
    const gesture = dismissGesture.current;
    if (!gesture.tracking) return;
    const dx = x - gesture.x, dy = y - gesture.y;
    gesture.lastY = y;
    if (!gesture.active) {
      if (Math.abs(dx) > Math.max(10, dy)) { gesture.tracking = false; return; }
      if (dy <= 8) return;
      gesture.active = true;
    }
    if (dy <= 0) { gesture.tracking = false; gesture.active = false; setDismissOffset(0); return; }
    preventDefault();
    setDismissOffset(Math.min(window.innerHeight, dy * .86));
  };
  const finishDismiss = () => {
    const gesture = dismissGesture.current;
    if (!gesture.tracking) return;
    const distance = Math.max(0, gesture.lastY - gesture.y);
    const velocity = distance / Math.max(1, performance.now() - gesture.startedAt);
    const shouldClose = gesture.active && (distance >= 110 || (distance >= 52 && velocity > .62));
    gesture.tracking = false;
    gesture.active = false;
    setDismissSettling(true);
    clearTimeout(dismissTimer.current);
    if (shouldClose) {
      setDismissOffset(window.innerHeight);
      dismissTimer.current = setTimeout(() => closeRef.current(), 210);
    } else {
      setDismissOffset(0);
      dismissTimer.current = setTimeout(() => setDismissSettling(false), 220);
    }
  };
  useEffect(() => {
    const element = playerScroll.current;
    if (!element || !state) return;
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      beginDismiss(event.touches[0].clientX, event.touches[0].clientY);
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      moveDismiss(event.touches[0].clientX, event.touches[0].clientY, () => event.preventDefault());
    };
    const touchEnd = () => finishDismiss();
    element.addEventListener("touchstart", touchStart, { passive: true });
    element.addEventListener("touchmove", touchMove, { passive: false });
    element.addEventListener("touchend", touchEnd);
    element.addEventListener("touchcancel", touchEnd);
    return () => {
      element.removeEventListener("touchstart", touchStart);
      element.removeEventListener("touchmove", touchMove);
      element.removeEventListener("touchend", touchEnd);
      element.removeEventListener("touchcancel", touchEnd);
    };
  }, [!!state, dismissSettling]);
  const queueKey = (queue: NativePlayerQueueItem[]) => queue.map(item => `${item.id}:${item.current ? 1 : 0}`).join("\u001f");
  const queueItemKey = (queue: NativePlayerQueueItem[], index: number) => {
    const id = queue[index]?.id || "queue-item";
    let occurrence = 0;
    for (let itemIndex = 0; itemIndex <= index; itemIndex += 1) {
      if (queue[itemIndex]?.id === id) occurrence += 1;
    }
    return `${id}:${occurrence}`;
  };
  useEffect(() => {
    if (!optimisticQueue || !state || queueKey(optimisticQueue) !== queueKey(state.queue)) return;
    clearTimeout(optimisticTimer.current);
    setOptimisticQueue(null);
  }, [optimisticQueue, state]);
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    const succeeded = await runPlayerAction(action, c.ptoast);
    setBusy(false);
    return succeeded;
  };
  if (snapshot.loading && !state) return <div className="native-player-empty"><div className="spinner" /><span>Đang đọc trình phát…</span></div>;
  if (!now || !hasTrack(now.title) || !state) return <div className="native-player-empty"><button type="button" className="native-player-empty-close" onClick={close} aria-label="Đóng"><PlayerIcon name="close" /></button><div className="native-player-empty-icon">♪</div><strong>Chưa có bài đang phát</strong><span>Phát một bài, album hoặc playlist để bắt đầu.</span>{snapshot.error && <button type="button" onClick={() => void refreshNativePlayer()}>Thử lại</button>}</div>;
  const elapsed = seek ?? now.elapsed;
  const artwork = nativePlayerArtworkUrl(now.persistentID);
  const progress = now.duration > 0 ? Math.min(100, elapsed / now.duration * 100) : 0;
  const showListening = now.inLibrary === false || Number(now.plays) > 0 || Number(now.minutes) > 0;
  const shortcut = playerShortcut({ id: now.persistentID, trackID: songDetail?.trackID || now.trackID, title: now.title, artist: now.subtitle, album: now.album, year: now.year, duration: now.duration });
  const visibleQueue = optimisticQueue || state.queue;
  const keepOptimisticQueue = (next: NativePlayerQueueItem[]) => {
    clearTimeout(optimisticTimer.current);
    setOptimisticQueue(next);
    optimisticTimer.current = setTimeout(() => setOptimisticQueue(null), 4000);
  };
  const moveQueueItem = (from: number, to: number) => {
    const next = [...visibleQueue];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setQueueDragPreview(null);
    keepOptimisticQueue(next);
    void act(() => moveNativeQueueItem(from, to)).then(succeeded => {
      if (!succeeded) setOptimisticQueue(null);
      else setTimeout(() => void refreshNativePlayer(), 180);
    });
  };
  const removeQueueItem = (index: number) => {
    setQueueDragPreview(null);
    keepOptimisticQueue(visibleQueue.filter((_, itemIndex) => itemIndex !== index));
    void act(() => removeNativeQueueItem(index)).then(succeeded => {
      if (!succeeded) setOptimisticQueue(null);
      else setTimeout(() => void refreshNativePlayer(), 180);
    });
  };
  const queueShift = (index: number) => {
    if (!queueDragPreview || queueDragPreview.mode !== "move" || index === queueDragPreview.from) return 0;
    if (queueDragPreview.from < queueDragPreview.target && index > queueDragPreview.from && index <= queueDragPreview.target) return -QUEUE_ROW_HEIGHT;
    if (queueDragPreview.from > queueDragPreview.target && index >= queueDragPreview.target && index < queueDragPreview.from) return QUEUE_ROW_HEIGHT;
    return 0;
  };
  return <div className={`native-player-page${dismissOffset > 0 ? " dismiss-dragging" : ""}${dismissSettling ? " dismiss-settling" : ""}`}
    style={{ "--player-dismiss-y": `${dismissOffset}px` } as CSSProperties}>
    <div className="native-player-backdrop" aria-hidden="true"><img src={artwork} alt="" /></div>
    <div ref={playerScroll} className="native-player-scroll"
      onPointerDown={event => {
        if (event.pointerType !== "mouse" || !event.isPrimary || event.button !== 0) return;
        beginDismiss(event.clientX, event.clientY);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (event.pointerType === "mouse") moveDismiss(event.clientX, event.clientY, () => event.preventDefault());
      }}
      onPointerUp={event => { if (event.pointerType === "mouse") finishDismiss(); }}
      onPointerCancel={event => { if (event.pointerType === "mouse") finishDismiss(); }}>
      <main className="native-now-playing" aria-label="Đang phát">
      <ShortcutTarget entity={shortcut}><PlayerArtwork id={now.persistentID} title={now.title} statsLine={now.inLibrary === false ? undefined : now.statsLine} className="native-player-cover" aria-label={`Mở menu bài hát: ${now.title}`} /></ShortcutTarget>
      <div className="native-player-scrubber" style={{ "--seek-progress": `${progress}%` } as CSSProperties}>
        <input type="range" min="0" max={Math.max(now.duration, 1)} step="1" value={Math.min(elapsed, Math.max(now.duration, 1))}
          aria-label="Vị trí phát" onChange={event => setSeek(Number(event.currentTarget.value))}
          onPointerUp={() => { if (seek !== null) void act(() => seekNativePlayer(seek)).then(() => setSeek(null)); }}
          onKeyUp={event => { if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && seek !== null) void act(() => seekNativePlayer(seek)).then(() => setSeek(null)); }} />
        <div><span>{time(elapsed)}</span><span>-{time(Math.max(0, now.duration - elapsed))}</span></div>
      </div>
      <div className="native-player-meta">
        <h1>{now.title}</h1>
        <div className="native-player-artist-line"><ShortcutTarget entity={artistShortcut({ name: now.subtitle, onTap: () => c.go("artist", now.subtitle) })}><button type="button" onClick={() => c.go("artist", now.subtitle)}>{now.subtitle}</button></ShortcutTarget>{now.year && <span>{now.year}</span>}</div>
        {showListening && !songDetail?.detail && <div className="native-player-listening">
          <NativeListeningMetrics track={now} />
        </div>}
      </div>
      {songDetail?.detail && <NativePlayerHistory detail={songDetail.detail} track={showListening ? now : undefined} />}
      <div className="native-player-controls">
        <button type="button" className={`mode${state.repeatMode !== "none" ? " active" : ""}`} onClick={() => void act(() => controlNativePlayer("repeat"))} disabled={busy} aria-label="Chế độ lặp"><PlayerIcon name="repeat" />{state.repeatMode === "one" && <span>1</span>}</button>
        <button type="button" onClick={() => void act(() => controlNativePlayer("previous"))} disabled={busy} aria-label="Bài trước"><PlayerIcon name="previous" /></button>
        <button type="button" className="primary" onClick={() => void act(() => controlNativePlayer("playpause"))} disabled={busy} aria-label={now.playing ? "Tạm dừng" : "Phát"}><PlayerIcon name={now.playing ? "pause" : "play"} /></button>
        <button type="button" onClick={() => void act(() => controlNativePlayer("next"))} disabled={busy} aria-label="Bài tiếp theo"><PlayerIcon name="next" /></button>
        <button type="button" className={`mode${state.shuffleMode !== "off" ? " active" : ""}`} onClick={() => void act(() => controlNativePlayer("shuffle"))} disabled={busy} aria-label="Phát ngẫu nhiên"><PlayerIcon name="shuffle" /></button>
      </div>
    </main>
    {(state.queueEditable ? visibleQueue.length > 0 : visibleQueue.length > 1) && <main className="native-queue-section" aria-label="Hàng chờ">
      <div className="native-queue-heading"><p>Từ {state.queueTitle || "Hàng chờ"} · {visibleQueue.length} bài</p></div>
      <div className="native-queue-list">
        {visibleQueue.map((item, index) => <QueueRow key={queueItemKey(visibleQueue, index)} item={item} queue={visibleQueue} index={index} busy={busy || !!optimisticQueue} editable={state.queueEditable && !item.current}
          shiftY={queueShift(index)} onPreview={setQueueDragPreview}
          onMove={to => moveQueueItem(index, to)}
          onRemove={() => removeQueueItem(index)} />)}
      </div>
    </main>}
    </div>
  </div>;
}
