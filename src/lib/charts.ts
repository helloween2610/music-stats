// Biểu đồ SVG nhẹ, vẽ theo token màu (var(--…)). Biểu đồ chỉ tương tác khi có onSel.
import { createElement as h, ReactNode } from "react";
import { vn } from "./fmt";

type Sel = (i: number) => void;
type Any = any;

const TXT = { fill: "var(--text3)", fontSize: "var(--chart-font-size, 10px)", fontFamily: "-apple-system,Roboto,system-ui,sans-serif", fontVariantNumeric: "tabular-nums" };
const lbl = (x: number, y: number, t: ReactNode, a = "middle", ex: Any = {}) =>
  h("text", { x, y, textAnchor: a, style: { ...TXT, ...ex } }, t);
const frame = (W: number, H: number, k: ReactNode[], attrs: Any = {}) =>
  h("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", style: { display: "block", overflow: "visible" }, ...attrs }, ...k);
const niceMax = (v: number) => {
  const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * p >= v) as number) * p;
};
const hit = (x: number, w: number, H: number, i: number, on: Sel) =>
  h("rect", { x, y: 0, width: w, height: H, onClick: () => on(i), style: { fill: "transparent", cursor: "pointer" } });

function grid(W: number, top: number, bot: number, max: number, n: number, tf: (v: number) => string = vn) {
  const k: ReactNode[] = [];
  for (let i = 0; i <= n; i++) {
    const y = bot - ((bot - top) * i) / n;
    k.push(h("line", { x1: 0, x2: W - 26, y1: y, y2: y, style: { stroke: "var(--line)", strokeWidth: 1 } }));
    k.push(lbl(W, y + 3, tf((max * i) / n), "end"));
  }
  return k;
}

export function vbars(vals: number[], labels: string[], o: Any = {}) {
  const W = o.w || 342, H = o.h || 140, top = 8, bot = H - 18, pw = W - 30, n = vals.length, step = pw / n, bw = Math.max(2, step * (o.fill || 0.64));
  const max = o.exactMax || niceMax(o.cap || Math.max(1, ...vals)), k = grid(W, top, bot, max, o.w && o.w < 200 ? 2 : 3);
  vals.forEach((v, i) => {
    const x = i * step + (step - bw) / 2, over = v > max, hh = (Math.min(v, max) / max) * (bot - top), y = bot - hh, dim = o.sel != null && o.sel !== i;
    k.push(h("rect", { x, y, width: bw, height: Math.max(hh, v > 0 ? 1.5 : 0), rx: Math.min(2, bw / 2), style: { fill: (o.colors && o.colors[i]) || "var(--accent)", opacity: dim ? 0.38 : 1 } }));
    if (over) {
      k.push(h("rect", { x: x - 1, y: y + 12, width: bw + 2, height: 3, style: { fill: "var(--surface)" } }));
      k.push(lbl(x + bw / 2 + 2, y - 4, vn(v), "start", { fill: "var(--text2)", fontWeight: 600 }));
    }
    if (labels[i]) k.push(lbl(x + bw / 2, H - 4, labels[i]));
  });
  if (o.onSel) vals.forEach((_, i) => k.push(hit(i * step, step, H, i, o.onSel)));
  return frame(W, H, k);
}

