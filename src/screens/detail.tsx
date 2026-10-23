import { ReleaseExclusionSettings } from '@/components/release-exclusion-settings';
import { LastfmScrobbleRefreshButton, LastfmTrackMetrics } from '@/components/lastfm-track-metrics';
import { ShortcutTarget, songShortcut, artistShortcut, albumShortcut } from '@/components/shortcuts';
import { AlbumGrid } from '@/components/album-grid';
import {PERIOD_LIST_OPTIONS, savePeriodListSize} from "@/lib/list-preferences";
import { DEFAULT_PLAYLIST_KEYWORDS, loadPlaylistSnapshot, readPlaylistKeywordRules, resetPlaylistKeywordRules, savePlaylistKeywordRules, syncPlaylistRankingSettings, type PlaylistKeywordRule } from '@/lib/playlists';
import { addTrackToPlaylistInNativeApp } from '@/lib/ios-bridge';
import { findPastedPlaylistSong, formatPastedPlaylistSongs, parsePastedPlaylistSongCandidates, parsePastedPlaylistSongs, type PlaylistImportRow } from '@/lib/playlist-import';
import { useEffect, useState } from 'react';
import { LyricsSection, SimilarTracksSection } from "./discovery";
import { AppleMusicArtwork } from '@/components/apple-music-artwork';
import { LastfmMetadata } from '@/components/lastfm-metadata';
import { MusicMetadata, SongTitle } from "@/components/music-metadata";
import { CAN_WRITE } from '@/config';
import { getFresh, invalidate, postJson } from '@/lib/api';
import { SongListRow } from "./main";
// Thư viện, Bài chưa khớp, Chi tiết bài, Chi tiết nghệ sĩ.
import { SHOW_SHARE } from "./main";
import { Ctx, VM } from "@/vm";
import { ChartCard, PartRows, SampleChip, Sec, Spin, Thumb } from "@/components/ui";
import { MonthlySummaryReadout } from '@/components/month-summary-popup';

type P = { vm: VM; c: Ctx };
type Any = any;

