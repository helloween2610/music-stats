import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Ctx, VM } from '@/vm';
import { Legend, SampleChip, Thumb } from '@/components/ui';
import { AlbumGrid } from '@/components/album-grid';
import { MonthWeeksChart } from '@/lib/month-weeks';
import { compactPlays } from '@/components/music-metadata';
import { NowPlayingButton, RecentSongs, SongListRow, ArtistStatsLine, RisingSongGroups, RisingArtistGroups } from './main';

type P = {vm:VM;c:Ctx};
type Row = any;

function Panel({title,subtitle,action,children,className=''}:{title:string;subtitle?:ReactNode;action?:()=>void;children:ReactNode;className?:string}) {
  return <section className={`web-panel ${className}`}><header className="web-panel-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action&&<button onClick={action}>Xem tất cả <span aria-hidden="true">↗</span></button>}</header>{children}</section>;
}
function Chart({children,clock=false,wide=false}:{children:ReactNode;clock?:boolean;wide?:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(clock || !ref.current)return;
    const element=ref.current;
    const resize=()=>{
      const svg=element.querySelector('svg');
      const scale=svg?.getScreenCTM()?.a;
      if(scale && scale>0)element.style.setProperty('--chart-font-size',`${11/scale}px`);
    };
    resize();
    const observer=new ResizeObserver(resize);observer.observe(element);
    const svg=element.querySelector('svg');if(svg)observer.observe(svg);
    return()=>observer.disconnect();
  },[clock,wide,children]);
  return <div ref={ref} className={`web-chart${clock?' web-clock':''}${wide?' web-chart-wide':''}`}>{children}</div>;
}

export function DesktopTodayScreen({vm,c}:P) {
  return <div className="web-dashboard">
    <SampleChip show={vm.sampleChip} text={vm.chipText}/>
    <div className="web-today-intro">
    <div className="web-welcome"><div><div className="web-eyebrow">NHỊP NGHE CỦA BẠN</div><h2>Một góc nhìn về âm nhạc mỗi ngày.</h2><p>{vm.totalLine}</p></div></div>
    <div className="web-kpis">{[{label:'Tuần này',x:vm.wk,note:vm.wk.chg},{label:'Tháng này',x:vm.mo,note:vm.mo.chg},{label:vm.yr.label,x:vm.yr,note:vm.yr.prev}].map(item=><article className="web-kpi" key={item.label}><span>{item.label}</span><div><strong className="num">{item.x.plays}</strong><small>lượt nghe</small></div><p>{item.x.sub}</p><small style={{color:"col" in item.x?item.x.col:undefined}}>{item.note}</small></article>)}</div>
    <aside className="web-now-playing" aria-label="Now Playing"><NowPlayingButton c={c} alwaysShow/></aside>
    </div>
    <div className="web-today-charts">
        <Panel title="Top nghệ sĩ tuần này" subtitle="Xếp theo lượt nghe">
          <div className="web-week-table"><div className="web-week-row web-week-head"><span>Nghệ sĩ</span>{['T2','T3','T4','T5','T6','T7','CN','Tổng'].map(day=><span key={day}>{day}</span>)}</div>
            {vm.weekTable.length?vm.weekTable.map((r:Row,k:number)=><button key={k} className="web-week-row num" onClick={r.onTap}><span className="web-person"><Thumb ini={r.ini||r.name.slice(0,2)} img={r.img} size={30} round/><span className="ell">{r.name}</span></span>{r.cells.map((cell:Row,j:number)=><span key={j} style={cell.s}>{cell.v}</span>)}<strong>{r.total}</strong></button>):<p className="web-empty">Chưa có lượt nghe trong tuần.</p>}
          </div>
        </Panel>
      <Panel className="web-week-chart-panel" title={vm.weekTitle} subtitle="Lượt nghe mỗi ngày"><Legend items={[{color:'var(--c2)',label:'Trung bình'},{color:'var(--text3)',label:'Tuần trước'},{color:'var(--accent)',label:'Tuần này'}]}/><Chart>{vm.ch.week}</Chart></Panel>
      <Panel title="Giờ nghe trong tuần" subtitle="Phân bố trong 24 giờ"><Chart clock>{vm.ch.weekHour || <p className="t3">Chưa có lượt nghe</p>}</Chart></Panel>
    </div>
    <div className="web-two-columns web-today-lists">
      <div className="web-stack">

        <Panel title={vm.top5Title} subtitle={vm.top5Prev?vm.top5Note:undefined} action={vm.viewTodaySongs}><div className="web-song-list">{vm.top5.map((r:Row,k:number)=><SongListRow key={k} r={r}/>)}</div></Panel>
      </div>
      <Panel title="Vừa nghe" subtitle="Những bài hát gần đây" action={()=>c.go('recent')} className="web-recent-panel"><div className="web-recent-scroll"><RecentSongs rows={vm.recent}/></div></Panel>
    </div>
  </div>;
}