// Đồng hồ 24 giờ: 00 ở trên, 06 bên phải, 12 ở dưới, 18 bên trái.
// Mỗi múi có góc bằng nhau; chiều cao thanh biểu diễn số lượt nghe.
export function listeningClock(vals: number[], o: { sel?: number; onSel?: Sel; compact?: boolean }) {
  const size = 320, center = 160, inner = 62, outer = 150;
  const hours = Array.from({ length: 24 }, (_, i) => Math.max(0, Number(vals[i]) || 0));
  const max = Math.max(1, ...hours);
  const point = (radius: number, degrees: number) => {
    const angle = (degrees - 90) * Math.PI / 180;
    return [center + radius * Math.cos(angle), center + radius * Math.sin(angle)];
  };
  const sector = (hour: number, radius: number) => {
    const start = hour * 15 + 0.7, end = (hour + 1) * 15 - 0.7;
    const a = point(inner, start), b = point(radius, start), c = point(radius, end), d = point(inner, end);
    return `M ${a} L ${b} A ${radius} ${radius} 0 0 1 ${c} L ${d} A ${inner} ${inner} 0 0 0 ${a} Z`;
  };
  const k: ReactNode[] = [h("title", { key: "title" }, "Đồng hồ nghe nhạc 24 giờ")];
  hours.forEach((value, hour) => {
    const selected = hour === o.sel;
    const label = `${String(hour).padStart(2, "0")}:00–${String((hour + 1) % 24).padStart(2, "0")}:00 · ${vn(value)} lượt`;
    const interaction = o.onSel ? {
      role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": selected,
      "data-hour": hour, className: "listening-hour", style: { cursor: "pointer" },
      onClick: () => o.onSel!(hour),
      onKeyDown: (event: Any) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); o.onSel!(hour); }
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          const next = (hour + (event.key === "ArrowRight" ? 1 : 23)) % 24;
          o.onSel!(next);
          event.currentTarget.parentElement.querySelector(`[data-hour="${next}"]`)?.focus();
        }
      },
    } : {};
    k.push(h("g", { key: hour, ...interaction },
      h("title", null, label),
      h("path", { d: sector(hour, outer), className: "clock-track", fill: "var(--surface2)", stroke: selected ? "var(--accent)" : "none", strokeWidth: 1 }),
      value > 0 && h("path", { d: sector(hour, inner + (value / max) * (outer - inner)), fill: "var(--accent)", opacity: selected ? 1 : 0.55 }),
    ));
    const a = point(inner - (hour % 6 === 0 ? 13 : 8), hour * 15), b = point(inner - 4, hour * 15);
    k.push(h("line", { key: `tick-${hour}`, x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "var(--text3)", strokeWidth: hour % 6 === 0 ? 1.6 : 1, strokeLinecap: "round" }));
  });
  [0, 6, 12, 18].forEach(hour => {
    const [x, y] = point(34, hour * 15);
    k.push(h("text", { key: `label-${hour}`, x, y, textAnchor: "middle", dominantBaseline: "central", style: { ...TXT, fill: "var(--text2)", fontSize: `var(--clock-font-size, ${o.compact ? 18 : 12}px)` } }, String(hour).padStart(2, "0")));
  });
  return h("svg", { viewBox: `0 0 ${size} ${size}`, width: "100%", role: "group", "aria-label": "Đồng hồ nghe nhạc 24 giờ", style: { display: "block" } }, ...k);
}

const smoothPath = (points: [number, number][], curve = 0.26) => {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    const dx = (x1 - x0) * curve;
    d += ` C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`;
  }
  return d;
};

export function lineChart(series: Any[], labels: string[], o: Any = {}) {
  const W = o.w || 342, H = o.h || 140, n = labels.length;
  const legend = Array.isArray(o.legend) ? o.legend : [];
  let lx = 0, lr = 0;
  const legendItems = legend.map((it: Any) => {
    const text = String(it.name || ""), itemW = Math.min(170, 22 + text.length * 6.6);
    if (lx && lx + itemW > W - 28) { lr++; lx = 0; }
    const out = { ...it, x: lx, y: 13 + lr * 18, text };
    lx += itemW;
    return out;
  });
  const legendH = legendItems.length ? (lr + 1) * 18 + 8 : 0;
  const top = o.top ?? 10 + legendH, bot = H - 18, pw = W - 34;
  const max = o.exactMax ?? niceMax(o.max || Math.max(1, ...series.flatMap((s) => s.vals)));
  const X = (i: number) => 2 + (i * pw) / Math.max(1, n - 1), Y = (v: number) => bot - (v / max) * (bot - top);
  const k: ReactNode[] = [];
  legendItems.forEach((it: Any) => {
    k.push(h("circle", { cx: it.x + 5, cy: it.y - 3, r: 4, style: { fill: it.color, opacity: it.opacity ?? 1 } }));
    k.push(lbl(it.x + 14, it.y, it.text, "start", { fill: "var(--text3)", fontSize: 11, fontWeight: 600 }));
  });
  k.push(...(o.ticks ? o.ticks.flatMap((v:number) => [
    h("line",{x1:0,x2:W-26,y1:Y(v),y2:Y(v),style:{stroke:"var(--line)",strokeWidth:1}}),
    lbl(W,Y(v)+3,o.tf ? o.tf(v) : vn(v),"end"),
  ]) : grid(W, top, bot, max, 3, o.tf)));
  if (o.sel != null) k.push(h("line", { x1: X(o.sel), x2: X(o.sel), y1: top - 4, y2: bot, style: { stroke: "var(--text3)", strokeDasharray: "3 3" } }));
  const defs: ReactNode[] = [];
  series.forEach((s, si) => {
    const points = s.vals.map((v: number, i: number) => [X(i), Y(v)] as [number, number]);
    const pts = points.map((p) => `${p[0]},${p[1]}`).join(" ");
    const curved = o.smooth || s.smooth;
    const lineD = curved ? smoothPath(points, typeof curved === "number" ? curved : 0.26) : "";
    if (s.area) {
      const fillId = o.gradient && curved ? `lcg-${si}` : "";
      if (fillId) defs.push(h("linearGradient", { id: fillId, x1: "0", y1: top, x2: "0", y2: bot, gradientUnits: "userSpaceOnUse" },
        h("stop", { offset: "0%", stopColor: s.color, stopOpacity: s.areaOpacity ?? 0.18 }),
        h("stop", { offset: "100%", stopColor: s.color, stopOpacity: 0 })
      ));
      if (curved) k.push(h("path", { d: `${lineD} L${X(n - 1)},${bot} Q${X(n - 1)},${bot + 2} ${X(n - 1) - 8},${bot} L${X(0) + 8},${bot} Q${X(0)},${bot + 2} ${X(0)},${bot} Z`, style: { fill: fillId ? `url(#${fillId})` : s.color, opacity: fillId ? 1 : s.areaOpacity ?? 0.14 } }));
      else k.push(h("polygon", { points: `${X(0)},${bot} ${pts} ${X(n - 1)},${bot}`, style: { fill: s.color, opacity: s.areaOpacity ?? 0.14 } }));
    }
    if (curved) k.push(h("path", { d: lineD, style: { fill: "none", stroke: s.color, strokeWidth: s.w || 2, strokeLinejoin: "round", strokeLinecap: "round", opacity: s.opacity ?? 1, strokeDasharray: s.dash || undefined } }));
    else k.push(h("polyline", { points: pts, style: { fill: "none", stroke: s.color, strokeWidth: s.w || 2, strokeLinejoin: "round", strokeLinecap: "round", opacity: s.opacity ?? 1, strokeDasharray: s.dash || undefined } }));
    (s.dots || []).forEach((i: number) => k.push(h("circle", { cx: X(i), cy: Y(s.vals[i]), r: 3, style: { fill: "var(--surface)", stroke: s.color, strokeWidth: 1.5 } })));
    if (o.sel != null && s.select !== false) k.push(h("circle", { cx: X(o.sel), cy: Y(s.vals[o.sel]), r: 4.5, style: { fill: s.color, stroke: "var(--surface)", strokeWidth: 2 } }));
  });
  if (defs.length) k.unshift(h("defs", null, ...defs));
  labels.forEach((l, i) => { if (l) k.push(lbl(X(i), H - 4, l)); });
  if (o.onSel) {
    const st = pw / Math.max(1, n - 1);
    labels.forEach((_, i) => k.push(hit(X(i) - st / 2, st, H, i, o.onSel)));
  }
  return frame(W, H, k);
}

