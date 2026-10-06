export const PERIOD_LIST_OPTIONS = [25,50,100] as const;
export type PeriodListSize = typeof PERIOD_LIST_OPTIONS[number];
const KEY = 'music-stats:period-list-size';
export const periodListSize = (value:unknown):PeriodListSize => value===50 || value===100 ? value : 25;
export function readPeriodListSize():PeriodListSize {
  try { return periodListSize(Number(window.localStorage.getItem(KEY))); } catch { return 25; }
}
export function savePeriodListSize(value:PeriodListSize) {
  try { window.localStorage.setItem(KEY,String(periodListSize(value))); } catch {}
}
export const listDisplayLimit = (allTime:boolean, preference:unknown) => allTime ? 100 : periodListSize(preference);
