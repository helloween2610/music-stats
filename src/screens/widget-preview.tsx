import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { controlNativePlayer, nativePlayerArtworkUrl, playNativeQueueItem, playPlaylistInNativeApp } from "@/lib/ios-bridge";
import { nativePlayerSnapshot, subscribeNativePlayer } from "@/lib/native-player";
import { elapsedAgeLabel, lastPlayedColor } from "@/lib/metadata";
import { fmtWhen } from "@/lib/fmt";
import { buildPlaylistPeriodRows, loadPlaylistSnapshot, readPlaylistRankExcludes, type Playlist, type PlaylistSnapshot } from "@/lib/playlists";
import type { Ctx, VM } from "@/vm";

type PreviewSize = "small" | "medium" | "large" | "all";
type PreviewPlaylist = { playlist: Playlist; rank: number; plays: number; trackCount: number; hue: number };

const duration = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
const trackDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;
const rankText = (value: string) => value && !value.startsWith("#") ? `#${value}` : value;

function PlayerGlyph({ playing }: { playing: boolean }) {
  return playing ? <span className="widget-preview-pause" aria-hidden="true"><i/><i/></span>
    : <span className="widget-preview-play" aria-hidden="true"/>;
}

function RepeatGlyph({ mode }: { mode: "none" | "all" | "one" }) {
  return <span className={`widget-preview-repeat${mode !== "none" ? " active" : ""}`} aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h18M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/></svg>
    {mode === "one" && <b>1</b>}
  </span>;
}

function Artwork({ id }: { id: string }) {
  const source = nativePlayerArtworkUrl(id);
  return <div className="widget-preview-artwork">
    <span className="widget-preview-waveform" aria-hidden="true"><i/><i/><i/><i/><i/></span>
    {source && <img key={source} src={source} alt="" />}
  </div>;
}