export function songHistoryChart(plays: number[], ranks: (number | null)[], labels: string[], o: Any = {}) {
  const W = o.w || 342, H = o.h || 188, n = Math.max(1, labels.length), left = 28, right = W - 32, top = 12, bot = H - 18;
  const secondary: (number | null)[] = Array.isArray(o.secondaryValues) ? o.secondaryValues : [];
  const playMax = o.valueMax || niceMax(Math.max(1, ...plays, ...secondary.filter((v): v is number => v != null && Number.isFinite(v))));
  const currentRank = Number(o.currentRank);
  const firstRank = ranks.find((rank): rank is number => rank != null && Number.isFinite(rank) && rank > 0);
  const rankThreshold = Math.max(2, Number(o.rankThreshold) || 100);
  const rankReference = firstRank || (Number.isFinite(currentRank) && currentRank > 0 ? currentRank : rankThreshold);
  const rankMax = rankReference <= rankThreshold ? rankThreshold : rankReference;
  const X = (i: number) => left + (i * (right - left)) / Math.max(1, n - 1);
  const playY = (v: number) => bot - (Math.min(playMax, Math.max(0, v)) / playMax) * (bot - top);
  const rankY = (v: number) => top + ((Math.min(rankMax, Math.max(1, v)) - 1) / Math.max(1, rankMax - 1)) * (bot - top);
  const playColor = o.playColor || "var(--song-history-plays)";
  const rankColor = o.rankColor || "var(--song-history-rank)";
  const secondaryColor = o.secondaryColor || "var(--text3)";
  const k: ReactNode[] = [];
  for (let i = 0; i <= 2; i++) {
    const y = bot - ((bot - top) * i) / 2;
    k.push(h("line", { x1: left, x2: right, y1: y, y2: y, style: { stroke: "var(--line)", strokeWidth: 1 } }));
    const valueLabel = o.valueFormatter ? o.valueFormatter((playMax * i) / 2) : vn((playMax * i) / 2);
    k.push(lbl(left - 5, y + 3, `${valueLabel}${o.valueSuffix || ""}`, "end", { fill: playColor }));
  }
  const hasCurrentRank = Number.isFinite(currentRank) && currentRank > 0;
  const rankMidpoint = rankMax <= 50
    ? Math.round((rankMax + 1) / 2)
    : Math.min(rankMax - 1, Math.max(50, Math.round(((rankMax + 1) / 2) / 25) * 25));
  const axisRanks = rankMax === rankThreshold
    ? [1, Math.round(rankThreshold / 2), rankThreshold]
    : [...new Set([1, rankMax > 2 ? rankMidpoint : rankMax, rankMax])];
  const currentY = hasCurrentRank ? rankY(currentRank) : null;
  axisRanks.filter((rank) => currentY == null || Math.abs(rankY(rank) - currentY) > 10)
    .forEach((rank) => k.push(lbl(W, rankY(rank) + 3, `#${rank}`, "end", { fill: rankColor })));
  if (hasCurrentRank) {
    k.push(h("text", { x: W, y: currentY! + 3, textAnchor: "end", "data-current-rank": "true", style: { ...TXT, fill: "var(--song-history-current-rank)", fontWeight: 800 } }, `#${currentRank}`));
  }
  const playPoints = plays.map((v, i) => [X(i), playY(v)] as [number, number]);
  const playPolyline = playPoints.map(([x, y]) => `${x},${y}`).join(" ");
  k.push(h("polygon", { points: `${left},${bot} ${playPolyline} ${right},${bot}`, style: { fill: playColor, opacity: 0.14 } }));
  k.push(h("polyline", { points: playPolyline, style: { fill: "none", stroke: playColor, strokeWidth: 2.2, strokeLinejoin: "round", strokeLinecap: "round", mixBlendMode: "screen" } }));
  if (secondary.length) {
    let secondaryPoints: string[] = [];
    const flushSecondary = () => {
      if (secondaryPoints.length > 1) k.push(h("polyline", { points: secondaryPoints.join(" "), style: { fill: "none", stroke: secondaryColor, strokeWidth: 1.7, strokeLinejoin: "round", strokeLinecap: "round" } }));
      secondaryPoints = [];
    };
    secondary.forEach((value, i) => {
      if (value == null || !Number.isFinite(value)) { flushSecondary(); return; }
      secondaryPoints.push(`${X(i)},${playY(value)}`);
    });
    flushSecondary();
  }
  let rankPoints: string[] = [];
  const flushRanks = () => {
    if (rankPoints.length > 1) k.push(h("polyline", { points: rankPoints.join(" "), style: { fill: "none", stroke: rankColor, strokeWidth: 2.2, strokeLinejoin: "round", strokeLinecap: "round", mixBlendMode: "screen" } }));
    rankPoints = [];
  };
  ranks.forEach((rank, i) => {
    if (rank == null || !Number.isFinite(rank) || rank <= 0) { flushRanks(); return; }
    rankPoints.push(`${X(i)},${rankY(rank)}`);
    k.push(h("circle", { cx: X(i), cy: rankY(rank), r: i === o.sel ? 4.2 : 2.2, style: { fill: rankColor, stroke: i === o.sel ? "var(--surface)" : "none", strokeWidth: 2 } }, h("title", null, `${labels[i]} · hạng #${rank}`)));
  });
  flushRanks();
  if (o.sel != null) {
    k.push(h("line", { x1: X(o.sel), x2: X(o.sel), y1: top - 4, y2: bot, style: { stroke: "var(--text3)", strokeDasharray: "3 3" } }));
    k.push(h("circle", { cx: X(o.sel), cy: playY(plays[o.sel] || 0), r: 4.5, style: { fill: playColor, stroke: "var(--surface)", strokeWidth: 2 } }));
    const secondaryValue = secondary[o.sel];
    if (secondaryValue != null && Number.isFinite(secondaryValue)) k.push(h("circle", { cx: X(o.sel), cy: playY(secondaryValue), r: 4.5, style: { fill: secondaryColor, stroke: "var(--surface)", strokeWidth: 2 } }));
  }
  const labelStep = Math.max(1, Math.ceil(labels.length / 5));
  labels.forEach((label, i) => {
    if (i === 0 || i === labels.length - 1 || i % labelStep === 0) k.push(lbl(X(i), H - 4, label));
  });
  if (o.onSel) {
    const step = (right - left) / Math.max(1, n - 1);
    labels.forEach((_, i) => k.push(hit(X(i) - step / 2, step, H, i, o.onSel)));
  }
  return frame(W, H, k, { role: "group", "aria-label": o.ariaLabel || "Lượt nghe và lịch sử hạng theo tháng" });
}