function Summary({summary,stats}:{summary:Row;stats:Row[]}) {
  const metrics=summary?.metrics || stats.map(s=>({label:s.l,value:s.v}));
  return <section className="web-summary">
    <div className="web-summary-title"><span className="web-eyebrow">TỔNG QUAN</span><h2>{summary?.title || 'Thống kê nghe nhạc'}</h2></div>
    <div className="web-summary-metrics">{metrics.map((m:Row)=><div key={m.label}><strong className="num">{m.value}</strong><span>{m.label}</span></div>)}</div>
    {summary?.lead&&<button className="web-summary-lead" onClick={summary.openAll}><Thumb ini={summary.lead.ini||summary.lead.name.slice(0,2)} img={summary.lead.img} round size={48}/><span><small>NGHỆ SĨ #1</small><strong className="ell">{summary.lead.name}</strong><em>{summary.lead.value}</em></span></button>}
  </section>;
}
function Highlights({summary}:{summary:Row}) {
  if(!summary)return null;
  const blocks=summary.blocks || [
    {label:'Nghệ sĩ tăng hạng',count:summary.risingCount,rows:summary.risingArtists,round:true,onTap:summary.openRising},
    {label:'Nghệ sĩ mới',count:summary.newCount,rows:summary.newArtists,round:true,onTap:summary.openNew},
    {label:'Bài hát tăng hạng',count:summary.risingSongCount,rows:summary.risingSongs,onTap:summary.openRisingSongs},
    {label:'Bài hát mới nổi bật',count:summary.newSongCount,rows:summary.newSongs,onTap:summary.openNewSongs},
  ];
  return <aside className="web-highlights"><div className="web-rail-title">Điểm nhấn trong kỳ</div>{blocks.map((b:Row)=><button className="web-highlight" key={b.label} onClick={b.onTap}><span className="web-highlight-title">{b.label}<b>{b.count || '0'}</b></span><span className="web-highlight-people">{b.rows?.length?b.rows.slice(0,3).map((r:Row,i:number)=><span className="web-highlight-person" key={i}><Thumb ini={r.ini||r.name?.slice(0,2)||'♫'} img={r.img} round={b.round} size={25}/><span className="ell">{r.name||r.title}</span>{r.change>0&&<b>▲{r.change}</b>}</span>):<span className="web-empty">Chưa có trong kỳ này</span>}</span></button>)}</aside>;
}

export function DesktopOverviewScreen({vm}:P) {
  return <div className="web-dashboard">
    <SampleChip show={vm.sampleChip} text={vm.chipText}/>
    <div className="web-toolbar"><div><span className="web-eyebrow">THÓI QUEN & KHÁM PHÁ</span><h2>Bức tranh nghe nhạc</h2></div></div>
    <Summary summary={vm.monthSummary} stats={vm.stats}/>
    <div className={`web-overview-body${vm.isMonth?"":" web-overview-long"}`}>
      <div className="web-overview-charts">
        {vm.isMonth ? <>
          <Panel title="Theo ngày" subtitle={<>{vm.dayTitle} · {vm.rd.day}</>}><Chart>{vm.monthEmpty?<p className="web-empty">Chưa có lượt nghe trong tháng.</p>:vm.ch.day}</Chart></Panel>
          <Panel title="Theo tuần" subtitle="So sánh các tuần trong tháng"><Chart>{vm.monthWeeks?.length?<MonthWeeksChart key={vm.dayTitle} weeks={vm.monthWeeks}/>:<p className="web-empty">Chưa có lượt nghe trong tháng.</p>}</Chart></Panel>
          <Panel title="Theo thứ" subtitle={vm.rd.wd}><Chart>{vm.ch.wd}</Chart></Panel>
          <Panel title="Theo giờ" subtitle={vm.rd.hr}><Chart clock>{vm.ch.hr}</Chart></Panel>
        </> : <>
          <Panel title="Lượt nghe theo tháng" subtitle={vm.rd.month}><Chart wide>{vm.ch.month}</Chart>{vm.hasBefore&&<p className="web-chart-note">{vm.beforeL}</p>}</Panel>
          <Panel title="Giờ nghe theo tháng" subtitle={vm.rd.hours}><Chart wide>{vm.ch.hours}</Chart></Panel>
          {vm.ch.calendar && <Panel title="Listening Calendar" subtitle={vm.rd.calendar}><Chart wide>{vm.ch.calendar}</Chart></Panel>}
        </>}
      </div>
      <Highlights summary={vm.monthSummary}/>
    </div>
    <div className="web-two-columns web-overview-rankings">
      <Panel title={vm.topArtistsTitle} action={vm.viewArtists}><div className="web-ranked-artists" style={{gridTemplateRows:`repeat(${Math.max(1,Math.ceil(vm.hourArtists.length/2))}, minmax(0,1fr))`}}>{vm.hourArtists.map((r:Row,k:number)=><button key={k} onClick={r.onTap}><span className="web-position num">{r.rank||k+1}</span><Thumb ini={r.ini||r.name.slice(0,2)} img={r.img} round size={38}/><div className="web-ranked-artist-details"><div className="ell">{r.name}</div><ArtistStatsLine r={r}/></div><span className="web-artist-metrics num"><strong>{compactPlays(r.big||r.v)}</strong>{r.small && <span>{compactPlays(r.small)}</span>}</span></button>)}</div></Panel>
      <Panel title={vm.topSongsTitle} action={vm.viewSongs}><div className="web-song-list">{vm.top15.map((r:Row,k:number)=><SongListRow key={k} r={r}/>)}</div></Panel>
    </div>
    <div className="web-two-columns">
      <Panel title={vm.topAlbumsTitle} action={vm.viewAlbums}><AlbumGrid albums={vm.albums.slice(0,6)}/></Panel>
      <Panel title={vm.topGenresTitle}><div className="web-genres">{vm.genres.map((r:Row,k:number)=><div key={k}><div><span>{r.name}</span><strong className="num">{compactPlays(r.v)}</strong></div>{r.bar}{r.detail&&<small>{r.detail}</small>}</div>)}</div></Panel>
    </div>

  </div>;
}

export function DesktopReleaseYearsScreen({vm}:P) {
  return <div className="web-dashboard web-release-years-dashboard">
    <Panel title="Bài thêm vào thư viện theo năm phát hành" subtitle={vm.rd.area} className="web-area-panel">
      {vm.ch.area ? <Chart wide>{vm.ch.area}</Chart> : <p className="web-empty">Chưa có dữ liệu năm phát hành.</p>}
      <Legend items={vm.areaLegend.map((r:Row)=>({color:r.color,label:r.name}))}/>
    </Panel>
    <div className="web-release-chart-grid">
      <Panel title="Top Tags" subtitle="Theo năm phát hành"><Chart wide>{vm.ch.tags || <p className="web-empty">Chưa có dữ liệu tag.</p>}</Chart></Panel>
      <Panel title="Artist Map" subtitle="Theo quốc gia artist"><Chart wide>{vm.ch.artistMap}</Chart></Panel>
    </div>
  </div>;
}

export function DesktopTrendScreen({vm}:P) {
  return <div className="web-dashboard"><SampleChip show={vm.sampleChip} text={vm.chipText}/><div className="web-two-columns web-trend-columns"><Panel title="Nghệ sĩ đang lên" subtitle="Thay đổi thứ hạng theo tháng"><RisingArtistGroups groups={vm.risingArtists} emptyNote="Chưa có nghệ sĩ tăng hạng trong kỳ."/></Panel><Panel title="Bài đang lên hạng" subtitle="Biến động trên bảng xếp hạng"><RisingSongGroups vm={vm} rows={vm.rising}/></Panel></div></div>;
}
