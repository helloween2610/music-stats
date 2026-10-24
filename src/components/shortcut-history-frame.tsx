import type {ReactNode} from 'react';

export function ShortcutHistoryFrame({heading,weekly=false,loading=false,error=false,children}:{
  heading?:ReactNode;weekly?:boolean;loading?:boolean;error?:boolean;children?:ReactNode;
}) {
  return <div className={`shortcut-song-history-chart${weekly?' shortcut-artist-weekly-chart':''}`} aria-busy={loading || undefined}>
    {heading&&<div className="shortcut-artist-weekly-heading">{heading}</div>}
    <div className={`shortcut-history-body${weekly?' weekly':''}`}>
      {children || <div className="shortcut-history-placeholder" role="status">
        <span>{loading?'Đang tải lịch sử…':error?'Chưa tải được lịch sử.':'Chưa có lịch sử nghe.'}</span>
      </div>}
    </div>
  </div>;
}