function MatchRow({ m }: { m: Any }) {
  return (
    <div className="row" style={{ padding: "12px 8px 8px 16px", display: "flex", flexDirection: "column", gap: 2, cursor: "default" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pretty" style={{ fontSize: 14, fontWeight: 600 }}>“{m.t}”</div>
          <div className="sub13 pretty">{m.a}</div>
          <div className="num t3" style={{ fontSize: "var(--type-caption, 11px)", marginTop: 2 }}>{m.plays} lượt trên Last.fm</div>
        </div>
        {m.canMerge && <div onClick={m.onMerge} style={{ flex: "none", height: 44, padding: "0 8px", display: "flex", alignItems: "center", cursor: "pointer" }}><div className="pill-accent">Ghép</div></div>}
        {m.canFind && <div onClick={m.onFind} style={{ flex: "none", height: 44, padding: "0 8px", display: "flex", alignItems: "center", cursor: "pointer" }}><div className="pill-outline">Tìm bài…</div></div>}
        {m.done && <div style={{ flex: "none", padding: "12px 8px 0", fontSize: 13, fontWeight: 600, color: "var(--up)", whiteSpace: "nowrap" }}>{m.doneLabel}</div>}
      </div>
      {m.showSugg && (
        <div style={{ display: "flex", flexDirection: "column", paddingRight: 8 }}>
          {m.sugg.map((sg: Any, j: number) => (
            <div key={j} onClick={sg.onTap} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer" }}>
              <div className={"radio" + (sg.on ? " on" : "")} />
              <div className="pretty" style={{ fontSize: 13, minWidth: 0 }}>{sg.label}</div>
            </div>
          ))}
        </div>
      )}
      {m.done && <div className="sub13 pretty" style={{ padding: "4px 0" }}>{m.doneTo}</div>}
    </div>
  );
}

function SyncButton({ busy, onTap, label = "Đồng bộ" }: { busy: boolean; onTap: () => void; label?: string }) {
  const style = { flex: "none", height: 44, padding: "0 8px", border: 0, background: "transparent", color: "inherit", font: "inherit", display: "flex", alignItems: "center", cursor: busy ? "default" : "pointer" } as const;
  if (busy) return <button type="button" className="t2" disabled aria-busy="true" aria-label="Đang đồng bộ" style={{ ...style, gap: 6, fontSize: 13, whiteSpace: "nowrap" }}><Spin />Đang đồng bộ…</button>;
  return <button type="button" onClick={onTap} style={style}><span className="pill-sm">{label}</span></button>;
}

function PlaylistKeywordSettings({notify}:{notify:(message:string)=>void}) {
  const [rules,setRules]=useState<PlaylistKeywordRule[]>(()=>readPlaylistKeywordRules());
  const [draft,setDraft]=useState(()=>rules.map(rule=>rule.keyword).join('\n'));
  useEffect(()=>{
    let active=true;
    syncPlaylistRankingSettings(true).then(()=>{
      if(!active)return;
      const synced=readPlaylistKeywordRules();
      setRules(synced);
      setDraft(synced.map(rule=>rule.keyword).join('\n'));
    });
    return()=>{active=false;};
  },[]);
  const sync=(next:PlaylistKeywordRule[],message:string)=>{
    const saved=savePlaylistKeywordRules(next);
    setRules(saved);
    setDraft(saved.map(rule=>rule.keyword).join('\n'));
    notify(message);
  };
  const toggle=(index:number)=>{
    sync(rules.map((rule,i)=>i===index?{...rule,enabled:!rule.enabled}:rule),'Đã cập nhật từ khóa playlist.');
  };
  const saveDraft=()=>{
    const enabledByKey=new Map(rules.map(rule=>[rule.keyword.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim(),rule.enabled]));
    const next=draft.split(/\n|,/).map(keyword=>keyword.trim()).filter(Boolean).map(keyword=>({
      keyword,
      enabled:enabledByKey.get(keyword.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim()) ?? true,
    }));
    sync(next,'Đã lưu từ khóa playlist.');
  };
  const reset=()=>sync(resetPlaylistKeywordRules(),'Đã khôi phục từ khóa ranking mặc định.');
  return <div className="card pad">
    <div className="title15">Từ khóa loại khỏi ranking</div>
    <div className="sub13 pretty" style={{marginTop:4}}>Playlist có tên khớp từ khóa đang bật vẫn hiện trong thư viện, nhưng không tham gia Top Playlists.</div>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:12}}>
      {rules.map((rule,index)=><button key={rule.keyword+index} type="button" className={'chip '+(rule.enabled?'on':'')} aria-pressed={rule.enabled} onClick={()=>toggle(index)} style={{minHeight:32,padding:'0 10px'}}>{rule.keyword}</button>)}
    </div>
    <textarea value={draft} onChange={event=>setDraft(event.target.value)} aria-label="Từ khóa loại khỏi ranking" spellCheck={false} style={{width:'100%',minHeight:120,boxSizing:'border-box',marginTop:12,border:'1px solid var(--line)',borderRadius:10,background:'var(--surface2)',color:'var(--text)',padding:12,font:'13px var(--mono)',resize:'vertical'}}/>
    <div style={{display:'flex',gap:10,marginTop:10}}>
      <button type="button" className="pill-sm" onClick={saveDraft}>Lưu</button>
      <button type="button" className="pill-outline" onClick={reset}>Mặc định</button>
    </div>
  </div>;
}