function RankedArtwork({ id, statsLine }: { id: string; statsLine: string }) {
  const normalized = rankText(statsLine).replace(/^#/, "");
  const [rank = "", change = ""] = normalized.split(/\s+/, 2);
  return <div className="widget-preview-ranked-artwork">
    <Artwork id={id}/>
    {rank && <span className="widget-preview-artwork-rank"><b>{rank}</b>{change && <small className={change.startsWith("▼") ? "down" : "up"}>{change}</small>}</span>}
  </div>;
}

function SmallWidget({ state }: { state: NonNullable<ReturnType<typeof nativePlayerSnapshot>["state"]> }) {
  const song = state.nowPlaying;
  return <article className="widget-preview-widget widget-preview-small" aria-label={`Widget nhỏ: ${song.title}`}>
    <div className="widget-preview-small-top">
      <Artwork id={song.persistentID}/>
      <div className="widget-preview-small-status">
        <PlayerGlyph playing={song.playing}/>
        {song.statsLine && <b>{rankText(song.statsLine)}</b>}
      </div>
    </div>
    <div className="widget-preview-small-copy">
      <strong>{song.title}</strong>
      <span>{song.subtitle}</span>
    </div>
    <div className="widget-preview-metrics">
      <b>{song.plays || 0}x</b>
      <b>{duration(song.minutes || 0)}</b>
      <span>{state.queue.length ? `${state.currentIndex + 1}/${state.queue.length}` : ""}</span>
    </div>
  </article>;
}

function MediumWidget({ playlists, open, play }: { playlists: PreviewPlaylist[]; open: (playlist: Playlist) => void; play: (playlist: Playlist) => void }) {
  return <article className="widget-preview-widget widget-preview-medium" aria-label="Widget vừa: Top playlist 15 ngày">
    <strong className="widget-preview-medium-title">TOP PLAYLIST · 15 NGÀY</strong>
    <div className="widget-preview-medium-grid">
      {playlists.map(item=><div className="widget-preview-playlist" key={item.playlist.id} style={{background:`hsl(${item.hue} 26% 20%)`}}>
        <button className="widget-preview-playlist-open" type="button" onClick={()=>open(item.playlist)} aria-label={`Mở ${item.playlist.name}`}>
          <strong>{item.playlist.name}</strong>
          <small>{item.trackCount} bài</small>
        </button>
        <button className="widget-preview-playlist-play" type="button" onClick={()=>play(item.playlist)} aria-label={`Phát ${item.playlist.name}`} title={`Phát ${item.playlist.name}`}>
          <PlayerGlyph playing={false}/>
        </button>
      </div>)}
      {!playlists.length&&<span className="widget-preview-medium-empty">Đang tải playlist…</span>}
    </div>
  </article>;
}

function LargeWidget({ state }: { state: NonNullable<ReturnType<typeof nativePlayerSnapshot>["state"]> }) {
  const song = state.nowPlaying;
  const progress = song.duration > 0 ? Math.min(100, Math.max(0, song.elapsed / song.duration * 100)) : 0;
  const remainingSeconds = Math.max(0, song.duration - song.elapsed)
    + state.queue.slice(state.currentIndex + 1).reduce((total, item) => total + Math.max(0, item.duration || 0), 0);
  const allUpcoming = state.queue.slice(state.currentIndex + 1, state.currentIndex + 41);
  const [queuePage, setQueuePage] = useState(0);
  const maxPage = Math.max(0, Math.ceil(allUpcoming.length / 4) - 1);
  const page = Math.min(queuePage, maxPage);
  const upcoming = allUpcoming.slice(page * 4, page * 4 + 4);
  useEffect(() => setQueuePage(0), [state.currentIndex]);
  return <article className="widget-preview-widget widget-preview-large" aria-label={`Widget to: ${song.title}`}>
    <div className="widget-preview-large-now">
      <RankedArtwork id={song.persistentID} statsLine={song.statsLine}/>
      <div className="widget-preview-large-copy">
        <strong>{song.title}</strong>
        <span>{[song.subtitle, song.year].filter(Boolean).join(" ")}</span>
        {state.queue.length > 0 && <span className="widget-preview-large-position">{state.currentIndex + 1}/{state.queue.length}♪ <b>{duration(Math.ceil(remainingSeconds / 60))}</b></span>}
      </div>
      <div className="widget-preview-large-controls">
        <div className="widget-preview-large-primary-controls">
          <button type="button" className="widget-preview-large-repeat" aria-label="Chế độ lặp" title="Chế độ lặp" onClick={() => void controlNativePlayer("repeat")}><RepeatGlyph mode={state.repeatMode}/></button>
          <button type="button" className="widget-preview-large-play" aria-label={song.playing ? "Tạm dừng" : "Phát"} title={song.playing ? "Tạm dừng" : "Phát"} onClick={() => void controlNativePlayer("playpause")}>
            <PlayerGlyph playing={song.playing}/>
          </button>
        </div>
        {maxPage > 0 && <div className="widget-preview-large-pager">
          <button type="button" aria-label="Trang queue trước" disabled={page === 0} onClick={() => setQueuePage(value => Math.max(0, value - 1))}>⌃</button>
          <button type="button" aria-label="Trang queue tiếp theo" disabled={page === maxPage} onClick={() => setQueuePage(value => Math.min(maxPage, value + 1))}>⌄</button>
        </div>}
      </div>
      {song.duration > 0 && <span className="widget-preview-large-progress" aria-label={`Đã phát ${trackDuration(song.elapsed)} trên ${trackDuration(song.duration)}`}>
        <i style={{width:`${progress}%`}}/>
      </span>}
    </div>
    <div className="widget-preview-large-queue">
      {upcoming.map((item, offset) => {
        const steps = page * 4 + offset + 1;
        const lastPlayed = item.lastPlayed;
        return <button type="button" className="widget-preview-large-row" key={`${item.id}-${offset}`} aria-label={`Phát ${item.title}`} onClick={() => void playNativeQueueItem(state.currentIndex + steps)}>
        <span>{state.currentIndex + steps + 1}</span>
        <div className="widget-preview-large-row-copy"><div><strong>{item.title}</strong><small>{trackDuration(item.duration || 0)}</small></div><small>{[item.artist, item.year].filter(Boolean).join(" ")}</small></div>
        <small className="widget-preview-large-row-last-played" style={lastPlayed ? { color: lastPlayedColor(lastPlayed) } : undefined}
          title={lastPlayed ? `Lần nghe cuối: ${fmtWhen(lastPlayed)}` : "Chưa có lần nghe"}>{lastPlayed ? `▷${elapsedAgeLabel(lastPlayed)}` : "—"}</small>
      </button>})}
      {!upcoming.length && <div className="widget-preview-large-empty">Đã hết queue</div>}
    </div>
  </article>;
}

function usePreviewTopPlaylists(vm: VM) {
  const [snapshot,setSnapshot]=useState<PlaylistSnapshot|null>(null);
  useEffect(()=>{
    let active=true;
    void loadPlaylistSnapshot().then(value=>{if(active)setSnapshot(value);}).catch(()=>{});
    return()=>{active=false;};
  },[]);
  const rankLibrary=vm.nowPlayingLibrary?.length ? vm.nowPlayingLibrary : vm.playlistLibrary;
  return useMemo<PreviewPlaylist[]>(()=>{
    if(!snapshot)return [];
    const playlistById=new Map(snapshot.playlists.map(playlist=>[playlist.id,playlist]));
    return buildPlaylistPeriodRows(snapshot,rankLibrary,vm.todayPlaylistRows || [],4,readPlaylistRankExcludes()).flatMap(row=>{
      const playlist=playlistById.get(row.id);
      return playlist?[{playlist,rank:row.rank,plays:Math.max(0,Math.round(row.score)),trackCount:row.trackCount,hue:row.hue}]:[];
    });
  },[snapshot,rankLibrary,vm.todayPlaylistRows]);
}

function ControlIcon({ name }: { name: "back" | "previous" | "next" }) {
  if (name === "back") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>;
  if (name === "previous") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M19 6l-9 6 9 6z"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 5v14M5 6l9 6-9 6z"/></svg>;
}

export function WidgetPreviewScreen({ c, vm }: { c: Ctx; vm: VM }) {
  const { state } = useSyncExternalStore(subscribeNativePlayer, nativePlayerSnapshot, nativePlayerSnapshot);
  const [size, setSize] = useState<PreviewSize>("all");
  const topPlaylists=usePreviewTopPlaylists(vm);
  if (!state) return <main className="widget-preview-page" aria-busy="true"/>;
  const close = () => {
    window.history.replaceState(null, "", window.location.pathname);
    c.go("today");
  };
  return <><main className="widget-preview-page">
    <header className="widget-preview-toolbar">
      <button type="button" aria-label="Quay lại" title="Quay lại" onClick={close}><ControlIcon name="back"/></button>
      <strong>Widget iPhone</strong>
      <div>
        <button type="button" aria-label="Bài trước" title="Bài trước" onClick={() => void controlNativePlayer("previous")}><ControlIcon name="previous"/></button>
        <button type="button" aria-label={state.nowPlaying.playing ? "Tạm dừng" : "Phát"} title={state.nowPlaying.playing ? "Tạm dừng" : "Phát"} onClick={() => void controlNativePlayer("playpause")}><PlayerGlyph playing={state.nowPlaying.playing}/></button>
        <button type="button" aria-label="Bài tiếp theo" title="Bài tiếp theo" onClick={() => void controlNativePlayer("next")}><ControlIcon name="next"/></button>
      </div>
    </header>

    <div className="widget-preview-segments" role="tablist" aria-label="Kích thước widget">
      {([['small', 'Nhỏ'], ['medium', 'Vừa'], ['large', 'To'], ['all', 'Tất cả']] as const).map(([value, label]) =>
        <button key={value} type="button" role="tab" aria-selected={size === value} className={size === value ? "active" : ""} onClick={() => setSize(value)}>{label}</button>
      )}
    </div>

    <section className={`widget-preview-home show-${size}`} aria-label="Màn hình chính iPhone">
      <div className="widget-preview-statusbar"><b>9:41</b><span>5G&nbsp;&nbsp;▰</span></div>
      <div className="widget-preview-date"><span>THỨ TƯ, 21 THÁNG 10</span><strong>21</strong></div>
      <div className="widget-preview-canvas">
        {(size === "small" || size === "all") && <SmallWidget state={state}/>}
        {(size === "medium" || size === "all") && <MediumWidget playlists={topPlaylists} open={playlist=>c.go("playlist",playlist.id)} play={playlist=>void playPlaylistInNativeApp(playlist.id,"play")}/>}
        {(size === "large" || size === "all") && <LargeWidget state={state}/>}
      </div>
      <div className="widget-preview-dock" aria-hidden="true"><i/><i/><i/><i/></div>
    </section>
  </main></>;
}
