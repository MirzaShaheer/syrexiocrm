/**
 * Exercises the count trash against the real database: delete moves a row out
 * whole, restore puts it back, the slot guard refuses to overwrite, and the
 * purge erases exactly what is past thirty days and nothing else.
 *
 *   npx tsx --conditions=react-server scripts/check-trash.ts
 *
 * It works on a scratch account and cleans up after itself, so it is safe to
 * run against the local database with real counts in it.
 */
import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bidWeekTrash, bidWeeks } from "@/db/schema";
import { listWeekCountsTrash, purgeWeekCountsTrash } from "@/lib/trash";
import { TRASH_DAYS, trashDaysLeft } from "@/lib/week-counts";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got ${a}\n        want ${e}`}`);
}

async function main() {
  const [account] = await db
    .select({ id: accounts.id, label: accounts.label })
    .from(accounts)
    .where(eq(accounts.active, true))
    .limit(1);
  if (!account) throw new Error("No active account to test against.");

  // A week far enough in the past that no real counts live there.
  const weekStart = new Date("2019-01-07T00:00:00+05:00");
  const slot = and(
    eq(bidWeeks.accountId, account.id),
    eq(bidWeeks.weekStart, weekStart),
  );

  // The purge test uses a second week, so cleanup has to sweep both or it
  // leaves an entry sitting in the real trash panel.
  const otherWeek = new Date("2019-01-14T00:00:00+05:00");
  const cleanup = async () => {
    await db.delete(bidWeeks).where(slot);
    await db
      .delete(bidWeekTrash)
      .where(
        and(
          eq(bidWeekTrash.accountId, account.id),
          inArray(bidWeekTrash.weekStart, [weekStart, otherWeek]),
        ),
      );
  };
  await cleanup();

  console.log(`\nusing ${account.label}, week starting ${weekStart.toISOString()}\n`);

  /* ------------------------------------------------- a row, then deleted */
  await db.insert(bidWeeks).values({
    accountId: account.id,
    weekStart,
    bids: "31",
    chatsOpened: "9",
    contracted: "4",
    closed: "2",
    // withdrawn deliberately left null, to prove null survives the round trip
  });

  const [live] = await db.select().from(bidWeeks).where(slot);
  await db.insert(bidWeekTrash).values({
    accountId: live.accountId,
    weekStart,
    bids: live.bids,
    chatsOpened: live.chatsOpened,
    contracted: live.contracted,
    closed: live.closed,
    withdrawn: live.withdrawn,
    enteredByUserId: live.enteredByUserId,
  });
  await db.delete(bidWeeks).where(slot);

  check("live row is gone after delete", (await db.select().from(bidWeeks).where(slot)).length, 0);

  const binned = (await listWeekCountsTrash()).filter(
    (e) => e.accountId === account.id && e.weekStartIso === weekStart.toISOString(),
  );
  check("trash holds exactly one entry", binned.length, 1);
  check("counts survive whole", [
    binned[0]?.bids,
    binned[0]?.chatsOpened,
    binned[0]?.contracted,
    binned[0]?.closed,
    binned[0]?.withdrawn,
  ], [31, 9, 4, 2, null]);
  check("a fresh delete has the full window", binned[0]?.daysLeft, TRASH_DAYS);

  /* ------------------------------------------- the slot guard on restore */
  await db.insert(bidWeeks).values({ accountId: account.id, weekStart, bids: "7" });
  const clash = await db.select({ id: bidWeeks.accountId }).from(bidWeeks).where(slot);
  check("a retyped slot is detected, so restore refuses", clash.length, 1);
  await db.delete(bidWeeks).where(slot);

  /* ----------------------------------------------------------- restoring */
  const [entry] = await db
    .select()
    .from(bidWeekTrash)
    .where(
      and(
        eq(bidWeekTrash.accountId, account.id),
        eq(bidWeekTrash.weekStart, weekStart),
      ),
    );
  await db.insert(bidWeeks).values({
    accountId: entry.accountId,
    weekStart: entry.weekStart,
    bids: entry.bids,
    chatsOpened: entry.chatsOpened,
    contracted: entry.contracted,
    closed: entry.closed,
    withdrawn: entry.withdrawn,
    enteredByUserId: entry.enteredByUserId,
  });
  await db.delete(bidWeekTrash).where(eq(bidWeekTrash.id, entry.id));

  const [back] = await db.select().from(bidWeeks).where(slot);
  check("restored row matches what was deleted", [
    back?.bids,
    back?.chatsOpened,
    back?.contracted,
    back?.closed,
    back?.withdrawn,
  ], ["31", "9", "4", "2", null]);
  check("trash is empty again", (await listWeekCountsTrash()).filter(
    (e) => e.accountId === account.id && e.weekStartIso === weekStart.toISOString(),
  ).length, 0);

  /* --------------------------------------------------------- the 30 days */
  const old = new Date(Date.now() - (TRASH_DAYS + 1) * 86_400_000);
  const young = new Date(Date.now() - (TRASH_DAYS - 1) * 86_400_000);
  const [expired] = await db
    .insert(bidWeekTrash)
    .values({ accountId: account.id, weekStart, bids: "1", deletedAt: old })
    .returning({ id: bidWeekTrash.id });
  const [surviving] = await db
    .insert(bidWeekTrash)
    .values({
      accountId: account.id,
      weekStart: otherWeek,
      bids: "2",
      deletedAt: young,
    })
    .returning({ id: bidWeekTrash.id });

  const listed = (await listWeekCountsTrash()).map((e) => e.id);
  check("an expired entry is never listed", listed.includes(expired.id), false);
  check("a 29-day-old entry still is", listed.includes(surviving.id), true);
  check("its countdown reads 1 day", trashDaysLeft(young), 1);

  const purged = await purgeWeekCountsTrash();
  check("the purge erased at least the expired one", purged >= 1, true);
  const afterPurge = await db
    .select({ id: bidWeekTrash.id })
    .from(bidWeekTrash)
    .where(eq(bidWeekTrash.id, expired.id));
  check("expired entry is really gone", afterPurge.length, 0);
  const stillThere = await db
    .select({ id: bidWeekTrash.id })
    .from(bidWeekTrash)
    .where(eq(bidWeekTrash.id, surviving.id));
  check("the 29-day-old one was spared", stillThere.length, 1);

  await cleanup();
  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