function RecommendSongImporter({notify}:{notify:(message:string)=>void}) {
  const [text,setText]=useState(''),[rows,setRows]=useState<PlaylistImportRow[]>([]),[busy,setBusy]=useState(false),[recognizing,setRecognizing]=useState(false),[summary,setSummary]=useState('');
  const update=(line:number,patch:Partial<PlaylistImportRow>)=>setRows(current=>current.map(row=>row.line===line?{...row,...patch}:row));
  const paste=(event:React.ClipboardEvent<HTMLTextAreaElement>)=>{
    const html=event.clipboardData.getData('text/html');
    const plain=event.clipboardData.getData('text/plain');
    const parsed=parsePastedPlaylistSongs(html).length?parsePastedPlaylistSongs(html):parsePastedPlaylistSongs(plain);
    const candidates=parsePastedPlaylistSongCandidates(plain);
    if(!parsed.length&&!candidates.length)return;
    event.preventDefault();
    const start=event.currentTarget.selectionStart ?? 0,end=event.currentTarget.selectionEnd ?? start;
    if(parsed.length){
      const value=text.slice(0,start)+formatPastedPlaylistSongs(parsed)+text.slice(end);
      setText(value);setRows([]);setSummary('');return;
    }
    const original=text.slice(0,start)+plain+text.slice(end);
    setText(original);setRows([]);setSummary('Đang nhận dạng tên bài và nghệ sĩ…');setRecognizing(true);
    Promise.all(candidates.map(async row=>{
      const match=await findPastedPlaylistSong(row);
      return {...row,title:match.title,artist:match.artist};
    })).then(resolved=>{
      setText(text.slice(0,start)+formatPastedPlaylistSongs(resolved)+text.slice(end));
      setSummary('Đã chuyển sang định dạng tên bài · nghệ sĩ.');
    }).catch(()=>setSummary('Chưa nhận dạng được toàn bộ danh sách. Bạn vẫn có thể bấm Tìm và thêm để thử lại.'))
      .finally(()=>setRecognizing(false));
  };
  async function importSongs(value:string) {
    if(busy)return;
    const parsed=parsePastedPlaylistSongCandidates(value);
    if(!parsed.length){
      setRows([]);setSummary('Không đọc được danh sách bài hát.');
      notify('Danh sách chưa đúng định dạng.');
      return;
    }
    const initial:PlaylistImportRow[]=parsed.map(row=>({...row,status:'ready',message:'Đang tìm playlist…'}));
    setRows(initial);setSummary('');setBusy(true);
    let playlistId='';
    try {
      const snapshot=await loadPlaylistSnapshot();
      playlistId=snapshot.playlists.find(playlist=>playlist.name.normalize('NFC').trim().toLocaleLowerCase('vi')==='a_recommend songs')?.id || '';
      if(!playlistId)throw new Error('Không tìm thấy playlist A_Recommend songs.');
    } catch(error) {
      const message=error instanceof Error?error.message:'Chưa tải được danh sách playlist.';
      setRows(current=>current.map(row=>({...row,status:'error',message})));
      setSummary(message);setBusy(false);notify(message);
      return;
    }
    let added=0,exists=0,failed=0;
    const normalized:PlaylistImportRow[]=[];
    for(const row of initial){
      try {
        update(row.line,{status:'finding',message:'Đang tìm trên Apple Music…'});
        const match=await findPastedPlaylistSong(row);
        normalized.push({...row,title:match.title,artist:match.artist,match});
        update(row.line,{status:'adding',match,message:match.match==='exact'?'Đã tìm thấy':'Đã tìm thấy một phiên bản'});
        const result=await addTrackToPlaylistInNativeApp(playlistId,{storeId:match.storeId,artist:match.artist,title:match.title,album:match.album});
        if(result.alreadyInPlaylist){exists++;update(row.line,{status:'exists',match,message:'Đã có trong playlist'});}
        else {added++;update(row.line,{status:'added',match,message:'Đã thêm'});}
      } catch(error) {
        normalized.push(row);
        failed++;update(row.line,{status:'error',message:error instanceof Error?error.message:'Chưa thêm được bài này.'});
      }
    }
    if(normalized.some(row=>!!row.artist))setText(formatPastedPlaylistSongs(normalized));
    const message=`Đã thêm ${added} bài${exists?` · ${exists} bài đã có`:''}${failed?` · ${failed} bài lỗi`:''}.`;
    setSummary(message);setBusy(false);notify(message);
  }
  return <div className="card pad recommend-song-import">
    <div className="title15">A_Recommend songs</div>
    <textarea value={text} disabled={busy||recognizing} onPaste={paste} onChange={event=>{setText(event.target.value);setRows([]);setSummary('');}} aria-label="Danh sách bài đề xuất" placeholder={'The Last Journey\tA Canorous Quintet\nThe Somberlain\tDissection\nPerpetual Dawn\tGates of Ishtar'} spellCheck={false}/>
    <div className="recommend-song-import-actions">
      <button type="button" className="pill-sm" disabled={busy||recognizing||!text.trim()} onClick={()=>void importSongs(text)}>{recognizing?'Đang nhận dạng…':busy?'Đang thêm…':'Tìm và thêm'}</button>
    </div>
    {!!rows.length&&<div className="playlist-import-results" role="status">{rows.map(row=><div key={row.line} className={'playlist-import-result '+row.status}>
      <div><strong>{row.match?.title || row.title}</strong><span>{row.match?.artist || row.artist}{row.match?.album?` · ${row.match.album}`:''}</span></div><em>{row.message || 'Chờ'}</em>
    </div>)}</div>}
    {(busy||summary)&&<div className="recommend-song-import-summary t3" role="status">{busy?'Đang tìm và thêm bài…':summary}</div>}
  </div>;
}

