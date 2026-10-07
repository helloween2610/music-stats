import { CSSProperties, ReactNode, useEffect, useRef } from "react";

type Any = any;

export function Flags({ hot, cold }: { hot?: boolean; cold?: boolean }) {
  return (
    <>
      {hot && <div className="flag-hot">*</div>}
      {cold && <div className="flag-cold">!!!</div>}
    </>
  );
}

// Ảnh bìa / avatar. Chưa có ảnh hoặc ảnh lỗi thì hiện chữ viết tắt.
export function Thumb({ ini, img, round, size = 40, style, label }: { ini: string; img?: string; round?: boolean; size?: number; style?: CSSProperties; label?: string }) {
  return (
    <div className={"thumb" + (round ? " round" : "")} style={{ width: size, height: size, position: "relative", overflow: "hidden", ...style }}>
      {label ?? ini}
      {img && (
        <img
          src={img}
          loading="lazy"
          alt=""
          crossOrigin="anonymous"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
    </div>
  );
}

export function Chips({ items, wrap, compact, style }: { items: { label: string; active: boolean; onTap: () => void }[]; wrap?: boolean; compact?: boolean; style?: CSSProperties }) {
  return (
    <div className={"chips" + (wrap ? " wrap" : "") + (compact ? " compact" : "")} style={style}>
      {items.map((c) => (
        <div key={c.label} className="chip-hit" onClick={c.onTap}>
          <div className={"chip" + (c.active ? " on" : "")}>{c.label}</div>
        </div>
      ))}
    </div>
  );
}

export function ScopeTabs({ items }: { items: { label: string; active: boolean; onTap: () => void }[] }) {
  return <div className="release-tabs scope-tabs" role="group" aria-label="Khoảng thời gian thống kê">
    {items.map(item => <button type="button" key={item.label} className={item.active ? 'on' : ''} aria-pressed={item.active} onClick={item.onTap}>{item.label}</button>)}
  </div>;
}

export function SegTabs({ items, scrollActive = false }: { items: { label: string; active: boolean; onTap: () => void }[]; scrollActive?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const activeLabel = items.find((item) => item.active)?.label;
  useEffect(() => {
    if (!scrollActive || !ref.current) return;
    const active = ref.current.querySelector<HTMLElement>(".seg-item.on");
    if (!active) return;
    ref.current.scrollLeft = Math.max(0, active.offsetLeft + active.offsetWidth - ref.current.clientWidth);
  }, [activeLabel, scrollActive]);
  return (
    <div className="seg" ref={ref}>
      {items.map((c) => (
        <div key={c.label} className={"seg-item" + (c.active ? " on" : "")} onClick={c.onTap}>
          {c.label}
        </div>
      ))}
    </div>
  );
}

export const Sec = ({ children, anchor }: { children: ReactNode; anchor?: string }) => (
  <div className="sec" data-anchor={anchor}>{children}</div>
);

export function SecLink({ title, link, onTap }: { title: ReactNode; link: ReactNode; onTap?: () => void }) {
  return (
    <div className="sec-row">
      <div className="sec">{title}</div>
      <div className="link" onClick={onTap}>{link}</div>
    </div>
  );
}

export function SecSide({ title, side, anchor }: { title: ReactNode; side: ReactNode; anchor?: string }) {
  return (
    <div className="sec-side" data-anchor={anchor}>
      <div className="sec">{title}</div>
      <div className="side">{side}</div>
    </div>
  );
}

export function ChartCard({ readout, children, style }: { readout?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="card pad" style={style}>
      {readout !== undefined && <div className="readout">{readout}</div>}
      {children}
    </div>
  );
}

export function SampleChip({ show, text }: { show?: boolean; text?: string }) {
  if (!show) return null;
  return (
    <div style={{ padding: "10px 16px 0", display: "flex" }}>
      <div className="sample-chip">{text || "Đang hiện dữ liệu đã lưu"}</div>
    </div>
  );
}

export function EmptyState({ title, note, action, iconOnly=false }: { title: string; note: string; action?: { label: string; onTap: () => void }; iconOnly?: boolean }) {
  return (
    <div role={iconOnly ? 'img' : undefined} aria-label={iconOnly ? title : undefined} style={{ padding: "22px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", gridColumn: iconOnly ? '1 / -1' : undefined }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", border: "1.5px dashed var(--text3)" }} />
      {!iconOnly && <div className="title15">{title}</div>}
      {!iconOnly && <div className="sub13 pretty">{note}</div>}
      {action && (
        <div onClick={action.onTap} style={{ padding: "4px 0", cursor: "pointer" }}>
          <div style={{ height: 36, lineHeight: "36px", padding: "0 14px", borderRadius: 999, background: "var(--surface2)", fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{action.label}</div>
        </div>
      )}
    </div>
  );
}

export const Spin = ({ size = 14 }: { size?: number }) => (
  <div className="spinner sm" style={{ width: size, height: size }} />
);

export function Legend({ items }: { items: { color: string; label: ReactNode }[] }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8, fontSize: "var(--type-caption, 11px)", color: "var(--text2)" }}>
      {items.map((it, k) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <div style={{ flex: "none", width: 8, height: 8, borderRadius: 2, background: it.color }} />
          <div className="ell">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

export function PartRows({ parts }: { parts: Any[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {parts.map((q) => (
        <div key={q.label} style={{ display: "grid", gridTemplateColumns: "112px minmax(0,1fr) 32px", gap: 8, alignItems: "center", fontSize: "var(--type-caption, 12px)", color: "var(--text2)" }}>
          <div>{q.label}</div>
          {q.bar}
          <div className="num" style={{ textAlign: "right", color: "var(--text)" }}>{q.v}</div>
        </div>
      ))}
    </div>
  );
}

export function LoadingView() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "64px 20px 32px" }}>
        <div className="spinner" />
        <div style={{ fontSize: 16, fontWeight: 600 }}>Đang tải dữ liệu…</div>
        <div className="sub13" style={{ textAlign: "center" }}>Lấy số liệu từ server, chỉ mất vài giây.</div>
      </div>
      <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="skel" style={{ height: 10, width: "30%" }} />
        <div className="skel" style={{ height: 36, width: "40%", borderRadius: 8 }} />
        <div className="skel" style={{ height: 10, width: "70%", opacity: 0.6 }} />
      </div>
      <div className="card" style={{ marginTop: 10, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {[1, 2, 3, 4].map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="skel" style={{ width: 40, height: 40, borderRadius: 6 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="skel" style={{ height: 10, width: "75%" }} />
              <div className="skel" style={{ height: 8, width: "45%", opacity: 0.6, borderRadius: 4 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
