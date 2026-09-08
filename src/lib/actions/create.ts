"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  bidWeekTrash,
  bidWeeks,
  clients,
  contracts,
  events,
  milestones,
  users,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  markActivityFor,
  setMilestoneStatusFor,
} from "@/lib/ops";
import { canAssignOwner, canEditContract } from "@/lib/permissions";
import { firstStage, isValidStage } from "@/lib/pipelines";
import type { ActionResult } from "@/lib/actions/contracts";
import { formatPktWeek } from "@/lib/time";
import {
  WEEK_COUNT_FIELDS,
  trashDaysLeft,
  type DeleteCountsResult,
  type RestoreCountsResult,
  type WeekCountValues,
  type WeekCountsResult,
} from "@/lib/week-counts";

/**
 * Everything in this file exists because there is no Upwork API in play — the
 * team keys the work in. So these forms are the product's front door, and the
 * rules are: as few required fields as the alert engine actually needs, a
 * sensible default for everything else, and never a silent failure.
 */

/** A reference for contracts that did not come from a sync. */
function manualRef(): string {
  return `MAN-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/** Parses a datetime-local value as Pakistan wall clock. */
function pktDate(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;
  const d = new Date(`${v.length === 16 ? `${v}:00` : v}+05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parses a date-only value as the start of that day, Pakistan time. */
function pktDay(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;
  const d = new Date(`${v}T00:00:00+05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ---------------------------------------------------------------- clients */

export async function createClient(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Give the client a name." };

  const country = String(formData.get("country") ?? "").trim() || null;
  const timezone = String(formData.get("timezone") ?? "").trim() || null;
  const ref = String(formData.get("upworkClientRef") ?? "").trim() || null;
  const note = String(formData.get("notes") ?? "").trim() || null;

  if (ref) {
    const [existing] = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(eq(clients.upworkClientRef, ref))
      .limit(1);
    if (existing) {
      return {
        ok: false,
        message: `That Upwork reference already belongs to ${existing.name}. Open their page instead of adding them twice.`,
      };
    }
  }

  const [created] = await db
    .insert(clients)
    .values({ name, country, timezone, upworkClientRef: ref, notes: note })
    .returning({ id: clients.id });

  revalidatePath("/clients");
  redirect(`/clients/${created.id}`);
}

/* -------------------------------------------------------------- contracts */

export async function createContract(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();

  const accountId = String(formData.get("accountId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "fixed") as "fixed" | "hourly";
  const rawValue = String(formData.get("value") ?? "").trim();
  const ownerRaw = String(formData.get("ownerUserId") ?? "");
  const stageRaw = String(formData.get("stage") ?? "");
  const nextActionText = String(formData.get("nextActionText") ?? "").trim();
  const nextActionDue = String(formData.get("nextActionDueAt") ?? "");
  const startedRaw = String(formData.get("startedAt") ?? "");
  const ref = String(formData.get("upworkContractId") ?? "").trim();

  // Client: either an existing one, or a name typed straight into the form.
  const clientId = String(formData.get("clientId") ?? "");
  const newClientName = String(formData.get("newClientName") ?? "").trim();

  if (!title) return { ok: false, message: "Give the contract a title." };
  if (!accountId) return { ok: false, message: "Choose which Upwork account this came through." };
  if (!clientId && !newClientName) {
    return { ok: false, message: "Pick a client, or type a new client's name." };
  }

  const [account] = await db
    .select({ id: accounts.id, niche: accounts.niche })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) return { ok: false, message: "That account no longer exists." };

  const stage = stageRaw && isValidStage(account.niche, stageRaw)
    ? stageRaw
    : firstStage(account.niche);

  let value: string | null = null;
  if (rawValue) {
    const n = Number(rawValue.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: "That value could not be read. Use digits only." };
    }
    value = n.toFixed(2);
  }

  const dueAt = pktDate(nextActionDue);
  if (nextActionText && !dueAt) {
    return {
      ok: false,
      message: "A next action needs a due date, otherwise nothing ever chases it.",
    };
  }

  if (ref) {
    const [clash] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.upworkContractId, ref))
      .limit(1);
    if (clash) {
      return { ok: false, message: "A contract with that Upwork id already exists." };
    }
  }

  // Create the client inline if the form carried a new name.
  let resolvedClientId = clientId;
  if (!resolvedClientId) {
    const [c] = await db
      .insert(clients)
      .values({
        name: newClientName,
        country: String(formData.get("newClientCountry") ?? "").trim() || null,
        timezone: String(formData.get("newClientTimezone") ?? "").trim() || null,
      })
      .returning({ id: clients.id });
    resolvedClientId = c.id;
  }

  const startedAt = pktDay(startedRaw) ?? new Date();

  const [created] = await db
    .insert(contracts)
    .values({
      accountId,
      clientId: resolvedClientId,
      upworkContractId: ref || manualRef(),
      title,
      type,
      value,
      status: "active",
      ownerUserId: ownerRaw || null,
      createdByUserId: actor.id,
      stage,
      nextActionText: nextActionText || null,
      nextActionDueAt: dueAt,
      startedAt,
    })
    .returning({ id: contracts.id });

  await db.insert(events).values({
    contractId: created.id,
    type: "contract_created",
    actor: actor.id,
    payload: { title, byName: actor.name, manual: true },
  });

  if (ownerRaw) {
    await db.insert(events).values({
      contractId: created.id,
      type: "owner_assigned",
      actor: actor.id,
      payload: { toUserId: ownerRaw },
    });
  }

  revalidatePath("/");
  revalidatePath("/today");
  redirect(`/contracts/${created.id}`);
}

/* ------------------------------------------------------- message activity */

/**
 * Without an API nothing knows when a client wrote or when we answered, and
 * "client waiting on a reply" is the most valuable rule in the product. Two
 * one-click stamps keep it alive: one press when a message lands, one when
 * somebody answers. Both write an event, so the timeline still tells the story.
 */
export async function markActivity(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const contractId = String(formData.get("contractId") ?? "");
  const direction = String(formData.get("direction") ?? "");

  if (direction !== "in" && direction !== "out") {
    return { ok: false, message: "Say whether the client wrote or we replied." };
  }

  const result = await markActivityFor(actor, contractId, direction, "contract page");
  return result;
}

/* -------------------------------------------------------------- milestones */

export async function addMilestone(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const contractId = String(formData.get("contractId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const rawAmount = String(formData.get("amount") ?? "").trim();
  const due = String(formData.get("dueAt") ?? "");

  if (!title) return { ok: false, message: "Give the milestone a title." };

  const [contract] = await db
    .select({
      id: contracts.id,
      createdByUserId: contracts.createdByUserId,
      ownerUserId: contracts.ownerUserId,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!contract) return { ok: false, message: "That contract no longer exists." };
  if (!canEditContract(actor, contract)) {
    return {
      ok: false,
      message: "This contract was created by someone else. Ask them, or ask Mir for edit access.",
    };
  }

  let amount: string | null = null;
  if (rawAmount) {
    const n = Number(rawAmount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: "That amount could not be read. Use digits only." };
    }
    amount = n.toFixed(2);
  }

  await db.insert(milestones).values({
    contractId,
    upworkMilestoneId: manualRef(),
    title,
    amount,
    dueAt: pktDate(due),
    status: "pending",
  });

  await db.insert(events).values({
    contractId,
    type: "milestone_added",
    actor: actor.id,
    payload: { title, amount },
  });

  return { ok: true, message: "Milestone added." };
}

export async function setMilestoneStatus(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await setMilestoneStatusFor(
    actor,
    String(formData.get("milestoneId") ?? ""),
    String(formData.get("status") ?? ""),
  );
  return result;
}

/**
 * One-click reply logging, straight from the Today board. The whole point is
 * that clearing a "client waiting" row happens where you are already looking,
 * not three clicks away inside the contract — a rule that depends on a habit
 * has to make the habit nearly free.
 */
export async function markReplied(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await markActivityFor(
    actor,
    String(formData.get("contractId") ?? ""),
    "out",
    "today board",
  );
  return result.ok ? { ok: true, message: "Logged." } : result;
}

/**
 * Assigning four contracts one at a time on a Monday morning is friction that
 * guarantees it does not happen, so this takes a list.
 */
export async function bulkAssign(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const ids = formData.getAll("contractId").map(String).filter(Boolean);

  if (!userId) return { ok: false, message: "Choose who is taking these on." };
  if (!ids.length) return { ok: false, message: "Tick at least one contract." };

  const [assignee] = await db
    .select({ id: users.id, name: users.name, active: users.active })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!assignee || !assignee.active) {
    return { ok: false, message: "That person is no longer active." };
  }

  let assigned = 0;
  let refused = 0;

  for (const id of ids) {
    const [c] = await db
      .select({
        id: contracts.id,
        ownerUserId: contracts.ownerUserId,
        createdByUserId: contracts.createdByUserId,
      })
      .from(contracts)
      .where(eq(contracts.id, id))
      .limit(1);
    if (!c) continue;

    // Same rule as anywhere else: claiming something unowned is always fine,
    // moving somebody else's work is not.
    if (!canAssignOwner(actor, c)) {
      refused++;
      continue;
    }

    await db
      .update(contracts)
      .set({ ownerUserId: assignee.id, updatedAt: new Date() })
      .where(eq(contracts.id, id));

    await db.insert(events).values({
      contractId: id,
      type: c.ownerUserId ? "owner_handover" : "owner_assigned",
      actor: actor.id,
      payload: {
        fromUserId: c.ownerUserId,
        toUserId: assignee.id,
        toName: assignee.name,
        byName: actor.name,
        bulk: true,
      },
    });
    assigned++;
  }


  if (assigned === 0) {
    return { ok: false, message: "Nothing was assigned — all of those belong to someone else." };
  }
  return {
    ok: true,
    message: refused
      ? `Assigned ${assigned} to ${assignee.name}. ${refused} belonged to somebody else and were left alone.`
      : `Assigned ${assigned} to ${assignee.name}.`,
  };
}

/**
 * The numbers Upwork cannot tell us. One account at a time, five boxes, and
 * the week view turns them into a funnel — bids to chats to contracts to
 * closed — which is the only honest way to compare how the profiles are
 * performing.
 *
 * A blank box clears that count back to "not entered" rather than writing a
 * zero, because an unanswered question and a genuine nil read very
 * differently on the table above.
 */
export async function saveWeekCounts(
  _prev: WeekCountsResult | null,
  formData: FormData,
): Promise<WeekCountsResult> {
  const actor = await requireUser();
  const weekStartRaw = String(formData.get("weekStart") ?? "");
  const weekStart = new Date(weekStartRaw);
  if (Number.isNaN(weekStart.getTime())) {
    return { ok: false, message: "That week could not be read. Reload and try again." };
  }

  const accountId = String(formData.get("accountId") ?? "");
  const [account] = await db
    .select({ id: accounts.id, label: accounts.label })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.active, true)))
    .limit(1);
  if (!account) {
    return { ok: false, message: "That account is no longer active." };
  }

  const counts = {} as WeekCountValues;
  for (const field of WEEK_COUNT_FIELDS) {
    const raw = String(formData.get(field.name) ?? "").trim();
    if (raw === "") {
      counts[field.name] = null;
      continue;
    }
    if (!/^[0-9]+$/.test(raw)) {
      return {
        ok: false,
        message: `${field.label} must be a whole number, or left blank.`,
      };
    }
    const n = Number(raw);
    if (n > 99_999) {
      return { ok: false, message: `${field.label} looks like a typo — that is too large.` };
    }
    counts[field.name] = n;
  }

  // bids is the one column that is not null in the table, so a blank box
  // means zero there and "not entered" everywhere else.
  const row = {
    bids: String(counts.bids ?? 0),
    chatsOpened: str(counts.chatsOpened),
    contracted: str(counts.contracted),
    closed: str(counts.closed),
    withdrawn: str(counts.withdrawn),
  };

  await db
    .insert(bidWeeks)
    .values({ accountId: account.id, weekStart, ...row, enteredByUserId: actor.id })
    .onConflictDoUpdate({
      target: [bidWeeks.accountId, bidWeeks.weekStart],
      set: { ...row, enteredByUserId: actor.id, updatedAt: new Date() },
    });

  /*
   * The editor paints the table from what comes back here, so the numbers
   * land instantly. This only clears the route cache for the next visit.
   */
  revalidatePath("/week");
  return {
    ok: true,
    message: `Saved ${account.label}.`,
    accountId: account.id,
    // What was stored, not what was typed: a blank bids box became a zero.
    counts: { ...counts, bids: counts.bids ?? 0 },
  };
}

/**
 * Deleting a week's counts for one account. The row moves to the trash whole
 * and comes out of the live table, which frees the (account, week) slot for
 * whoever types it next.
 *
 * Open to everybody, like typing the counts is. The product restricts
 * destructive acts, but a delete that can be undone for thirty days is not
 * one — and a count nobody may remove is a wrong count that stays wrong.
 */
export async function deleteWeekCounts(
  _prev: DeleteCountsResult | null,
  formData: FormData,
): Promise<DeleteCountsResult> {
  const actor = await requireUser();
  const weekStart = new Date(String(formData.get("weekStart") ?? ""));
  if (Number.isNaN(weekStart.getTime())) {
    return { ok: false, message: "That week could not be read. Reload and try again." };
  }

  const accountId = String(formData.get("accountId") ?? "");
  const [live] = await db
    .select({
      accountId: bidWeeks.accountId,
      bids: bidWeeks.bids,
      chatsOpened: bidWeeks.chatsOpened,
      contracted: bidWeeks.contracted,
      closed: bidWeeks.closed,
      withdrawn: bidWeeks.withdrawn,
      enteredByUserId: bidWeeks.enteredByUserId,
      label: accounts.label,
    })
    .from(bidWeeks)
    .innerJoin(accounts, eq(accounts.id, bidWeeks.accountId))
    .where(and(eq(bidWeeks.accountId, accountId), eq(bidWeeks.weekStart, weekStart)))
    .limit(1);

  if (!live) {
    return { ok: false, message: "There are no counts stored for that week yet." };
  }

  const deletedAt = new Date();
  const [trashed] = await db
    .insert(bidWeekTrash)
    .values({
      accountId: live.accountId,
      weekStart,
      bids: live.bids,
      chatsOpened: live.chatsOpened,
      contracted: live.contracted,
      closed: live.closed,
      withdrawn: live.withdrawn,
      enteredByUserId: live.enteredByUserId,
      deletedByUserId: actor.id,
      deletedAt,
    })
    .returning({ id: bidWeekTrash.id });

  await db
    .delete(bidWeeks)
    .where(and(eq(bidWeeks.accountId, accountId), eq(bidWeeks.weekStart, weekStart)));

  revalidatePath("/week");
  return {
    ok: true,
    message: `Moved ${live.label} to the trash.`,
    accountId: live.accountId,
    entry: {
      id: trashed.id,
      accountId: live.accountId,
      accountLabel: live.label,
      weekStartIso: weekStart.toISOString(),
      weekLabel: formatPktWeek(weekStart),
      bids: num(live.bids),
      chatsOpened: num(live.chatsOpened),
      contracted: num(live.contracted),
      closed: num(live.closed),
      withdrawn: num(live.withdrawn),
      deletedByName: actor.name,
      deletedAtIso: deletedAt.toISOString(),
      daysLeft: trashDaysLeft(deletedAt, deletedAt),
    },
  };
}

/**
 * Putting a trashed row back. It refuses rather than overwrites when somebody
 * has since typed counts into that same slot: silently replacing their
 * numbers with older ones would be the one way this feature could lose work.
 */
export async function restoreWeekCounts(
  _prev: RestoreCountsResult | null,
  formData: FormData,
): Promise<RestoreCountsResult> {
  const actor = await requireUser();
  const id = String(formData.get("trashId") ?? "");

  const [entry] = await db
    .select({
      id: bidWeekTrash.id,
      accountId: bidWeekTrash.accountId,
      weekStart: bidWeekTrash.weekStart,
      bids: bidWeekTrash.bids,
      chatsOpened: bidWeekTrash.chatsOpened,
      contracted: bidWeekTrash.contracted,
      closed: bidWeekTrash.closed,
      withdrawn: bidWeekTrash.withdrawn,
      enteredByUserId: bidWeekTrash.enteredByUserId,
      label: accounts.label,
    })
    .from(bidWeekTrash)
    .innerJoin(accounts, eq(accounts.id, bidWeekTrash.accountId))
    .where(eq(bidWeekTrash.id, id))
    .limit(1);

  if (!entry) {
    return { ok: false, message: "That entry has already gone from the trash." };
  }

  const [clash] = await db
    .select({ accountId: bidWeeks.accountId })
    .from(bidWeeks)
    .where(
      and(
        eq(bidWeeks.accountId, entry.accountId),
        eq(bidWeeks.weekStart, entry.weekStart),
      ),
    )
    .limit(1);

  if (clash) {
    return {
      ok: false,
      message: `${entry.label} already has counts for that week. Delete those first if you want these back.`,
    };
  }

  await db.insert(bidWeeks).values({
    accountId: entry.accountId,
    weekStart: entry.weekStart,
    bids: entry.bids,
    chatsOpened: entry.chatsOpened,
    contracted: entry.contracted,
    closed: entry.closed,
    withdrawn: entry.withdrawn,
    // Attribution follows the numbers, not whoever pressed restore.
    enteredByUserId: entry.enteredByUserId ?? actor.id,
  });

  await db.delete(bidWeekTrash).where(eq(bidWeekTrash.id, id));

  revalidatePath("/week");
  return {
    ok: true,
    message: `Restored ${entry.label}.`,
    id: entry.id,
    accountId: entry.accountId,
    weekStartIso: entry.weekStart.toISOString(),
    counts: {
      bids: num(entry.bids),
      chatsOpened: num(entry.chatsOpened),
      contracted: num(entry.contracted),
      closed: num(entry.closed),
      withdrawn: num(entry.withdrawn),
    },
  };
}

/** numeric columns take strings; null has to stay null rather than become "0". */
function str(n: number | null): string | null {
  return n === null ? null : String(n);
}

/** The trip back: a numeric column read as a string, or a genuine null. */
function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}