function RuleRow({ r }: { r: Any }) {
  return (
    <div className="row" onClick={r.onTap} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 16px" }}>
      <div className="t2 pretty" style={{ font: "12px var(--mono)" }}>{r.from}</div>
      <div className="pretty" style={{ fontSize: 14, fontWeight: 600 }}>→ {r.title}</div>
      <div className="t2" style={{ fontSize: "var(--type-caption, 12px)" }}>{r.artist}</div>
    </div>
  );
}

function TitleRuleEditor({notify}:{notify:(message:string)=>void}) {
  const [from,setFrom]=useState('');
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<Any[]>([]);
  const [selected,setSelected]=useState<Any|null>(null);
  const [searching,setSearching]=useState(false);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    const q=query.trim();
    if(q.length<2){setResults([]);setSearching(false);return;}
    let active=true;
    setSearching(true);
    const timer=setTimeout(()=>{
      getFresh(`/library/search?q=${encodeURIComponent(q)}&limit=12`).then(data=>{
        if(active)setResults(Array.isArray(data?.songs)?data.songs:[]);
      }).catch(()=>{if(active)setResults([]);}).finally(()=>{if(active)setSearching(false);});
    },250);
    return()=>{active=false;clearTimeout(timer);};
  },[query]);
  const save=async()=>{
    if(saving)return;
    if(!CAN_WRITE){notify('Bản này chỉ có quyền đọc, chưa lưu được quy tắc.');return;}
    if(!from.trim()){notify('Nhập tên bài từ Last.fm.');return;}
    if(!selected){notify('Chọn một bài đích trong thư viện.');return;}
    setSaving(true);
    try {
      const response=await postJson('/library/title-rules',{rules:[{from:from.trim(),track_id:selected.track_id}]});
      const result=response.data?.results?.[0];
      if(response.status!==200||result?.status!=='ok'){
        notify(result?.status==='ambiguous'?'Có nhiều bài trùng, hãy chọn lại.':'Không lưu được quy tắc, thử lại sau.');
        return;
      }
      setFrom('');setQuery('');setResults([]);setSelected(null);
      invalidate(path=>path==='/library/title-rules'||path==='/library');
      notify(`Đã thêm quy tắc → ${result.to}.`);
    } finally {setSaving(false);}
  };
  return <div className="card pad title-rule-editor">
    <div className="title15">Thêm quy tắc</div>
    <label className="sub13 pretty" style={{display:'block',marginTop:10}}>Tên bài nhận từ Last.fm</label>
    <input className="title-rule-input" value={from} onChange={event=>setFrom(event.target.value)} placeholder="Ví dụ: a dream of wilderness" autoCapitalize="none" autoCorrect="off"/>
    <label className="sub13 pretty" style={{display:'block',marginTop:12}}>Bài thật trong thư viện</label>
    <div className="search" style={{marginTop:6}}>
      <div className="dot"/>
      <input value={query} onChange={event=>{setQuery(event.target.value);setSelected(null);}} placeholder="Tìm tên bài hoặc nghệ sĩ"/>
    </div>
    {selected&&<div className="title-rule-selected"><span>Đã chọn</span><strong>{selected.title}</strong><small>{selected.artist || 'Chưa rõ nghệ sĩ'}{selected.album?` · ${selected.album}`:''}</small></div>}
    {!selected&&query.trim().length>=2&&<div className="title-rule-results">
      {searching?<div className="sub13">Đang tìm…</div>:results.length?results.map(song=><button type="button" key={song.track_id} onClick={()=>{setSelected(song);setQuery(`${song.title} · ${song.artist || ''}`);}}><strong>{song.title}</strong><span>{song.artist || 'Chưa rõ nghệ sĩ'}{song.album?` · ${song.album}`:''}</span></button>):<div className="sub13">Không tìm thấy bài phù hợp.</div>}
    </div>}
    <button type="button" className="title-rule-save" disabled={saving||!from.trim()||!selected} onClick={save}>{saving?'Đang lưu…':'Lưu quy tắc'}</button>
  </div>;
}

export function RulesScreen({ vm, c }: P) {
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <div className="sub13 pretty" style={{ padding: "16px 20px 10px" }}>Tên bài Last.fm sẽ được ghép vào đúng bài bạn chọn trong thư viện.</div>
      <TitleRuleEditor notify={c.ptoast}/>
      <div className="cap">Quy tắc đã lưu</div>
      {vm.rulesAll.length?<div className="group">{vm.rulesAll.map((r: Any) => <RuleRow key={`${r.from}:${r.title}`} r={r} />)}</div>:<div className="card pad sub13">Chưa có quy tắc thay thế.</div>}
    </>
  );
}