export function rankLine(vals: (number | null)[], labels: string[], o: Any = {}) {
  const W = o.w || 342, H = o.h || 150, top = 12, bot = H - 18, pw = W - 34, n = vals.length, mx = Math.max(4, niceMax(Math.max(...vals.filter((v): v is number => v != null))));
  const X = (i: number) => 2 + (i * pw) / Math.max(1, n - 1), Y = (r: number) => top + ((r - 1) / (mx - 1)) * (bot - top);
  const k: ReactNode[] = [];
  [1, Math.round(mx / 2), mx].forEach((r) => {
    k.push(h("line", { x1: 0, x2: W - 26, y1: Y(r), y2: Y(r), style: { stroke: "var(--line)" } }));
    k.push(lbl(W, Y(r) + 3, "#" + r, "end", { fill: o.color || "var(--song-history-rank)" }));
  });
  if (o.sel != null) k.push(h("line", { x1: X(o.sel), x2: X(o.sel), y1: top - 4, y2: bot, style: { stroke: "var(--text3)", strokeDasharray: "3 3" } }));
  let points: string[] = [];
  const flush = () => {
    if (points.length > 1) k.push(h("polyline", { points: points.join(" "), style: { fill: "none", stroke: o.color || "var(--accent)", strokeWidth: 2, strokeLinejoin: "round" } }));
    points = [];
  };
  vals.forEach((v, i) => {
    if (v == null) { flush(); return; }
    points.push(`${X(i)},${Y(v)}`);
    k.push(h("circle", { cx: X(i), cy: Y(v), r: i === o.sel ? 4.5 : 2.2, style: { fill: o.color || "var(--accent)", stroke: i === o.sel ? "var(--surface)" : "none", strokeWidth: 2 } }));
  });
  flush();
  labels.forEach((l, i) => { if (l) k.push(lbl(X(i), H - 4, l)); });
  if (o.onSel) {
    const st = pw / Math.max(1, n - 1);
    vals.forEach((_, i) => k.push(hit(X(i) - st / 2, st, H, i, o.onSel)));
  }
  return frame(W, H, k, { role: "group", "aria-label": o.ariaLabel || "Lịch sử hạng theo tháng" });
}

