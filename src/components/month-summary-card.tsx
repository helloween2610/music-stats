import { Thumb } from '@/components/ui';

type Any = any;

function MonthSummaryPeople({ rows, round = false }: { rows: Any[]; round?: boolean }) {
  return <div className="month-summary-people">
    {rows.slice(0, 3).map((r: Any) => <span key={r.ak || r.tid || r.an || r.name} className="month-summary-person">
      <Thumb ini={r.ini || r.name?.slice(0, 2) || '♫'} img={r.img} round={round} size={22} />
      <span className="ell">{r.name}</span>
      {r.change ? <b className="num">▲{r.change}</b> : r.metric ? <b className="num month-summary-metric">{r.metric}</b> : null}
    </span>)}
  </div>;
}

export function MonthSummaryCard({ summary }: { summary: Any }) {
  if (!summary) return null;
  return <div className="month-summary-card">
    <button type="button" className="month-summary-head" onClick={summary.openAll}>
      <span className="month-summary-main">
        {summary.metrics?.length ? <span className="month-summary-metrics">
          {summary.metrics.map((m: Any) => <span key={m.label}><b className="num">{m.value}</b><small>{m.label}</small></span>)}
        </span> : <em>{summary.status}</em>}
      </span>
      {summary.lead && <span className="month-summary-lead">
        <Thumb ini={summary.lead.ini || summary.lead.name?.slice(0, 2) || '♫'} img={summary.lead.img} round size={36} />
        <span className="ell">#1 {summary.lead.name}</span>
        <b>{summary.lead.value}</b>
      </span>}
    </button>
    <div className="month-summary-grid">
      {(summary.blocks || [
        { label: 'Tăng hạng', count: summary.risingCount ? `${summary.risingCount} nghệ sĩ` : 'Chưa có', rows: summary.risingArtists || [], round: true, onTap: summary.openRising },
        { label: 'Nghệ sĩ mới', count: summary.newCount ? `${summary.newCount} nghệ sĩ` : 'Chưa có', rows: summary.newArtists || [], round: true, onTap: summary.openNew },
        { label: 'Bài hát tăng hạng', count: summary.risingSongCount ? `${summary.risingSongCount} bài` : 'Chưa có', rows: summary.risingSongs || [], onTap: summary.openRisingSongs },
        { label: 'Bài hát mới nổi bật', count: summary.newSongCount ? `${summary.newSongCount} bài` : 'Chưa có', rows: summary.newSongs || [], onTap: summary.openNewSongs },
      ]).map((block: Any) => <button type="button" key={block.label} className="month-summary-block" onClick={block.onTap}>
        <span className="lbl">{block.label}</span>
        <strong>{block.count}</strong>
        <MonthSummaryPeople rows={block.rows || []} round={block.round} />
      </button>)}
    </div>
  </div>;
}