let qTimer: ReturnType<typeof setTimeout> | undefined;

export function LibraryScreen({ vm, c }: P) {
  const p = c.p;
  const onQ = (v: string) => {
    c.set(() => ({ q: v }));
    clearTimeout(qTimer);
    qTimer = setTimeout(() => c.set(() => ({ qd: v })), 300);
  };
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <div className="search" style={{ margin: "12px 16px 0" }}>
        <div className="dot" />
        <input value={p.q} onChange={(e) => onQ(e.target.value)} placeholder="Bài, nghệ sĩ, album" />
        {vm.searching && <div onClick={() => c.set(() => ({ q: "", qd: "" }))} className="t3" style={{ flex: "none", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, cursor: "pointer" }}>✕</div>}
      </div>
      {vm.searching ? (
        <>
          <div className="cap" style={{ paddingTop: 16 }}>{vm.resultLabel}</div>
          {vm.hasResults && (
            <div className="card">
              {vm.results.map((r: Any, k: number) => r.kind==='Bài hát' && r.gone ? <SongListRow key={k} r={r}/> : (
                <ShortcutTarget key={k} entity={r.kind==='Bài hát'?songShortcut(r):r.kind==='Album'?albumShortcut(r):artistShortcut(r)}><div className="row" onClick={r.onTap} style={{ display: "grid", gridTemplateColumns: "40px minmax(0,1fr) auto", alignItems: "center", columnGap: 10, padding: "9px 14px" }}>
                  <Thumb ini={r.ini} img={r.img} round={r.round} />
                  <div style={{ minWidth: 0 }}>
                    <div className="title15 ell">{r.title}</div>
                    <div className="sub13 ell">{r.sub}</div>
                  </div>
                  <div className="t3" style={{ fontSize: "var(--type-caption, 11px)", fontWeight: 600 }}>{r.kind}</div>
                </div></ShortcutTarget>
              ))}
            </div>
          )}
          {vm.noResults && (
            <div className="card" style={{ padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", border: "1.5px dashed var(--text3)" }} />
              <div className="title15">Không tìm thấy</div>
              <div className="sub13 pretty">Không có bài, nghệ sĩ hay album nào khớp “{p.q}”.</div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="cap">Nguồn dữ liệu</div>
          <div className="group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "10px 8px 12px 16px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 16 }}>Last.fm</div>
                  <div style={{ flex: "none", width: 8, height: 8, borderRadius: "50%", background: vm.sampleChip ? "var(--text3)" : "var(--up)" }} />
                </div>
                <div className="sub13">{vm.lfmL}</div>
                <div className="t3 pretty" style={{ fontSize: "var(--type-caption, 12px)", marginTop: 4 }}>{vm.lfmSched}</div>
              </div>
              <SyncButton busy={p.lfmBusy} onTap={vm.onSyncLfm} />
            </div>
            <div style={{ height: 0.5, background: "var(--line)", marginLeft: 16 }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "10px 8px 12px 16px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16 }}>Thư viện Apple Music</div>
                <div className="sub13 num pretty" style={{ marginTop: 2 }}>{vm.appleL}</div>
                <div className="t3 pretty" style={{ fontSize: "var(--type-caption, 12px)", marginTop: 4 }}>{vm.appleSub}</div>
                {vm.libPending && <div className="acc" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 13, fontWeight: 600 }}><Spin />{vm.libPendingL}</div>}
                {vm.libStale && <div className="t3 pretty" style={{ marginTop: 6, fontSize: 13 }}>Đồng bộ mất nhiều thời gian hơn dự kiến. Bạn có thể kiểm tra lại hoặc gửi lại yêu cầu.</div>}
              </div>
              {!vm.libPending && <SyncButton busy={p.libBusy} onTap={vm.onSyncLib} label={vm.libStale ? "Gửi lại" : "Đồng bộ"} />}
            </div>
          </div>

          <div className="cap">Thêm bài đề xuất</div>
          <RecommendSongImporter notify={c.ptoast} />

          <div className="cap">Lượt nghe chưa khớp</div>
          <div className="card">
            <div style={{ padding: "14px 16px 12px", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div className="num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{vm.unPlays}</div>
              <div className="num t2" style={{ fontSize: 14 }}>lượt / {vm.unSongs} bài</div>
            </div>
            {vm.simNote && <div className="t3 pretty" style={{ padding: "0 16px 10px", fontSize: "var(--type-caption, 12px)" }}>Chỉ mô phỏng: token chỉ đọc chưa ghép được trên server</div>}
            {vm.matches.map((m: Any, k: number) => <MatchRow key={k} m={m} />)}
            <div className="row" onClick={() => c.go("unmatched")} style={{ minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", fontSize: 15, color: "var(--accent)" }}>
              <div>Xem tất cả bài chưa khớp</div>
              <div className="t3" style={{ fontSize: 22 }}>›</div>
            </div>
          </div>

          <div className="cap">Hiển thị</div>
          <div className="card pad">
            <div className="title15">Số bài hát / nghệ sĩ / album theo kỳ</div>
            <div className="period-list-setting" role="group" aria-label="Số bài hát, nghệ sĩ hoặc album theo kỳ">
              {PERIOD_LIST_OPTIONS.map(size=><button key={size} aria-pressed={p.periodListSize===size} onClick={()=>{savePeriodListSize(size);c.set(()=>({periodListSize:size}));}}>{size}</button>)}
            </div>
            <div className="sub13">Áp dụng cho danh sách theo kỳ. All time luôn hiển thị tối đa 100.</div>
          </div>

          <ReleaseExclusionSettings />

          <div className="cap">Playlist ranking</div>
          <PlaylistKeywordSettings notify={c.ptoast} />

          <div className="cap">Quy tắc tính</div>
          <div className="group">
            <div onClick={vm.toggleRemaster} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 52, padding: "8px 16px", cursor: "pointer" }}>
              <div className="pretty" style={{ fontSize: 15 }}>Gộp bản remaster vào bài gốc</div>
              <div className={"toggle" + (vm.rmOn ? " on" : "")} />
            </div>
            {vm.remerging && <div className="acc" style={{ padding: "0 16px 10px", fontSize: "var(--type-caption, 12px)", fontWeight: 600 }}>Đang ghép lại các lượt chưa khớp…</div>}
            <div className="t3 pretty" style={{ padding: "10px 16px 12px", borderTop: "0.5px solid var(--line)", fontSize: "var(--type-caption, 12px)" }}>
              Last.fm quyết định thế nào là một lượt nghe; tuần tính từ Thứ Hai như Lark.{vm.simNote ? " Chỉ mô phỏng: token chỉ đọc chưa đổi được quy tắc trên server." : ""}
            </div>
          </div>

          <div className="cap">Quy tắc thay thế tên bài</div>
          <div className="group">
            <div className="t3 pretty" style={{ padding: "10px 16px 8px", fontSize: "var(--type-caption, 12px)" }}>Ghép tên bài nhận từ Last.fm vào đúng bài trong thư viện.</div>
            {vm.rules3.map((r: Any) => <RuleRow key={`${r.from}:${r.title}`} r={r} />)}
            <button type="button" className="row" onClick={() => c.go("rules")} style={{ minHeight: 48, width:'100%', border:0, background:'transparent', color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", fontSize: 15, textAlign:'left' }}>
              <span>{vm.hasRules?vm.rulesMore:'Thêm quy tắc'}</span>
              <span aria-hidden="true" style={{ fontSize: 22 }}>{vm.hasRules?'›':'＋'}</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function UnmatchedScreen({ vm }: P) {
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div className="num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{vm.unPlays}</div>
        <div className="num t2" style={{ fontSize: 14 }}>lượt / {vm.unSongs} bài chưa khớp thư viện</div>
      </div>
      {vm.simNote && <div className="t3 pretty" style={{ padding: "4px 20px 0", fontSize: "var(--type-caption, 12px)" }}>Chỉ mô phỏng: token chỉ đọc chưa ghép được trên server</div>}
      <div className="t3 pretty" style={{ padding: "6px 20px 10px", fontSize: "var(--type-caption, 12px)" }}>{vm.unHint}</div>
      <div className="card">{vm.allMatches.map((m: Any, k: number) => <MatchRow key={k} m={m} />)}</div>
    </>
  );
}

export function SongScreen({ vm, c }: P) {
  const s = vm.song as any;
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "16px 16px 0" }}>
        <AppleMusicArtwork shortcut={songShortcut(s)} query={{kind:'song',artist:s.artist,title:s.title,album:s.album,trackId:s.tid || c.id}} notify={c.ptoast}>
          <Thumb ini={s.ini} img={s.img} size={112} style={{ borderRadius: 12, fontSize: 22, background: "repeating-linear-gradient(135deg,var(--surface2) 0 8px,var(--surface) 8px 9px)" }} />
        </AppleMusicArtwork>
        <ShortcutTarget entity={songShortcut(s)}><div className="song-detail-copy">
          <SongTitle title={s.title} tone={s.titleTone} items={s.metadata} large />
          {s.gone && (
            <div style={{ display: "flex", marginTop: 6 }}>
              <div className="t2" style={{ padding: "1px 6px", border: "1px dashed var(--text3)", borderRadius: 4, fontSize: "var(--type-caption, 11px)", whiteSpace: "nowrap" }}>Không còn trong thư viện</div>
            </div>
          )}
          {s.artist ? (
            <ShortcutTarget entity={artistShortcut({name:s.artist,onTap:s.goArtist})}><div onClick={s.goArtist} className="acc" style={{ minHeight: 22, display: "flex", alignItems: "center", fontSize: 15, lineHeight: "22px", cursor: "pointer" }}>{s.artist}</div></ShortcutTarget>
          ) : (
            <div className="t3" style={{ minHeight: 22, display: "flex", alignItems: "center", fontSize: 15, lineHeight: "22px" }}>Chưa rõ nghệ sĩ</div>
          )}
          <MusicMetadata items={s.metadata} />
        </div></ShortcutTarget>
        {s.gone && <LastfmTrackMetrics artist={s.artist || ''} title={s.title} trackId={s.tid} outsideLibrary/>}
      </div>
      <div style={{ margin: "14px 16px 0", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
        <div className="stat-box"><div className="num" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{s.score}</div><div className="t2" style={{ fontSize: "var(--type-caption, 11px)", marginTop: 4 }}>{s.scoreL}</div></div>
        <div className="stat-box"><div className="num" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{s.totalPlays}</div><div className="t2" style={{ fontSize: "var(--type-caption, 11px)", marginTop: 4 }}>Tổng lượt nghe</div></div>
        <div className="stat-box">
          <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 4 }}>
            <div className="num" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{s.rank}</div>
            {s.chg}
          </div>
          <div className="t2" style={{ fontSize: "var(--type-caption, 11px)", marginTop: 4 }}>{s.rankL}</div>
        </div>
      </div>
      <LastfmMetadata key={'lastfm-' + s.tid} trackId={s.tid} />
      {s.gone && <LastfmScrobbleRefreshButton notify={c.ptoast} tracks={[{artist:s.artist || '',title:s.title,trackId:s.tid}]}/>}
      {SHOW_SHARE && <div className="btn-wide" onClick={() => c.set(() => ({ sheet: true, toast: "" }))}>Chia sẻ số liệu bài này</div>}
      <div className="detail-chart-grid detail-chart-grid-single"><section>
        <div className="sec-side detail-chart-heading detail-chart-heading-readout-only">
          <div className="side num pretty"><MonthlySummaryReadout value={vm.rd.sh} c={c} months={vm.periodOptions?.sh} onMonthSelect={index => c.set(q => ({ sel: { ...q.sel, sh: index } }))}/></div>
        </div>
        <ChartCard>{vm.ch.sh}</ChartCard>
      </section></div>
      <div className="group" style={{ marginTop: 20 }}>
        {s.info.map((r: Any, k: number) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, minHeight: 44, alignItems: "center", padding: "0 16px", borderTop: k ? "0.5px solid var(--line)" : 0, fontSize: 15 }}>
            <div className="t2">{r.k}</div>
            <div className={`num tone-${r.tone || "gray"}`} style={{ textAlign: "right" }}>{r.onTap ? <ShortcutTarget entity={albumShortcut({title:s.album,artist:s.albumArtist || s.artist,onTap:r.onTap})}><button type="button" className="album-name-link acc" onClick={r.onTap} aria-label={`Mở album: ${r.v}`}>{r.v}</button></ShortcutTarget> : r.v}</div>
          </div>
        ))}
      </div>
      <div className="note pretty">Tổng lượt = lượt Apple Music đến 12/2024 + Last.fm. Bỏ qua lấy từ Apple Music.</div>
      <LyricsSection key={'lyrics-' + s.tid} trackId={s.tid} />
      <SimilarTracksSection key={'similar-' + s.tid} trackId={s.tid} c={c} ranks={vm.currentSongRanks} changes={vm.currentSongChanges} comparisons={vm.currentSongComparisons} />
    </>
  );
}

export function ArtistScreen({ vm, c }: P) {
  const a = vm.artist as any;
  return (
    <>
      <SampleChip show={vm.sampleChip} text={vm.chipText} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 16px 0" }}>
        <AppleMusicArtwork query={{kind:'artist',artist:a.name}} notify={c.ptoast} round>
          <Thumb ini={a.ini} img={a.img} round size={112} style={{ fontSize: 14, background: "repeating-linear-gradient(135deg,var(--surface2) 0 6px,var(--surface) 6px 7px)" }} />
        </AppleMusicArtwork>
        <div style={{ minWidth: 0 }}>
          <ShortcutTarget entity={artistShortcut(a)}><div className={`pretty tone-${a.titleTone || "gray"}`} style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5 }}>{a.name}</div></ShortcutTarget>
          {a.hot && <div className="acc" style={{ fontSize: "var(--type-caption, 12px)", fontWeight: 700, marginTop: 2 }}>* đang nghe nhiều</div>}
          {a.cold && <div className="pretty" style={{ fontSize: "var(--type-caption, 12px)", fontWeight: 700, color: "var(--down)", marginTop: 2 }}>!!! top 10 từ 04/2024 nhưng gần đây ít nghe</div>}
        </div>
      </div>

      <div className="artist-summary-metrics">
        {a.metrics.map((m: Any, i: number) => <div key={m.label} className="stat-box">
          <div className={`num metric-value${i === 1 ? " metric-duration" : ""}`}>{m.value}</div>
          <div className="t2 metric-label">{m.label}</div>
        </div>)}
      </div>
      <div style={{ margin: "14px 16px 0", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
        {[[a.wk, "Tuần"], [a.mo, "Tháng"], [a.all, "All time"]].map(([v, l]) => (
          <div key={l} className="stat-box">
            <div className="num" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{v}</div>
            <div className="t2" style={{ fontSize: "var(--type-caption, 11px)", marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>
      <div className="num t2 pretty" style={{ padding: "8px 20px 0", fontSize: "var(--type-caption, 12px)" }}>{a.rline}</div>
      <div style={{ margin: "10px 16px 0", background: "var(--surface)", borderRadius: 14, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div className="t2" style={{ fontSize: 14 }}>Khoảng cách trung bình giữa các ngày nghe</div>
        <div className="num" style={{ flex: "none", fontSize: 17, fontWeight: 700 }}>{a.gap}</div>
      </div>
      <div className="sub13 pretty" style={{ padding: "8px 20px 0" }}>{a.lib}</div>
      {SHOW_SHARE && <div className="btn-wide" onClick={() => c.set(() => ({ sheet: true, toast: "" }))}>Chia sẻ số liệu nghệ sĩ</div>}
      <div className="detail-chart-grid artist-detail-charts"><section>
      <div className="sec-side detail-chart-heading detail-chart-heading-readout-only">
        <div className="side num pretty"><MonthlySummaryReadout value={vm.rd.ah} c={c} months={vm.periodOptions?.ah} onMonthSelect={index => c.set(q => ({ sel: { ...q.sel, ah: index } }))}/></div>
      </div>
      <ChartCard>{vm.ch.ah}</ChartCard>
      </section><section><div className="sec" style={{ marginTop: 22 }}>Lượt theo tuần · 26 tuần gần nhất</div>
      <ChartCard readout={vm.rd.aw}>{vm.ch.aw}</ChartCard>
      </section></div>
      {a.hasPts && (
        <div className="card" style={{ marginTop: 10, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div className="lbl">Điểm</div>
            <div className="sub13">hạng điểm {a.ptsRank}</div>
          </div>
          <div className="num" style={{ fontSize: 36, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1, marginTop: 6 }}>{a.pts}</div>
          <div style={{ marginTop: 12 }}><PartRows parts={a.parts} /></div>
        </div>
      )}
      {!!a.albums?.length && <><div className="sec">Album trong thư viện · {a.albums.length}</div><AlbumGrid albums={a.albums}/></>}
      <div className="sec" style={{ marginTop: 22 }}>Top bài</div>
      {a.songs.length > 0 ? (
        <div className="card">
          {a.songs.map((r: Any, k: number) => <SongListRow key={k} r={r} />)}
        </div>
      ) : (
        <div className="card sub13" style={{ padding: "18px 16px", textAlign: "center" }}>Chưa có bài nào của nghệ sĩ này trong dữ liệu.</div>
      )}
    </>
  );
}
