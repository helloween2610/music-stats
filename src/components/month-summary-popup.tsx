import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { albumId } from '@/lib/albums';
import { useSheetMotion, useSheetSwipeDismiss } from './shortcut-sheet-controls';
import { fetchJson } from '@/lib/api';
import { fmtH, ini, vn, vnToday } from '@/lib/fmt';
import { allTimeRankChanges, allTimeRiseWindow } from '@/lib/period-alltime-rise';
import type { Ctx } from '@/vm';
import { DetailChartReadout } from '@/components/ui';
import { MonthSummaryCard } from '@/components/month-summary-card';

type Any = any;
const US = '\u001f';
type MonthOption = { label: string; period: string; index: number };

function monthFromReadout(value?: string) {
  const match = /^T(\d{2})\/(\d{2})(?:\s*·|$)/.exec(String(value || ''));
  return match ? `20${match[2]}-${match[1]}` : '';
}

function monthLabel(period: string) {
  return `T${period.slice(5, 7)}/${period.slice(2, 4)}`;
}

function summaryMonthGroups(options: MonthOption[]) {
  const groups = new Map<string, MonthOption[]>();
  [...options].reverse().forEach(option => {
    const year = option.period.slice(0, 4);
    groups.set(year, [...(groups.get(year) || []), option]);
  });
  return [...groups].map(([year, months]) => ({ year, months }));
}

function summaryForMonth(period: string, c: Ctx) {
  const today = vnToday();
  const window = allTimeRiseWindow(period, today);
  const asOf = window.end;
  const entries = [
    fetchJson(`/overview?scope=${period}&asOf=${asOf}&limit=5000&spark=v2`),
    fetchJson(`/charts/artists?window=at&limit=5000&asOf=${window.before}`),
    fetchJson(`/charts/artists?window=at&limit=5000&asOf=${window.end}`),
    fetchJson('/artwork'),
  ];
  if (entries.some(entry => entry.st === 'err' && !entry.data)) return { error: true, summary: null };
  const [overviewEntry, beforeEntry, currentEntry, artworkEntry] = entries;
  if (!overviewEntry.data || !beforeEntry.data || !currentEntry.data) return { error: false, summary: null };

  const overview = overviewEntry.data;
  const totals = overview.totals || {};
  const artwork = artworkEntry.data || {};
  const openArtists = (periodFilter = 'Tất cả') => c.go('periodTop', `artists~${period}~${asOf}`, { periodFilter, periodSort: 'Giờ nghe' });
  const openSongs = () => c.go('periodTop', `songs~${period}~${asOf}`, { periodFilter: 'Tất cả', songView: 'Danh sách' });
  const listened = new Set((overview.artists || []).map((row: Any) => row.name));
  const changes = allTimeRankChanges(currentEntry.data.rows || [], beforeEntry.data.rows || [], (row: Any) => row.artist);
  const currentRanks = new Map<string, number>((currentEntry.data.rows || []).map((row: Any) => [row.artist, row.rank]));
  const risingArtists = [...changes]
    .filter(([name, change]) => change > 0 && listened.has(name))
    .sort((a, b) => (currentRanks.get(a[0]) ?? Infinity) - (currentRanks.get(b[0]) ?? Infinity))
    .map(([name, change]) => ({ an: name, name, ini: ini(name), img: artwork.artists?.[name], change, rank: currentRanks.get(name), onTap: () => c.go('artist', name) }));
  const topArtists = (overview.artists || []).slice(0, 3).map((row: Any) => ({
    an: row.name, name: row.name, ini: ini(row.name), img: artwork.artists?.[row.name], metric: fmtH(row.hours || 0), onTap: () => c.go('artist', row.name),
  }));
  const topAlbums = (overview.albums || []).slice(0, 3).map((row: Any) => ({
    ak: row.artist + US + row.name, name: row.name, artist: row.artist, ini: ini(row.name), img: artwork.albums?.[row.artist + US + row.name], metric: fmtH(row.hours || 0), onTap: () => c.go('album', albumId(row.artist, row.name)),
  }));
  const topSongs = (overview.songs || []).slice(0, 3).map((row: Any) => ({
    tid: row.track_id, name: row.title, title: row.title, artist: row.artist, ini: ini(row.title), img: artwork.tracks?.[row.track_id], metric: `${vn(row.plays || 0)}x`, onTap: () => c.go('song', row.track_id),
  }));
  const lead = topArtists[0];
  return { error: false, summary: {
    title: `Tóm tắt tháng ${Number(period.slice(5, 7))}`,
    metrics: [
      { value: vn(totals.plays || 0), label: 'lượt' },
      { value: vn(totals.songs || 0), label: 'bài' },
      { value: vn(totals.artists || 0), label: 'nghệ sĩ' },
      { value: vn(totals.albums || 0), label: 'Albums' },
    ],
    lead: lead ? { ...lead, value: lead.metric, onTap: () => openArtists() } : null,
    openAll: () => openArtists(),
    blocks: [
      { label: 'Top artist', count: `${topArtists.length} nghệ sĩ`, rows: topArtists, round: true, onTap: () => openArtists() },
      { label: 'Top Albums', count: `${topAlbums.length} Albums`, rows: topAlbums, onTap: () => c.go('periodTop', `albums~${period}~${asOf}`) },
      { label: 'Top song', count: `${topSongs.length} bài`, rows: topSongs, onTap: openSongs },
      { label: 'Tăng hạng', count: risingArtists.length ? `${risingArtists.length} nghệ sĩ` : 'Chưa có', rows: risingArtists.slice(0, 3), round: true, onTap: () => openArtists('Đang lên') },
    ],
  } };
}

