import { useEffect, useState } from "react";
import { songHistoryChart } from "@/lib/charts";
import { mlab, monthsBack } from "@/lib/fmt";
import { songRankTimeline } from "@/lib/song-rank-history";

export function SongMonthlyHistoryChart({ detail, className, height = 150 }: { detail: any; className?: string; height?: number }) {
  const rawMonths = Array.isArray(detail?.months) ? detail.months : [];
  const latest = rawMonths.length ? String(rawMonths[rawMonths.length - 1]?.month || "").slice(0, 7) : "";
  const first = rawMonths.length ? String(rawMonths[0]?.month || "").slice(0, 7) : "";
  const monthCount = /^\d{4}-\d{2}$/.test(first) && /^\d{4}-\d{2}$/.test(latest)
    ? Math.max(1, (Number(latest.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(latest.slice(5, 7)) - Number(first.slice(5, 7)) + 1)
    : 0;
  const months = monthCount ? monthsBack(latest, monthCount) : [];
  const plays = months.map(month => Number(rawMonths.find((row: any) => String(row.month).slice(0, 7) === month)?.plays) || 0);
  const timeline = months.length ? songRankTimeline(detail?.rankHistory || [], `${latest}-28`, detail?.allTime?.rank) : { labels: [], ranks: [] as (number | null)[] };
  const rankByMonth = new Map<string, number | null>();
  timeline.labels.forEach((label, index) => {
    const match = /^(\d{2})\/(\d{2})$/.exec(label);
    if (match) rankByMonth.set(`20${match[2]}-${match[1]}`, timeline.ranks[index] ?? null);
  });
  const ranks = months.map((month, index) => index === months.length - 1 ? Number(detail?.allTime?.rank) || rankByMonth.get(month) || null : rankByMonth.get(month) ?? null);
  const [selected, setSelected] = useState(Math.max(0, months.length - 1));
  useEffect(() => setSelected(Math.max(0, months.length - 1)), [detail?.track?.id, months.length]);
  if (!months.length) return null;
  const index = Math.min(selected, months.length - 1);
  return <div className={className}>{songHistoryChart(plays, ranks, months.map(mlab), {
    h: height,
    currentRank: detail?.allTime?.rank,
    sel: index,
    onSel: setSelected,
    valueSuffix: "x",
  })}</div>;
}