export function bump(series: Any[], labels: string[], options: { maxRank?: number; height?: number; width?: number; labelEvery?: number; fullLabels?: boolean; labelWidth?: number } = {}) {
  const lines = (name: string) => {
    const result: string[] = []; let line = '';
    for (const word of name.split(' ')) {
      if (line && line.length + word.length > 40) { result.push(line); line = ''; }
      line += (line ? ' ' : '') + word;
    }
    return [...result, line];
  };
  const N = options.maxRank || 10, n = labels.length;
  const rowHeight = options.fullLabels ? Math.max(30, ...series.map(s => lines(s.name).length * 14 + 6)) : 0;
  const labelWidth = options.labelWidth ?? (options.fullLabels ? 360 : options.width ? 180 : 112);
  const W = options.width || 342, H = Math.max(options.height || 250, rowHeight * N + 40), L = 4, R = W - labelWidth, top = 10, bot = H - 20;
  const X = (i: number) => L + (i * (R - L)) / Math.max(1, n - 1), Y = (r: number) => top + ((Math.min(r, N + 1) - 1) / N) * (bot - top);
  const k: ReactNode[] = [];
  for (let r = 1; r <= N; r++) if (!options.labelEvery || r === 1 || r % options.labelEvery === 0) k.push(h("line", { x1: L, x2: R, y1: Y(r), y2: Y(r), style: { stroke: "var(--line)" } }));
  series.slice().reverse().forEach((s) => {
    let points: string[] = [];
    const flush = () => {
      if (points.length > 1) k.push(h("polyline", { points: points.join(" "), style: { fill: "none", stroke: s.color, strokeWidth: 2, strokeLinejoin: "round" } }));
      points = [];
    };
    s.ranks.forEach((r: number | null, i: number) => {
      if (r == null || r > N) { flush(); return; }
      points.push(`${X(i)},${Y(r)}`);
      k.push(h("circle", { cx: X(i), cy: Y(r), r: 2.4, style: { fill: s.color } }, h("title", null, `${s.name} · ${labels[i]} · #${r}`)));
    });
    flush();
    const lr = s.ranks[n - 1];
    if (lr != null && lr <= N && (!options.labelEvery || lr === 1 || lr % options.labelEvery === 0)) {
      if (options.fullLabels) {
        const nameX=R+8+String(lr).length*9+8;
        k.push(h("text", {x:R+8,y:Y(lr)+4,textAnchor:"start",style:{...TXT,fill:"var(--text2)",fontSize:16,fontWeight:400}},
          h("tspan",{style:{fill:"var(--text3)",fontWeight:400}},`${lr}  `),
          ...lines(s.name).map((line,i)=>h("tspan",{x:nameX,dy:i?14:0,style:{fontWeight:700}},line))));
      }
      else k.push(lbl(R + 8, Y(lr) + 3.5, lr + "  " + (s.name.length > 15 ? s.name.slice(0, 14) + "…" : s.name), "start", { fill: "var(--text2)" }));
    }
  });
  const tick = Math.max(1, Math.ceil(n / (options.width ? 12 : 6)));
  labels.forEach((l, i) => { if ((i % tick === 0 && i < n - Math.max(1, tick / 2)) || i === n - 1) k.push(lbl(X(i), H - 4, l)); });
  return frame(W, H, k);
}

