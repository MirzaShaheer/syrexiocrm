import "server-only";
import { desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bidWeekTrash, users } from "@/db/schema";
import { formatPktWeek } from "@/lib/time";
import { TRASH_DAYS, trashDaysLeft, type TrashEntry } from "@/lib/week-counts";

/**
 * Reading and emptying the count trash.
 *
 * Kept out of the actions file on purpose: neither of these is something a
 * browser should be able to call, and every export of a "use server" module
 * becomes an endpoint whether it wants to be one or not.
 */

/**
 * Everything still inside its window, newest first.
 *
 * The cutoff is applied on read as well as by the purge, so a row past its
 * thirty days is already invisible even if the cron has not run — the panel
 * never promises a restore it cannot honour.
 */
export async function listWeekCountsTrash(now = new Date()): Promise<TrashEntry[]> {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * 86_400_000);

  const rows = await db
    .select({
      id: bidWeekTrash.id,
      accountId: bidWeekTrash.accountId,
      weekStart: bidWeekTrash.weekStart,
      bids: bidWeekTrash.bids,
      chatsOpened: bidWeekTrash.chatsOpened,
      contracted: bidWeekTrash.contracted,
      closed: bidWeekTrash.closed,
      withdrawn: bidWeekTrash.withdrawn,
      deletedAt: bidWeekTrash.deletedAt,
      label: accounts.label,
      deletedByName: users.name,
    })
    .from(bidWeekTrash)
    .innerJoin(accounts, eq(accounts.id, bidWeekTrash.accountId))
    .leftJoin(users, eq(users.id, bidWeekTrash.deletedByUserId))
    .where(gt(bidWeekTrash.deletedAt, cutoff))
    .orderBy(desc(bidWeekTrash.deletedAt));

  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountLabel: r.label,
    weekStartIso: r.weekStart.toISOString(),
    weekLabel: formatPktWeek(r.weekStart),
    bids: num(r.bids),
    chatsOpened: num(r.chatsOpened),
    contracted: num(r.contracted),
    closed: num(r.closed),
    withdrawn: num(r.withdrawn),
    deletedByName: r.deletedByName,
    deletedAtIso: r.deletedAt.toISOString(),
    daysLeft: trashDaysLeft(r.deletedAt, now),
  }));
}

/**
 * Erasing anything past its thirty days. Runs from the cron that fires every
 * fifteen minutes, so the promise the trash panel makes is kept by a clock
 * rather than by somebody remembering to sweep.
 */
export async function purgeWeekCountsTrash(): Promise<number> {
  const erased = await db
    .delete(bidWeekTrash)
    .where(lt(bidWeekTrash.deletedAt, sql`now() - interval '${sql.raw(String(TRASH_DAYS))} days'`))
    .returning({ id: bidWeekTrash.id });
  return erased.length;
}

/** numeric columns come back as strings; null has to survive the trip. */
function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}
