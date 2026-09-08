/**
 * Everything time-related is anchored to Pakistan Standard Time, which is a
 * fixed UTC+5 with no daylight saving. That lets us treat a PKT wall clock as
 * a plain offset rather than pulling in a timezone database.
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * The office shift: 6pm to 6am Pakistan time, Monday to Friday nights.
 *
 * A shift is named by the night it *starts*, so "Monday" means Monday 6pm
 * through Tuesday 6am, and the last office shift of the week is Friday 6pm to
 * Saturday 6am. The window crosses midnight, which is the single fact every
 * helper below has to respect — an earlier version of this file assumed
 * `start < end` within one calendar day and every one of these functions was
 * silently wrong the moment the shift moved to nights.
 */
const SHIFT_NIGHTS = new Set([1, 2, 3, 4, 5]);
/** Shift hours, PKT. End is on the following calendar day. */
export const SHIFT_START_HOUR = 18;
export const SHIFT_END_HOUR = 6;
/** Length of one shift, in hours. 6pm to 6am is twelve. */
const SHIFT_LENGTH_HOURS = 24 - SHIFT_START_HOUR + SHIFT_END_HOUR;

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

/** Midnight PKT that begins the day containing `d`, as a shifted timestamp. */
function pktDayStart(d: Date): number {
  const s = toPkt(d);
  return Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
}

/**
 * Whether a shift starts on this weekday. Takes the weekday of the *start*,
 * so Friday is a working night and Saturday is not.
 */
export function isWorkingNight(weekday: number): boolean {
  return SHIFT_NIGHTS.has(weekday);
}

/**
 * True when `d` falls inside a Monday-to-Friday office shift.
 *
 * Two ways to be inside one: it is after 6pm and tonight is a working night,
 * or it is before 6am and *last* night was. Everything between 6am and 6pm is
 * outside, because that is when the team is asleep.
 */
export function isInShift(d: Date): boolean {
  const h = pktHour(d);
  if (h >= SHIFT_START_HOUR) return isWorkingNight(pktWeekday(d));
  if (h < SHIFT_END_HOUR) {
    // Belongs to the shift that started yesterday.
    return isWorkingNight((pktWeekday(d) + 6) % 7);
  }
  return false;
}

/**
 * The alert-rule clock: true whenever we are outside an office shift.
 *
 * Deliberately different from `isOffShiftPkt`, which decides whether to send a
 * message. This one decides whether the *clock runs* — a client who writes at
 * 9am Saturday should not have burned two working days by Monday evening,
 * because nobody was rostered to answer.
 */
export function isQuietHours(d: Date): boolean {
  return !isInShift(d);
}

/** Kept for callers that only care whether any work happens on this date. */
export function isWorkingDay(d: Date): boolean {
  return isWorkingNight(pktWeekday(d));
}

/** Start of the next office shift at or after `d`. */
export function nextWorkingStart(d: Date): Date {
  if (isInShift(d)) return d;

  const shifted = toPkt(d).getTime();
  const today = pktDayStart(d);

  for (let i = 0; i < 8; i++) {
    const dayStart = today + i * DAY_MS;
    if (!isWorkingNight(new Date(dayStart).getUTCDay())) continue;
    const open = dayStart + SHIFT_START_HOUR * HOUR_MS;
    if (open >= shifted) return fromPkt(new Date(open));
  }
  return d;
}

/**
 * Milliseconds of shift time between two instants, counting only Monday to
 * Friday nights, 6pm to 6am PKT. This is what alert thresholds measure
 * against, so a client who writes at 2am on Sunday does not burn the clock
 * while the office is dark.
 *
 * Each night contributes one window that runs past midnight into the next
 * day, so the scan starts a day early — a window opened on Friday is still
 * paying out at 5am on Saturday.
 */
export function workingMsBetween(from: Date, to: Date): number {
  if (to <= from) return 0;

  const startShifted = toPkt(from).getTime();
  const endShifted = toPkt(to).getTime();

  let total = 0;
  // One day back, because last night's shift may still be running.
  let dayCursor = pktDayStart(from) - DAY_MS;

  while (dayCursor < endShifted) {
    if (isWorkingNight(new Date(dayCursor).getUTCDay())) {
      const open = dayCursor + SHIFT_START_HOUR * HOUR_MS;
      const close = open + SHIFT_LENGTH_HOURS * HOUR_MS;
      const overlap = Math.min(close, endShifted) - Math.max(open, startShifted);
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
 * The notification hold window: 6am to 6pm Pakistan time, every day.
 *
 * The exact inverse of the shift, and deliberately looser than `isQuietHours`
 * about the weekend. The office runs Monday to Friday, but the team watches
 * the work from home on Saturday and Sunday nights, so a message sent at 9pm
 * on a Saturday reaches somebody. A message sent at 10am does not — that is
 * the middle of their sleep.
 */
export function isOffShiftPkt(d: Date): boolean {
  const h = pktHour(d);
  return h >= SHIFT_END_HOUR && h < SHIFT_START_HOUR;
}

/**
 * The next 6pm Pakistan time at or after `d`. Where held messages wait.
 *
 * Every night, weekends included — see `isOffShiftPkt`. Holding a Saturday
 * message until Monday evening would be holding it for two days, which is not
 * a delay, it is a deletion.
 */
export function nextShiftStartPkt(d: Date): Date {
  const shifted = toPkt(d).getTime();
  const openToday = pktDayStart(d) + SHIFT_START_HOUR * HOUR_MS;
  const target = shifted < openToday ? openToday : openToday + DAY_MS;
  return fromPkt(new Date(target));
}

/**
 * The 6am that closes the shift `d` falls in, or the one closing the shift
 * about to start. This is what "by the end of tonight" means, and it is the
 * default due date for anything typed into the bot without one.
 */
export function shiftEndFor(d: Date): Date {
  const h = pktHour(d);
  const dayStart = pktDayStart(d);
  // Before 6am we are inside last night's shift, which ends this morning.
  if (h < SHIFT_END_HOUR) {
    return fromPkt(new Date(dayStart + SHIFT_END_HOUR * HOUR_MS));
  }
  // Otherwise the shift running tonight, which ends tomorrow morning.
  return fromPkt(new Date(dayStart + DAY_MS + SHIFT_END_HOUR * HOUR_MS));
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

/** The Monday a week of bid counts belongs to: "week of 7 Sept". */
export function formatPktWeek(d: Date): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Karachi",
  }).format(d);
  return `week of ${day}`;
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