export function area(years: number[], series: Any[], o: Any = {}) {
  const W = o.w || 342, H = o.h || 160, top = 8, bot = H - 18, pw = W - 30, n = years.length;
  const tot = years.map((_, i) => series.reduce((a, s) => a + s.vals[i], 0)), max = niceMax(Math.max(...tot));
  const X = (i: number) => (i * pw) / Math.max(1, n - 1), Y = (v: number) => bot - (v / max) * (bot - top);
  const k = grid(W, top, bot, max, 2), cum = years.map(() => 0);
  series.forEach((s) => {
    const lo = cum.slice(), hi = cum.map((c, i) => c + s.vals[i]);
    k.push(h("polygon", { points: hi.map((v, i) => `${X(i)},${Y(v)}`).concat(lo.map((v, i) => `${X(i)},${Y(v)}`).reverse()).join(" "), style: { fill: s.color } }));
    hi.forEach((v, i) => { cum[i] = v; });
  });
  if (o.sel != null) k.push(h("line", { x1: X(o.sel), x2: X(o.sel), y1: top - 4, y2: bot, style: { stroke: "var(--text)", strokeWidth: 1.5 } }));
  years.forEach((y, i) => { if (y % 10 === 0) k.push(lbl(X(i), H - 4, String(y))); });
  if (o.onSel) {
    const st = pw / Math.max(1, n - 1);
    years.forEach((_, i) => k.push(hit(X(i) - st / 2, st, H, i, o.onSel)));
  }
  return frame(W, H, k);
}


export function listeningCalendar(days: Any[], o: Any = {}) {
  const W = o.w || 1100, cell = o.cell || 16, gap = o.gap || 3, top = 34, left = 28;
  const monthNames = o.monthNames || ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const max = Math.max(1, ...days.map((d: Any) => d.value || 0));
  const monthX: Record<number, number> = {};
  const color = (v: number) => v <= 0 ? 'var(--surface2)' : v / max > .75 ? '#b9c5ff' : v / max > .5 ? '#6d73ff' : v / max > .25 ? '#4b42d8' : '#27245f';
  const k: ReactNode[] = [];
  days.forEach((d: Any) => {
    const x = left + d.week * (cell + gap), y = top + d.weekday * (cell + gap);
    if (monthX[d.month] == null) monthX[d.month] = x;
    k.push(h('rect', { x, y, width: cell, height: cell, rx: 2, style: { fill: color(d.value || 0), stroke: 'rgba(0,0,0,.28)', strokeWidth: 1 } }, h('title', null, `${d.label} · ${vn(d.value || 0)} lượt`)));
  });
  Object.keys(monthX).forEach(m => k.push(lbl(monthX[Number(m)], 20, monthNames[Number(m)], 'start', { fill: 'var(--text2)', fontSize: 13, fontWeight: 700 })));
  k.push(lbl(10, top + 3.5 * (cell + gap), o.year || '', 'middle', { transform: `rotate(-90 10 ${top + 3.5 * (cell + gap)})`, fill: 'var(--text2)', fontSize: 13, fontWeight: 700 }));
  return frame(W, top + 7 * (cell + gap) + 6, k);
}

export function tagStream(years: number[], series: Any[], o: Any = {}) {
  const W = o.w || 1100, H = o.h || 250, top = 22, bot = H - 34, pw = W - 36, n = years.length;
  const shown = series.filter((s: Any) => s.vals.some((v: number) => v > 0)).slice(0, o.limit || 7);
  const totals = years.map((_, i) => shown.reduce((a: number, s: Any) => a + (s.vals[i] || 0), 0));
  const max = Math.max(1, ...totals);
  const X = (i: number) => 18 + (i * pw) / Math.max(1, n - 1), Y = (v: number) => (top + bot) / 2 - (v / max) * ((bot - top) * .82);
  const k: ReactNode[] = [h('line', { x1: 0, x2: W, y1: top - 12, y2: top - 12, style: { stroke: 'var(--line)' } })];
  const offsets = years.map((_, i) => -totals[i] / 2);
  shown.forEach((s: Any) => {
    const lo = offsets.slice(), hi = offsets.map((v, i) => v + (s.vals[i] || 0));
    k.push(h('polygon', { points: hi.map((v, i) => `${X(i)},${Y(v)}`).concat(lo.map((v, i) => `${X(i)},${Y(v)}`).reverse()).join(' '), style: { fill: s.color, opacity: .9, stroke: 'rgba(0,0,0,.35)', strokeWidth: 1 } }));
    let best = 0;
    s.vals.forEach((v: number, i: number) => { if (v > (s.vals[best] || 0)) best = i; offsets[i] = hi[i]; });
    if ((s.vals[best] || 0) > 0) k.push(lbl(X(best), Y((lo[best] + hi[best]) / 2) + 4, s.name, 'middle', { fill: '#fff', fontSize: 13, fontWeight: 800 }));
  });
  const step = Math.max(1, Math.ceil(years.length / 10));
  years.forEach((y, i) => { if (i % step === 0 || i === years.length - 1) k.push(lbl(X(i), H - 7, String(y), 'middle', { fill: 'var(--text3)', fontSize: 12 })); });
  return frame(W, H, k);
}

