// Item 97 ticket 02 part C. ISO week helpers. All arithmetic is UTC with a fixed +5 h shift
// (Asia/Yekaterinburg has no DST), so results never depend on the machine time zone.

const EKB_OFFSET_MS = 5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
/** First week an admin may pick (the contractor-invoice start). */
const FIRST_WEEK = '2026-W43';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** UTC midnight of the Monday of ISO week `year`-W`week`. */
function mondayOf(year: number, week: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
  return jan4 - jan4Dow * DAY_MS + (week - 1) * 7 * DAY_MS;
}

/** ISO week label 'YYYY-Www' of the UTC-midnight-based day `dayMs` (Thursday rule). */
function weekOfDay(dayMs: number): string {
  const dow = (new Date(dayMs).getUTCDay() + 6) % 7;
  const thursday = dayMs - dow * DAY_MS + 3 * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${pad2(week)}`;
}

const ddmm = (ms: number) => `${pad2(new Date(ms).getUTCDate())}.${pad2(new Date(ms).getUTCMonth() + 1)}`;

/** '2026-W44' -> '44 · 26.10–01.11' (week number, Monday–Sunday). */
export function isoWeekLabel(week: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return week;
  const monday = mondayOf(Number(m[1]), Number(m[2]));
  return `${m[2]} · ${ddmm(monday)}–${ddmm(monday + 6 * DAY_MS)}`;
}

/** Weeks an admin can pick: from the week after the current Ekb week down to 2026-W43, newest first. */
export function selectableWeeks(nowMs: number): string[] {
  const ekbNow = nowMs + EKB_OFFSET_MS;
  const today = Math.floor(ekbNow / DAY_MS) * DAY_MS;
  const nextWeekDay = today + 7 * DAY_MS;
  const result: string[] = [];
  for (let day = nextWeekDay; ; day -= 7 * DAY_MS) {
    const label = weekOfDay(day);
    if (label < FIRST_WEEK) break;
    result.push(label);
    if (label === FIRST_WEEK) break;
  }
  return result;
}

/** «Неделя» filter options: 2026-W43 up to the current Ekb week plus any earlier week present on postings, newest first. */
export function weekFilterOptions(present: string[], nowMs: number): string[] {
  const current = weekOfDay(Math.floor((nowMs + EKB_OFFSET_MS) / DAY_MS) * DAY_MS);
  return Array.from(new Set([...selectableWeeks(nowMs), ...present]))
    .filter((w) => w <= current)
    .sort()
    .reverse();
}
