import { useEffect, useState, useSyncExternalStore } from 'react';
import { lastfmTrackRefreshSnapshot, loadLastfmTrack, subscribeLastfmTrackRefresh, type LastfmTrackStats } from '@/lib/discovery';
import { LastfmListenRatio } from './lastfm-track-metrics';

export function LastfmMetadata({ trackId }: { trackId?: string }) {
  const [data, setData] = useState<LastfmTrackStats | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const refreshVersion = useSyncExternalStore(subscribeLastfmTrackRefresh, lastfmTrackRefreshSnapshot, lastfmTrackRefreshSnapshot);
  useEffect(() => {
    setData(null); setError('');
    if (!trackId || !/^TR\d+$/.test(trackId)) return;
    const controller = new AbortController();
    loadLastfmTrack({artist:'',title:'',trackId}, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(e => {
      if (!controller.signal.aborted) { setError(e.message || 'Chưa tải được dữ liệu.'); setRetryAt(e.retryAt || Date.now() + 30000); }
    });
    return () => controller.abort();
  }, [trackId, attempt, refreshVersion]);
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
