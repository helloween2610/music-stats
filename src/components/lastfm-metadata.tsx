import { useEffect, useState } from 'react';
import { discoveryGet } from '@/lib/discovery';
import { LastfmListenRatio } from './lastfm-track-metrics';

type Stats = { status: 'found' | 'not_found'; listeners?: number; scrobbles?: number; updatedAt: string };
const cache = new Map<string, { value: Stats; expires: number }>();
export function LastfmMetadata({ trackId }: { trackId?: string }) {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  useEffect(() => {
    setData(null); setError('');
    if (!trackId || !/^TR\d+$/.test(trackId)) return;
    const hit = cache.get(trackId);
    if (hit && hit.expires > Date.now()) { setData(hit.value); return; }
    const controller = new AbortController();
    discoveryGet('/lastfm/' + encodeURIComponent(trackId), controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (!['found', 'not_found'].includes(value.status) || !Number.isFinite(Date.parse(value.updatedAt)) ||
        (value.status === 'found' && ![value.listeners, value.scrobbles].every(n => Number.isSafeInteger(n) && n >= 0))) throw Error('Last.fm trả dữ liệu chưa hợp lệ.');
      cache.set(trackId, { value, expires: Date.now() + (value.status === 'found' ? 86400 : 3600) * 1000 });
      setData(value);
    }).catch(e => {
      if (!controller.signal.aborted) { setError(e.message || 'Chưa tải được dữ liệu.'); setRetryAt(e.retryAt || Date.now() + 30000); }
    });
    return () => controller.abort();
  }, [trackId, attempt]);
  if (!trackId || !/^TR\d+$/.test(trackId)) return null;
  const metric = (label: string, value?: number, showRatio=false) => <div className="stat-box">
    <div className="num lastfm-stat-value" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>
      {showRatio ? (data?.listeners ? <LastfmListenRatio scrobbles={data.scrobbles} listeners={data.listeners}/> : '–') : <span>{value == null ? '–' : value.toLocaleString('vi-VN')}</span>}
    </div>
    <div className="t2" style={{ fontSize: "var(--type-caption, 11px)", marginTop: 4 }}>{label}</div>
  </div>;
  return <>
    <div aria-label="Số liệu cộng đồng Last.fm" aria-live="polite" style={{ margin: '8px 16px 0', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
      {metric('Scrobble · Last.fm', data?.scrobbles)}
      {metric('Lượt nghe / người · Last.fm', undefined, true)}
    </div>
    {data?.status !== 'found' && <div className="sub13" role="status" style={{ margin: '8px 16px 0' }}>
        {error || (data ? 'Chưa có dữ liệu cho bài này trên Last.fm.' : 'Đang tải số liệu Last.fm…')}
        {error && <button type="button" className="pill-outline" style={{ marginLeft: 8 }} onClick={() => {
          if (Date.now() >= retryAt) setAttempt(n => n + 1);
          else setError('Vui lòng chờ ' + Math.ceil((retryAt - Date.now()) / 1000) + ' giây rồi thử lại.');
        }}>Thử lại</button>}
    </div>}
  </>;
}
