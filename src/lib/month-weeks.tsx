import { useState } from "react";
import { addDays, dm, dow, vn } from "./fmt";

const DAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const COLORS = ["#3274d9", "#009c8b", "#b38800", "#d66513", "#a54caf", "#008bb5"];
export type MonthWeek = { start: string; label: string; dates: (string | null)[]; values: (number | null)[]; color: string };

// Chỉ chia dữ liệu của tháng đang xem; không biến ngày ngoài tháng/chưa tới thành 0 lượt.
export function monthWeeks(month: string, asOf: string, days: number[]): MonthWeek[] {
  const first = `${month}-01`, last = addDays(`${month}-${days.length}`, 0);
  const weeks: MonthWeek[] = [];
  for (let start = addDays(first, -(dow(first) + 6) % 7); start <= last && start <= asOf; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    const dates = DAYS.map((_, i) => {
      const date = addDays(start, i);
      return date >= first && date <= last && date <= asOf ? date : null;
    });
    weeks.push({ start, label: `${dm(start)}–${dm(end)}`, dates,
      values: dates.map(date => date ? days[Number(date.slice(8)) - 1] ?? 0 : null), color: COLORS[weeks.length] });
  }
  return weeks;
}

export function stackMonthWeeks(weeks: MonthWeek[]) {
  const totals = Array<number>(7).fill(0);
  const layers = weeks.map(week => {
    const lower = totals.slice();
    week.values.forEach((value, i) => { totals[i] += value ?? 0; });
    return { week, lower, upper: totals.slice() };
  });
  return { layers, totals };
}

export function MonthWeeksChart({ weeks }: { weeks: MonthWeek[] }) {
  const { layers, totals } = stackMonthWeeks(weeks);
  const [selected, select] = useState<number | null>(null);
  const toggleDay = (day: number) => select(current => current === day ? null : day);
  const width = 342, height = 180, left = 8, right = 308, top = 12, bottom = 156;
  const peak = Math.max(1, ...totals);
  // Keep the vertical scale tied to the busiest weekday instead of rounding it
  // up to a coarse power-of-ten ceiling that can flatten the whole month.
  const max = peak;
  const x = (i: number) => left + i * (right - left) / 6;
  const y = (value: number) => bottom - value / max * (bottom - top);
  return <>
    <div className="month-weeks-legend" aria-live="polite">
      {weeks.map(week => <div key={week.start} title={selected === null ? `${week.label} · tổng lượt trong tháng đang xem` : week.dates[selected] ? `${dm(week.dates[selected])} · ${vn(week.values[selected]!)} lượt` : "Ngoài tháng hoặc chưa tới ngày"}>
        <span className="month-weeks-dot" style={{ background: week.color }} />
        <span>{week.label}</span>
        <strong className="num">{selected === null ? vn(week.values.reduce<number>((sum,value)=>sum+(value??0),0)) : week.values[selected] == null ? "–" : vn(week.values[selected]!)}<span className="t3"> lượt</span></strong>
      </div>)}
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }} role="group" aria-label="Lượt nghe theo thứ, xếp chồng các tuần trong tháng">
      {[0, 1, 2, 3].map(i => <g key={i}>
        <line x1={left} x2={right} y1={y(max * i / 3)} y2={y(max * i / 3)} stroke="var(--line)" />
        <text x={width} y={y(max * i / 3) + 3} textAnchor="end" fontSize="10" fill="var(--text3)">{vn(max * i / 3)}</text>
      </g>)}
      {selected !== null && <line x1={x(selected)} x2={x(selected)} y1={top} y2={bottom} stroke="var(--text3)" strokeDasharray="3 4" opacity="0.5" />}
      {layers.map(({ week, lower, upper }) => {
        const points = upper.map((value, i) => ({ x: x(i), y: y(value), day: i }));
        const base = lower.map((value, i) => ({ x: x(i), y: y(value) })).reverse();
        // Hai biên dùng cùng phép nội suy: các lớp luôn tiếp giáp, không chồng lấn.
        const curve = (vertices: { x: number; y: number }[], move: string) => vertices.reduce((d, point, i) => {
          if (!i) return `${move}${point.x},${point.y}`;
          const prev = vertices[i - 1], mid = (prev.x + point.x) / 2;
          return `${d} C${mid},${prev.y} ${mid},${point.y} ${point.x},${point.y}`;
        }, "");
        const path = curve(points, "M");
        return <g key={week.start}>
          <path d={`${path} ${curve(base, "L")} Z`} fill={week.color} fillOpacity="0.28" />
          <path d={path} fill="none" stroke={week.color} strokeWidth="2" strokeLinecap="round" />
          {points.filter(point => week.values[point.day] != null).map(point => <circle key={point.day} cx={point.x} cy={point.y} r={point.day === selected ? 4 : 2} fill={week.color} stroke="var(--surface)" strokeWidth={point.day === selected ? 1.5 : 0}>
            <title>{dm(week.dates[point.day])} · {vn(week.values[point.day]!)} lượt</title>
          </circle>)}
        </g>;
      })}
      {DAYS.map((day, i) => <g key={day} role="button" tabIndex={0} aria-label={`So sánh ${day}`} aria-pressed={selected === i}
        onClick={() => toggleDay(i)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleDay(i); } }} style={{ cursor: "pointer" }}>
        <rect x={Math.max(0, x(i) - 25)} y="0" width={i === 0 ? 33 : 50} height={height} fill="transparent" />
        <text x={x(i)} y="175" textAnchor="middle" fontSize="11" fontWeight={selected === i ? 700 : 400} fill={selected === i ? "var(--text)" : "var(--text3)"}>{day}</text>
      </g>)}
    </svg>
    {selected !== null && <div className="month-weeks-hint"><strong className="num">{DAYS[selected]} · Tổng {vn(totals[selected])} lượt</strong></div>}
  </>;
}
