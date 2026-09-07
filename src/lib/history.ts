/**
 * Work that closed before this CRM existed.
 *
 * The agency has years of finished jobs sitting only in people's heads and in
 * Upwork's own history. This is how they get typed in: one client, one month,
 * one number. Deliberately the smallest form in the product, because the
 * alternative to a cheap form is an empty table.
 *
 * A past entry is a real contract row with `is_historical = true` and
 * `status = 'ended'`. That is the whole trick: every live query in the product
 * already filters on `status = 'active'`, so history can never leak into
 * Today, the alert engine, or an account's work in progress — while the client
 * page, repeat-business counts and revenue totals pick it up for free.
 */

export const HISTORY_OUTCOMES = [
  {
    key: "completed",
    label: "Completed and paid",
    note: "Delivered, money received, contract closed",
  },
  {
    key: "repeat",
    label: "Completed, client returned",
    note: "Finished, and they came back for more work later",
  },
  {
    key: "cancelled",
    label: "Cancelled or refunded",
    note: "Started, did not finish",
  },
  {
    key: "moved_off",
    label: "Moved off Upwork",
    note: "Continued directly with the client",
  },
] as const;

export type HistoryOutcomeKey = (typeof HISTORY_OUTCOMES)[number]["key"];

export function isValidOutcome(key: string): key is HistoryOutcomeKey {
  return HISTORY_OUTCOMES.some((o) => o.key === key);
}

export function outcomeLabel(key: string | null): string {
  if (!key) return "Closed";
  return HISTORY_OUTCOMES.find((o) => o.key === key)?.label ?? key;
}

/** Only one outcome is a bad ending, and only it is ever coloured. */
export function outcomeTone(key: string | null): "plain" | "late" | "done" {
  if (key === "cancelled") return "late";
  if (key === "completed" || key === "repeat") return "done";
  return "plain";
}
