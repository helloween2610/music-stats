// When the cron syncs Last.fm (Vietnam time). The trigger fires every hour; other hours do nothing.
// Weekdays: 0h, 7h, 9h, 12h–14h, 18h, 20h–23h. Saturday / Sunday: 0h, 2h, 7h, 9h, 11h–23h.
// The app's sync button (POST /sync) works at any time.
const WEEKDAY_HOURS = [0, 7, 9, 12, 13, 14, 18, 20, 21, 22, 23];
const WEEKEND_HOURS = [0, 2, 7, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

export function isSyncHour(now = new Date()) {
  const vn = new Date(now.getTime() + 7 * 3600 * 1000 + 5 * 60 * 1000); // +5 min: a late trigger still counts
  const day = vn.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const hours = day === 0 || day === 6 ? WEEKEND_HOURS : WEEKDAY_HOURS;
  return hours.includes(vn.getUTCHours());
}