function MonthSummaryPopup({ period, c, onClose:onDismiss }: { period: string; c: Ctx; onClose: () => void }) {
  const {close:onClose,motionProps}=useSheetMotion(onDismiss);
  const swipeDismiss=useSheetSwipeDismiss(onClose);
  const panel = useRef<HTMLDivElement>(null);
  const { summary, error } = summaryForMonth(period, c);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div {...motionProps} className="shortcut-backdrop month-summary-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div {...swipeDismiss} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={summary?.title || 'Tổng kết tháng'} className="shortcut-sheet month-summary-sheet" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
      <div className="shortcut-handle" />
      <div className="shortcut-heading shortcut-heading-with-close month-summary-popup-heading">
        <div><strong>{summary?.title || `Tóm tắt tháng ${Number(period.slice(5, 7))}`}</strong><span className="t3">Top 3 và thay đổi hạng trong tháng</span></div>
        <button type="button" className="shortcut-icon-close" aria-label="Đóng" onClick={onClose}>×</button>
      </div>
      {summary ? <MonthSummaryCard summary={summary} /> : <div className="t2 month-summary-loading">{error ? 'Chưa tải được tổng kết tháng.' : 'Đang tải tổng kết…'}</div>}
    </div>
  </div>, document.body);
}

function MonthPickerPopup({ current, options, onChoose, onClose:onDismiss }: { current: string; options: MonthOption[]; onChoose: (option: MonthOption) => void; onClose: () => void }) {
  const {close:onClose,exit,motionProps}=useSheetMotion(onDismiss);
  const swipeDismiss=useSheetSwipeDismiss(onClose);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div {...motionProps} className="shortcut-backdrop month-summary-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div {...swipeDismiss} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Chọn tháng trên biểu đồ" className="shortcut-sheet month-picker-sheet" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
      <div className="shortcut-handle" />
      <div className="shortcut-heading shortcut-heading-with-close month-summary-popup-heading">
        <div><strong>Chọn tháng trên biểu đồ</strong><span className="t3">Chạm vào tháng sau khi chọn để mở tóm tắt</span></div>
        <button type="button" className="shortcut-icon-close" aria-label="Đóng" onClick={onClose}>×</button>
      </div>
      <div className="month-picker-list">
        {summaryMonthGroups(options).map(group => <section key={group.year} className="month-picker-year" aria-label={`Năm ${group.year}`}>
          <div className="lbl">{group.year}</div>
          <div className="month-picker-grid">
            {group.months.map(option => <button key={option.period} type="button" className={option.period === current ? 'on' : ''} aria-pressed={option.period === current} onClick={() => exit(()=>onChoose(option))}>{option.label || monthLabel(option.period)}</button>)}
          </div>
        </section>)}
      </div>
    </div>
  </div>, document.body);
}

export function MonthlySummaryReadout({ value, c, months = [], onMonthSelect }: { value?: string; c: Ctx; months?: MonthOption[]; onMonthSelect?: (index: number) => void }) {
  const [summaryPeriod, setSummaryPeriod] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const period = monthFromReadout(value);
  return <>
    <DetailChartReadout value={value}
      onPeriodTap={period ? () => setSummaryPeriod(period) : undefined}
      onPeriodLongPress={period && months.length && onMonthSelect ? () => setPickerOpen(true) : undefined}
    />
    {pickerOpen && period && <MonthPickerPopup current={period} options={months} onClose={() => setPickerOpen(false)} onChoose={selected => { setPickerOpen(false); onMonthSelect?.(selected.index); }} />}
    {!pickerOpen && summaryPeriod && <MonthSummaryPopup period={summaryPeriod} c={c} onClose={() => setSummaryPeriod(null)} />}
  </>;
}
