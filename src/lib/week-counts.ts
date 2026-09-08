/**
 * The five numbers Upwork exposes through no API, so the whole funnel is
 * typed by hand. Shared between the server action that stores them and the
 * client that edits them, which is why this module carries no directive.
 */

export type WeekCountValues = {
  bids: number | null;
  chatsOpened: number | null;
  contracted: number | null;
  closed: number | null;
  withdrawn: number | null;
};

export type WeekCountField = keyof WeekCountValues;

/*
 * This order is the order of the boxes in the editor and the order of the
 * columns in the table, so reading down the pane and reading across a row are
 * the same exercise.
 */
export const WEEK_COUNT_FIELDS: {
  name: WeekCountField;
  label: string;
  hint: string;
}[] = [
  { name: "bids", label: "Bids", hint: "Proposals sent." },
  { name: "chatsOpened", label: "Chats opened", hint: "Proposals that got a reply." },
  { name: "contracted", label: "Contracted", hint: "Chats that became a contract." },
  { name: "closed", label: "Closed", hint: "Contracts finished this week." },
  { name: "withdrawn", label: "Withdrawn", hint: "Pulled back before a contract." },
];

/**
 * Saving hands the counts back rather than only a message: the table above
 * the editor is rendered from them directly, so a save shows up immediately
 * instead of waiting on a route refresh.
 */
export type WeekCountsResult =
  | { ok: true; message: string; accountId: string; counts: WeekCountValues }
  | { ok: false; message: string };

/**
 * How long a deleted row is recoverable. Deleting is open to everybody, the
 * way typing the counts is, precisely because this window makes it undoable —
 * a destructive act with a way back is not really destructive.
 */
export const TRASH_DAYS = 30;

/** One deleted row, as the trash panel needs it. */
export type TrashEntry = WeekCountValues & {
  id: string;
  accountId: string;
  accountLabel: string;
  /** The Monday the counts belonged to, ISO, so the client can match weeks. */
  weekStartIso: string;
  weekLabel: string;
  deletedByName: string | null;
  deletedAtIso: string;
  /** Whole days left before the purge erases it. Never below zero. */
  daysLeft: number;
};

export type DeleteCountsResult =
  | { ok: true; message: string; accountId: string; entry: TrashEntry }
  | { ok: false; message: string };

export type RestoreCountsResult =
  | {
      ok: true;
      message: string;
      id: string;
      accountId: string;
      weekStartIso: string;
      counts: WeekCountValues;
    }
  | { ok: false; message: string };

/** Days left on a trashed row, floored at zero for anything already due. */
export function trashDaysLeft(deletedAt: Date, now = new Date()): number {
  const elapsed = (now.getTime() - deletedAt.getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(TRASH_DAYS - elapsed));
}
