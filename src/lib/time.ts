/**
 * Everything time-related is anchored to Pakistan Standard Time, which is a
 * fixed UTC+5 with no daylight saving. That lets us treat a PKT wall clock as
 * a plain offset rather than pulling in a timezone database.
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Working day: Monday to Saturday. Sunday is off. */
const WORKING_DAYS = new Set([1, 2, 3, 4, 5, 6]);
/** Working hours, PKT. Matches the notification quiet window. */
export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 23;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * A Date shifted so its UTC getters read as PKT wall clock. Only ever used
 * through the helpers below — never render one directly.
 */
function toPkt(d: Date): Date {
  return new Date(d.getTime() + PKT_OFFSET_MS);
}

function fromPkt(shifted: Date): Date {
  return new Date(shifted.getTime() - PKT_OFFSET_MS);
}

export function pktHour(d: Date): number {
  return toPkt(d).getUTCHours();
}

export function pktWeekday(d: Date): number {
  return toPkt(d).getUTCDay();
}

export function isWorkingDay(d: Date): boolean {
  return WORKING_DAYS.has(pktWeekday(d));
}

/** True between 11pm and 8am PKT, or on a Sunday. Notifications wait. */
export function isQuietHours(d: Date): boolean {
  if (!isWorkingDay(d)) return true;
  const h = pktHour(d);
  return h < WORK_START_HOUR || h >= WORK_END_HOUR;
}

/** Start of the next working window at or after `d`. */
export function nextWorkingStart(d: Date): Date {
  const shifted = toPkt(d);
  const dayStart = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );

  for (let i = 0; i < 8; i++) {
    const candidateDay = new Date(dayStart + i * DAY_MS);
    if (!WORKING_DAYS.has(candidateDay.getUTCDay())) continue;
    const open = new Date(candidateDay.getTime() + WORK_START_HOUR * HOUR_MS);
    if (open.getTime() >= shifted.getTime()) return fromPkt(open);
    const close = new Date(candidateDay.getTime() + WORK_END_HOUR * HOUR_MS);
    if (shifted.getTime() < close.getTime()) return d; // already inside a window
  }
  return d;
}

/**
 * Milliseconds of working time between two instants, counting only Monday to
 * Saturday, 8am to 11pm PKT. This is what alert thresholds measure against,
 * so a client who writes at 2am on Sunday does not burn the clock overnight.
 */
export function workingMsBetween(from: Date, to: Date): number {
  if (to <= from) return 0;

  const startShifted = toPkt(from).getTime();
  const endShifted = toPkt(to).getTime();

  let total = 0;
  let dayCursor = Date.UTC(
    toPkt(from).getUTCFullYear(),
    toPkt(from).getUTCMonth(),
    toPkt(from).getUTCDate(),
  );

  while (dayCursor < endShifted) {
    const day = new Date(dayCursor);
    if (WORKING_DAYS.has(day.getUTCDay())) {
      const open = dayCursor + WORK_START_HOUR * HOUR_MS;
      const close = dayCursor + WORK_END_HOUR * HOUR_MS;
      const overlap =
        Math.min(close, endShifted) - Math.max(open, startShifted);
      if (overlap > 0) total += overlap;
    }
    dayCursor += DAY_MS;
  }
  return total;
}

export function workingHoursBetween(from: Date, to: Date): number {
  return workingMsBetween(from, to) / HOUR_MS;
}

/**
 * The failure clock. Terse by design: this is the loudest thing on the row and
 * it has to stay one glanceable token.
 */
export function formatClock(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 60_000) return "now";
  if (abs < HOUR_MS) return `${Math.floor(abs / 60_000)}m`;
  if (abs < 48 * HOUR_MS) return `${Math.floor(abs / HOUR_MS)}h`;
  return `${Math.floor(abs / DAY_MS)}d`;
}

export function elapsedSince(d: Date | null, now: Date): number {
  if (!d) return 0;
  return now.getTime() - d.getTime();
}

/** For timeline entries, where an exact moment matters more than a duration. */
export function formatPktDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Karachi",
  }).format(d);
}

/**
 * A deadline is meaningless without knowing whose Wednesday it is. Renders the
 * same instant in a second zone, for the title attribute on any timestamp
 * that involves a client deadline or a client message.
 */
export function formatInZone(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(d);
  } catch {
    // An unknown zone should never take a page down.
    return formatPktDateTime(d);
  }
}

/** Short zone name, e.g. "EST", for labelling the client's time. */
export function zoneAbbrev(d: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(d);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Both clocks in one string, for a tooltip: our time and theirs. Returns null
 * when the client zone is unknown or is the same as ours, so we never render
 * "Karachi time, and also Karachi time".
 */
export function bothZones(d: Date, clientZone: string | null): string | null {
  if (!clientZone || clientZone === "Asia/Karachi") return null;
  return `${formatPktDateTime(d)} PKT · ${formatInZone(d, clientZone)} ${zoneAbbrev(d, clientZone)} for the client`;
}

/** "just now" or "3d ago". Avoids the "now ago" that formatClock alone gives. */
export function agoLabel(ms: number): string {
  const c = formatClock(ms);
  return c === "now" ? "just now" : `${c} ago`;
}

/* ------------------------------------------------------- notification hours */

/**
 * The notification quiet window: 11pm to 8am Pakistan time, every day.
 *
 * Deliberately different from `isQuietHours`, which also treats Sunday as off
 * and is used by the alert *rules*. A rule may decide Sunday does not count
 * toward a deadline; a notification only needs to avoid waking somebody at 3am.
 */
export function isNightPkt(d: Date): boolean {
  const h = pktHour(d);
  return h < WORK_START_HOUR || h >= WORK_END_HOUR;
}

/** The next 8am Pakistan time at or after `d`. Where queued messages wait. */
export function nextMorningPkt(d: Date): Date {
  const shifted = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  const dayStart = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  const openToday = dayStart + WORK_START_HOUR * 3_600_000;
  const target =
    shifted.getTime() < openToday ? openToday : openToday + 24 * 3_600_000;
  return new Date(target - 5 * 60 * 60 * 1000);
}

/* ------------------------------------------------------------------ months */

/**
 * A month is the only date anyone reliably remembers about a job that closed
 * two years ago, so past work is recorded by month rather than by day. These
 * four helpers are the whole contract between an `<input type="month">` and
 * the database.
 */

/** "2025-03" to the instant that month begins, Pakistan time. Null if unreadable. */
export function pktMonthStart(value: string): Date | null {
  const v = value.trim();
  if (!/^\d{4}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}-01T00:00:00+05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The last instant of the month `start` begins. */
export function pktMonthEnd(start: Date): Date {
  const shifted = toPkt(start);
  const next = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    1,
  );
  return new Date(fromPkt(new Date(next)).getTime() - 1);
}

/** "Mar 2025", for reading. */
export function formatPktMonth(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  }).format(d);
}

/** "2025-03", for an `<input type="month">` value and for grouping keys. */
export function pktMonthValue(d: Date): string {
  const shifted = toPkt(d);
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${m}`;
}

/** The current month as "2025-03", so a form can default to it. */
export function pktThisMonth(now = new Date()): string {
  return pktMonthValue(now);
}