export function artistMapChart(countries: Any[], o: Any = {}) {
  const W = o.w || 1100, H = o.h || 360, max = Math.max(1, ...countries.map((c: Any) => c.value || 0));
  const xy: Record<string, [number, number]> = { US:[230,155], CA:[215,100], BR:[365,230], AR:[345,285], GB:[520,120], IE:[500,122], FR:[535,150], DE:[565,140], NL:[552,132], SE:[590,94], FI:[620,82], NO:[575,78], DK:[570,118], IT:[575,175], GR:[610,190], RU:[720,95], CN:[820,165], JP:[915,170], KR:[885,165], IN:[745,210], VN:[820,225], AU:[910,285], NZ:[995,315], FO:[515,94] };
  const blobs = [
    'M145 135 C185 90 270 88 310 130 C275 155 265 205 215 205 C170 200 125 175 145 135Z',
    'M440 120 C490 70 655 70 690 135 C655 170 590 168 565 210 C505 198 440 170 440 120Z',
    'M665 120 C760 70 930 92 970 160 C900 190 820 175 760 225 C710 210 650 170 665 120Z',
    'M790 250 C850 220 960 235 990 292 C925 330 830 325 790 250Z',
    'M315 205 C365 215 405 260 385 318 C335 303 300 250 315 205Z',
  ];
  const k: ReactNode[] = [h('rect', { x: 0, y: 0, width: W, height: H, rx: 16, style: { fill: 'transparent' } })];
  blobs.forEach((d, i) => k.push(h('path', { d, style: { fill: i === 3 ? '#0d263c' : '#0a2034', stroke: '#06111d', strokeWidth: 1 } })));
  countries.forEach((c: Any) => {
    const p = xy[c.code]; if (!p) return;
    const r = 5 + Math.sqrt((c.value || 0) / max) * 18;
    k.push(h('circle', { cx: p[0], cy: p[1], r, style: { fill: '#4aa3ff', opacity: .35 } }, h('title', null, `${c.name} · ${vn(c.value || 0)} nghệ sĩ`)));
    k.push(h('circle', { cx: p[0], cy: p[1], r: Math.max(3, r * .35), style: { fill: '#8fc8ff' } }));
  });
  const lead = countries[0];
  if (lead) k.push(lbl(40, H - 36, `Top country · ${lead.name}`, 'start', { fill: 'var(--text2)', fontSize: 16, fontWeight: 700 }), lbl(40, H - 12, `${lead.topArtist || vn(lead.value) + ' nghệ sĩ'}`, 'start', { fill: 'var(--text)', fontSize: 22, fontWeight: 800 }));
  else k.push(lbl(W / 2, H / 2, 'Cần metadata quốc gia của artist để vẽ Artist Map', 'middle', { fill: 'var(--text3)', fontSize: 18, fontWeight: 700 }));
  return frame(W, H, k);
}

// Cột nhóm 7 ngày: trung bình cùng thứ · tuần trước · tuần này.
export function grouped(days: Any[], o: Any = {}) {
  const W = 342, H = 150, top = 18, bot = H - 20, pw = W - 30, step = pw / 7, bw = 10, cols = ["var(--c2)", "var(--text3)", "var(--accent)"];
  const vals = days.filter((d) => d.v).flatMap((d) => d.v);
  const max = niceMax(Math.max(1, ...vals)), k = grid(W, top, bot, max, 3);
  days.forEach((d, i) => {
    const cx = i * step + step / 2, dim = o.sel != null && o.sel !== i;
    if (d.v) d.v.forEach((v: number | null, j: number) => {
      if (v == null) return;
      const hh = (v / max) * (bot - top), x = cx - 16 + j * 11;
      k.push(h("rect", { x, y: bot - hh, width: bw, height: hh, rx: 2, style: { fill: cols[j], opacity: dim ? 0.38 : 1 } }));
      if (i === o.today && j === 2) k.push(lbl(x + bw / 2, Math.max(12, bot - hh - 5), String(v), "middle", { fill: cols[j], fontWeight: 700 }));
    });
    else k.push(h("rect", { x: cx - 10, y: bot - 2, width: 20, height: 2, rx: 1, style: { fill: "var(--line)" } }));
    k.push(lbl(cx, H - 4, d.l, "middle", o.sel === i ? { fill: "var(--text)", fontWeight: 700 } : {}));
  });
  if (o.onSel) days.forEach((_, i) => k.push(hit(i * step, step, H, i, o.onSel)));
  return frame(W, H, k, { className: "weekly-grouped-chart" });
}

