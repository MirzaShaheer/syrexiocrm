/**
 * Every alert threshold in the product lives here and nowhere else. The Today
 * screen colours its clocks from these numbers, and the phase 4 engine opens
 * and resolves alerts from the same numbers, so the board and the Telegram
 * message can never disagree.
 */

export const RULE_KEYS = [
  "client_waiting",
  "milestone_due",
  "stale_contract",
  "unassigned",
  "no_next_action",
] as const;

export type RuleKey = (typeof RULE_KEYS)[number];

export type RuleDefinition = {
  key: RuleKey;
  label: string;
  /** Hours at which the rule opens. */
  threshold: number;
  /**
   * Whether `threshold` counts wall-clock hours or only Pakistan working
   * hours. Client patience is measured in working hours; a milestone deadline
   * does not pause overnight.
   */
  clock: "working" | "wall";
  /**
   * Whether this rule may message somebody between 11pm and 8am.
   *
   * True only for a rule counting down to a deadline. A deadline does not
   * care that it is 3am, and being told at eight that something was due at
   * two is not a notification, it is a post-mortem. Everything else waits for
   * the morning: nobody needs waking because a client has not been replied to
   * or an update was not posted.
   */
  bypassQuietHours: boolean;
};

export const RULES: Record<RuleKey, RuleDefinition> = {
  client_waiting: {
    key: "client_waiting",
    label: "Client waiting on a reply",
    threshold: 12,
    // Wall clock, deliberately. The row shows "41h" because the client has
    // waited forty-one hours; coloring that row from a working-hours count
    // would print a red-worthy number in plain text and read as a bug. The
    // "during working days" half of the rule is honoured where it belongs —
    // notifications queue through the night and Sunday instead of firing.
    clock: "wall",
    bypassQuietHours: false,
  },
  milestone_due: {
    key: "milestone_due",
    label: "Milestone due",
    threshold: 24,
    clock: "wall",
    // The only rule counting down to a fixed deadline, and so the only one
    // allowed to buzz at 3am. A deadline does not observe office hours.
    bypassQuietHours: true,
  },
  stale_contract: {
    key: "stale_contract",
    label: "No update posted",
    threshold: 72,
    clock: "wall",
    bypassQuietHours: false,
  },
  unassigned: {
    key: "unassigned",
    label: "No owner set",
    threshold: 2,
    clock: "wall",
    bypassQuietHours: false,
  },
  no_next_action: {
    key: "no_next_action",
    label: "No next action",
    threshold: 0,
    clock: "wall",
    bypassQuietHours: false,
  },
};

/**
 * The Today screen lists everything without an update for 24 hours, but the
 * alert only fires at 72. The board is read every morning; Telegram is an
 * escalation and should not fire for something you are already looking at.
 */
export const TODAY_NO_UPDATE_HOURS = 24;
/** Milestones inside this window appear on Today. The alert fires at 24. */
export const TODAY_MILESTONE_WINDOW_HOURS = 48;

export type Tone = "plain" | "soon" | "late";

/**
 * Red past the threshold, amber approaching it, plain otherwise. Approaching
 * starts at three quarters, which is far enough out to act on.
 */
export function toneFor(elapsedHours: number, threshold: number): Tone {
  if (threshold <= 0) return elapsedHours > 0 ? "late" : "plain";
  if (elapsedHours >= threshold) return "late";
  if (elapsedHours >= threshold * 0.75) return "soon";
  return "plain";
}

/** For countdowns: the clock runs down, so the tone runs the other way. */
export function toneForRemaining(
  remainingHours: number,
  threshold: number,
  warnAt: number,
): Tone {
  if (remainingHours <= threshold) return "late";
  if (remainingHours <= warnAt) return "soon";
  return "plain";
}

/** A summary count is only as urgent as the worst row it counts. */
export function worstTone(tones: Tone[]): Tone {
  if (tones.includes("late")) return "late";
  if (tones.includes("soon")) return "soon";
  return "plain";
}

/**
 * How long an alert may be snoozed for. Lives here rather than in the actions
 * module because a "use server" file may only export async functions — a
 * constant array exported from one crashes the page that imports it.
 */
export const SNOOZE_DURATIONS = [
  { key: "4h", label: "4 hours", hours: 4 },
  { key: "24h", label: "Tomorrow", hours: 24 },
  { key: "3d", label: "3 days", hours: 72 },
  { key: "7d", label: "A week", hours: 168 },
] as const;

export type SnoozeDurationKey = (typeof SNOOZE_DURATIONS)[number]["key"];
