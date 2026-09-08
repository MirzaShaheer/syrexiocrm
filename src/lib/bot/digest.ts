import "server-only";
import { getTodayBoard } from "@/lib/queries/today";
import type { InlineButton } from "@/lib/notifications/transport";
import { agoLabel, formatClock, formatPktDateTime } from "@/lib/time";
import { encode } from "./callbacks";

/**
 * The shape of the night, in one message.
 *
 * The per-alert messages tell you about one thing the moment it happens, which
 * fragments the shift into disconnected pings and gives no sense of how much
 * is outstanding. This is the other half: what the whole night looks like at
 * the start of it, and what is still unanswered at the end.
 *
 * Every row is also a button. The first version of this was text only, and it
 * read fine and did nothing — you still had to open a laptop to act on any of
 * it, which is the exact problem the buttons on the alert cards exist to
 * remove. A list you cannot act on is a list you learn to scroll past.
 */

const MAX_ROWS = 6;
/**
 * Telegram will render far more than this, but a wall of buttons is its own
 * kind of unreadable. The rows are already in urgency order, so the cut falls
 * on the least urgent.
 */
const MAX_BUTTONS = 8;

type Row = { text: string; contractId: string; short: string };

function section(title: string, rows: Row[]): string[] {
  if (!rows.length) return [];
  const shown = rows.slice(0, MAX_ROWS);
  const extra = rows.length - shown.length;
  return [
    "",
    title,
    ...shown.map((r) => `· ${r.text}`),
    ...(extra ? [`  and ${extra} more`] : []),
  ];
}

/** Button labels have to survive a narrow phone, so they are cut hard. */
function short(title: string, account: string): string {
  const t = title.length > 26 ? `${title.slice(0, 25)}…` : title;
  return `${t} · ${account}`;
}

export type Brief = {
  body: string;
  /** Nothing outstanding at all. Worth not sending. */
  empty: boolean;
  /** One button per contract named above, most urgent first. */
  keyboard: InlineButton[][];
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

  const waiting: Row[] = board.waiting.map((r) => ({
    contractId: r.id,
    short: short(r.title, r.account),
    text: `${r.title} — ${r.account} · ${r.client}, waiting ${formatClock(
      now.getTime() - r.since.getTime(),
    )}`,
  }));

  const due: Row[] = board.milestonesDue.map((r) => ({
    contractId: r.contractId,
    short: short(r.milestone, r.account),
    text: `${r.milestone} — ${r.title} (${r.account}), due ${formatPktDateTime(r.dueAt)}${
      r.submitted ? ", submitted" : ""
    }`,
  }));

  const stale: Row[] = board.noUpdate.map((r) => ({
    contractId: r.id,
    short: short(r.title, r.account),
    text: `${r.title} — ${r.account}, ${
      r.lastUpdateAt
        ? `last update ${agoLabel(now.getTime() - r.lastUpdateAt.getTime())}`
        : "never updated"
    }`,
  }));

  const unowned: Row[] = board.unassigned.map((r) => ({
    contractId: r.id,
    short: short(r.title, r.account),
    text: `${r.title} — ${r.account} · ${r.client}`,
  }));

  const empty = !waiting.length && !due.length && !stale.length && !unowned.length;

  const lines = [
    input.heading,
    ...section("Clients waiting on us", waiting),
    ...section("Milestones due", due),
    ...section("No update posted", stale),
    ...section("Nobody owns these", unowned),
    ...(empty ? [] : ["", "Tap one to act on it."]),
  ];

  /*
   * One button per contract, deduplicated: a contract that is both waiting on
   * a reply and overdue an update appears in two sections and must not appear
   * as two identical buttons.
   */
  const seen = new Set<string>();
  const buttons: InlineButton[] = [];
  for (const row of [...waiting, ...due, ...stale, ...unowned]) {
    if (seen.has(row.contractId)) continue;
    seen.add(row.contractId);
    buttons.push({ text: row.short, data: encode("card", row.contractId) });
    if (buttons.length === MAX_BUTTONS) break;
  }

  return {
    body: empty
      ? `${input.heading}\n\nNothing outstanding. Rare — enjoy it.`
      : lines.join("\n"),
    empty,
    keyboard: buttons.map((b) => [b]),
  };
}
