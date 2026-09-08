import { formatPktDateTime, shiftEndFor } from "@/lib/time";

/**
 * Reading a due date out of a typed line.
 *
 * A next action with no due date is not a next action — nothing chases it —
 * so the rule on the contract screen is that the date is required. Requiring
 * somebody to type a full timestamp into a phone at 3am would mean they stop
 * setting next actions at all, so instead there is a default that always
 * applies and a very small vocabulary for overriding it.
 *
 * Deliberately small. A general date parser would accept "next Tuesday-ish"
 * and quietly pick a day; this accepts six forms and says so when it does not
 * understand, which is the honest behaviour when the value drives an alert.
 */

export type ParsedDue = {
  dueAt: Date;
  /** How the choice reads back, so the confirmation can repeat it. */
  label: string;
};

/** Splits "Chase the invoice | 3d" into its text and its date phrase. */
export function splitDue(raw: string): { text: string; phrase: string | null } {
  const at = raw.lastIndexOf("|");
  if (at < 0) return { text: raw.trim(), phrase: null };
  return {
    text: raw.slice(0, at).trim(),
    phrase: raw.slice(at + 1).trim() || null,
  };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Understands: nothing (end of this shift), "tonight", "tomorrow", "Nh",
 * "Nd", and "YYYY-MM-DD HH:MM" read as Pakistan time.
 */
export function parseDue(phrase: string | null, now = new Date()): ParsedDue | null {
  const p = (phrase ?? "").trim().toLowerCase();

  if (!p || p === "tonight" || p === "today" || p === "eod") {
    const dueAt = shiftEndFor(now);
    return { dueAt, label: `end of this shift, ${formatPktDateTime(dueAt)} PKT` };
  }

  if (p === "tomorrow") {
    const dueAt = new Date(shiftEndFor(now).getTime() + DAY_MS);
    return { dueAt, label: `tomorrow, ${formatPktDateTime(dueAt)} PKT` };
  }

  const relative = p.match(/^(\d{1,3})\s*([hd])$/);
  if (relative) {
    const n = Number(relative[1]);
    if (n < 1) return null;
    const dueAt = new Date(
      now.getTime() + n * (relative[2] === "h" ? HOUR_MS : DAY_MS),
    );
    return {
      dueAt,
      label: `in ${n} ${relative[2] === "h" ? "hours" : "days"}, ${formatPktDateTime(dueAt)} PKT`,
    };
  }

  const explicit = p.match(/^(\d{4}-\d{2}-\d{2})(?:[ t](\d{2}):(\d{2}))?$/);
  if (explicit) {
    const time = explicit[2] ? `${explicit[2]}:${explicit[3]}` : "06:00";
    const dueAt = new Date(`${explicit[1]}T${time}:00+05:00`);
    if (Number.isNaN(dueAt.getTime())) return null;
    return { dueAt, label: `${formatPktDateTime(dueAt)} PKT` };
  }

  return null;
}

/** Shown when the phrase was not understood. Lists everything accepted. */
export const DUE_HELP = [
  "Add a due date after a | — one of:",
  "  tonight        end of this shift (the default)",
  "  tomorrow       the shift after this one",
  "  6h  ·  3d      that far from now",
  "  2026-09-20     that date, 6am",
].join("\n");