export function spark(vals: number[], o: Any = {}) {
  if (!vals.length) return null;
  const w = o.w || 52, hh = o.h || 18, inv = o.inv !== false, mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1, c = o.color || "var(--text2)";
  const P = vals.map((v, i) => [(i * (w - 4)) / Math.max(1, vals.length - 1) + 2, (inv ? (v - mn) / r : 1 - (v - mn) / r) * (hh - 4) + 2]);
  const last = P[P.length - 1];
  return h("svg", { width: o.full ? "100%" : w, height: hh, viewBox: `0 0 ${w} ${hh}`, preserveAspectRatio: "none", style: { display: "block", overflow: "visible" } },
    h("polyline", { points: P.map((p) => p.join(",")).join(" "), style: { fill: "none", stroke: c, strokeWidth: o.sw || 1.5, strokeLinejoin: "round", strokeLinecap: "round", vectorEffect: "non-scaling-stroke" } }),
    h("circle", { cx: last[0], cy: last[1], r: 2, style: { fill: c } }));
}

// Sparkline hạng có khoảng trống (tháng không có hạng = null).
export function sparkGap(vals: (number | null)[], o: Any = {}) {
  if (o.trimLeading) vals = vals.slice(Math.max(0, vals.findIndex(v => v != null)));
  const w = o.w || 52, hh = o.h || 18, nn = vals.filter((v) => v != null) as number[];
  if (!nn.length) return null;
  const mn = Math.min(...nn), mx = Math.max(...nn), r = mx - mn || 1, c = o.color || "var(--text2)";
  const X = (k: number) => (k * (w - 4)) / Math.max(1, vals.length - 1) + 2, Y = (v: number) => ((v - mn) / r) * (hh - 4) + 2;
  const segs: number[][][] = [];
  let cur: number[][] = [];
  vals.forEach((v, k) => {
    if (v == null) { if (cur.length) segs.push(cur); cur = []; }
    else cur.push([X(k), Y(v)]);
  });
  if (cur.length) segs.push(cur);
  let lk = vals.length - 1;
  while (lk > 0 && vals[lk] == null) lk--;
  return h("svg", { width: o.full ? "100%" : w, height: hh, preserveAspectRatio: o.full ? "none" : undefined, viewBox: `0 0 ${w} ${hh}`, style: { display: "block", overflow: "visible" } },
    ...segs.map((sg) => sg.length > 1
      ? h("polyline", { points: sg.map((q) => q.join(",")).join(" "), style: { fill: "none", stroke: c, strokeWidth: 1.5, vectorEffect: "non-scaling-stroke", strokeLinejoin: "round", strokeLinecap: "round" } })
      : h("circle", { cx: sg[0][0], cy: sg[0][1], r: 1.2, style: { fill: c } })),
    h("circle", { cx: X(lk), cy: Y(vals[lk] as number), r: 2, style: { fill: c } }));
}

export const bar = (pct: number, color = "var(--accent)", mt = 5) =>
  h("div", { style: { height: 4, borderRadius: 2, background: "var(--surface2)", marginTop: mt, overflow: "hidden" } },
    h("div", { style: { width: Math.max(0, Math.min(100, pct)) + "%", height: "100%", borderRadius: 2, background: color } }));

// Thay đổi hạng: số dương = lên hạng, "new" = mới vào.
export type Chg = number | "new";
const chgCol = (c: Chg) => (c === "new" ? "var(--new)" : c > 0 ? "var(--up)" : c < 0 ? "var(--down)" : "var(--text3)");
export const chgTxt = (c: Chg) => (c === "new" ? "mới vào" : c > 0 ? "▲" + c : c < 0 ? "▼" + -c : "giữ hạng");
export function chgEl(c: Chg) {
  const t = c === "new" ? "MỚI" : c > 0 ? "▲" + c : c < 0 ? "▼" + -c : "–";
  return h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.15, minWidth: 26 } },
    h("span", { style: { color: chgCol(c), fontSize: `var(--type-caption, ${c === "new" ? 9 : 11}px)`, fontWeight: 700, fontVariantNumeric: "tabular-nums" } }, t));
}
export const chgInline = (c: Chg) =>
  h("div", { style: { fontSize: 12, fontWeight: 700, color: chgCol(c) } }, c === "new" ? "MỚI" : c > 0 ? "▲" + c : c < 0 ? "▼" + -c : "–");
