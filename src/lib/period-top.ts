// A drill-down keeps its period even if the overview filter changes later.
export const SCOPE_ORDER = ["Tháng trước", "Tháng", "Năm", "All time"];
export const scopeValue = (scope: string, asOf: string) => {
  const prev = new Date(Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 1, 0)).toISOString().slice(0, 7);
  return ({ "All time": "all", "Từ 04/2024": "ft0424", "Năm": asOf.slice(0, 4), "Tháng": asOf.slice(0, 7), "Tháng trước": prev } as Record<string, string>)[scope] || scope;
};
export const periodLabel = (scope: string) => scope === "all" ? "All time" : scope === "week" ? "Tuần hiện tại" : scope === "15d" ? "15 ngày gần đây" : scope === "1m" ? "30 ngày gần đây" : scope === "ft0424" ? "Từ 04/2024" : scope.length === 4 ? `Năm ${scope}` : `Tháng ${Number(scope.slice(5, 7))}/${scope.slice(0, 4)}`;
export function topPeriod(id: string | null) {
  const [kind = "songs", scope = "week", asOf = ""] = (id || "").split("~");
  return { kind, scope, asOf, label: periodLabel(scope) };
}

export function periodTopTitle(id: string | null, filter = "Tất cả") {
  const t = topPeriod(id);
  const newlyAdded = t.kind !== "monthSongs" && t.kind !== "albums" && /^\d{4}(-\d{2})?$/.test(t.scope) && filter === "Mới thêm";
  const kind = t.kind === "albums" ? "album" : t.kind === "artists" ? "nghệ sĩ" : "bài hát";
  return `Top ${kind}${newlyAdded ? " mới thêm" : ""} · ${t.label}`;
}

// Compare calendar periods; cumulative tracking compares against the end of last month.
export function comparisonPeriod(scope: string, asOf: string) {
  if (/^\d{4}-\d{2}$/.test(scope)) {
    const end = new Date(Date.UTC(Number(scope.slice(0, 4)), Number(scope.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
    return { scope: end.slice(0, 7), asOf: end, label: periodLabel(end.slice(0, 7)) };
  }
  if (/^\d{4}$/.test(scope)) {
    const year = String(Number(scope) - 1);
    return { scope: year, asOf: `${year}-12-31`, label: periodLabel(year) };
  }
  const end = new Date(Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  return { scope, asOf: end, label: `cuối ${periodLabel(end.slice(0, 7)).toLowerCase()}` };
}
