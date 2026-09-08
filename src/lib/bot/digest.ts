import "server-only";
import { getTodayBoard } from "@/lib/queries/today";
import { agoLabel, formatClock, formatPktDateTime } from "@/lib/time";

/**
 * The shape of the night, in one message.
 *
 * The per-alert messages tell you about one thing the moment it happens, which
 * fragments the shift into disconnected pings and gives no sense of how much
 * is outstanding. This is the other half: what the whole night looks like at
 * the start of it, and what is still unanswered at the end.
 */

const MAX_ROWS = 6;

function section(title: string, lines: string[]): string[] {
  if (!lines.length) return [];
  const shown = lines.slice(0, MAX_ROWS);
  const extra = lines.length - shown.length;
  return [
    "",
    title,
    ...shown.map((l) => `· ${l}`),
    ...(extra ? [`  and ${extra} more`] : []),
  ];
}

export type Brief = {
  body: string;
  /** Nothing outstanding at all. Worth not sending. */
  empty: boolean;
};

/**
 * `personId` narrows every section except unowned contracts, which belong to
 * nobody and so are everybody's business.
 */
export async function buildBrief(input: {
  personId?: string | null;
  heading: string;
  now?: Date;
}): Promise<Brief> {
  const now = input.now ?? new Date();
  const board = await getTodayBoard({
    filters: input.personId ? { person: input.personId } : {},
    now,
  });

  const waiting = board.waiting.map(
    (r) =>
      `${r.title} — ${r.account} · ${r.client}, waiting ${formatClock(
        now.getTime() - r.since.getTime(),
      )}`,
  );

  const due = board.milestonesDue.map(
    (r) =>
      `${r.milestone} — ${r.title} (${r.account}), due ${formatPktDateTime(r.dueAt)}${
        r.submitted ? ", submitted" : ""
      }`,
  );

  const stale = board.noUpdate.map(
    (r) =>
      `${r.title} — ${r.account}, ${
        r.lastUpdateAt ? `last update ${agoLabel(now.getTime() - r.lastUpdateAt.getTime())}` : "never updated"
      }`,
  );

  const unowned = board.unassigned.map((r) => `${r.title} — ${r.account} · ${r.client}`);

  const lines = [
    input.heading,
    ...section("Clients waiting on us", waiting),
    ...section("Milestones due", due),
    ...section("No update posted", stale),
    ...section("Nobody owns these", unowned),
  ];

  const empty = !waiting.length && !due.length && !stale.length && !unowned.length;

  return {
    body: empty ? `${input.heading}\n\nNothing outstanding. Rare — enjoy it.` : lines.join("\n"),
    empty,
  };
}
