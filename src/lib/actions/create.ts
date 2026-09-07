"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bidWeeks, clients, contracts, events, milestones, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { canAssignOwner, canEditContract } from "@/lib/permissions";
import { firstStage, isValidStage } from "@/lib/pipelines";
import type { ActionResult } from "@/lib/actions/contracts";

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

  const [contract] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!contract) return { ok: false, message: "That contract no longer exists." };

  const at = new Date();
  await db
    .update(contracts)
    .set(
      direction === "in"
        ? { lastClientMessageAt: at, updatedAt: at }
        : { lastTeamMessageAt: at, updatedAt: at },
    )
    .where(eq(contracts.id, contractId));

  await db.insert(events).values({
    contractId,
    type: direction === "in" ? "message_received" : "message_sent",
    actor: actor.id,
    payload: { direction, loggedBy: actor.name },
    occurredAt: at,
  });

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/today");
  revalidatePath("/");
  return {
    ok: true,
    message: direction === "in" ? "Logged a client message." : "Logged our reply.",
  };
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

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/today");
  return { ok: true, message: "Milestone added." };
}

export async function setMilestoneStatus(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const milestoneId = String(formData.get("milestoneId") ?? "");
  const status = String(formData.get("status") ?? "") as
    | "pending"
    | "submitted"
    | "approved"
    | "cancelled";

  if (!["pending", "submitted", "approved", "cancelled"].includes(status)) {
    return { ok: false, message: "That is not a milestone status." };
  }

  const [m] = await db
    .select({
      id: milestones.id,
      contractId: milestones.contractId,
      title: milestones.title,
      amount: milestones.amount,
    })
    .from(milestones)
    .where(eq(milestones.id, milestoneId))
    .limit(1);
  if (!m) return { ok: false, message: "That milestone no longer exists." };

  const at = new Date();
  await db
    .update(milestones)
    .set({
      status,
      submittedAt: status === "submitted" ? at : undefined,
      approvedAt: status === "approved" ? at : undefined,
      updatedAt: at,
    })
    .where(eq(milestones.id, milestoneId));

  if (status === "submitted" || status === "approved") {
    await db.insert(events).values({
      contractId: m.contractId,
      type: status === "submitted" ? "milestone_submitted" : "milestone_approved",
      actor: actor.id,
      payload: { title: m.title, amount: m.amount },
      occurredAt: at,
    });
  }

  revalidatePath(`/contracts/${m.contractId}`);
  revalidatePath("/today");
  revalidatePath("/");
  return { ok: true, message: `Marked ${status}.` };
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
  const contractId = String(formData.get("contractId") ?? "");

  const [contract] = await db
    .select({ id: contracts.id, title: contracts.title })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!contract) return { ok: false, message: "That contract no longer exists." };

  const at = new Date();
  await db
    .update(contracts)
    .set({ lastTeamMessageAt: at, updatedAt: at })
    .where(eq(contracts.id, contractId));

  await db.insert(events).values({
    contractId,
    type: "message_sent",
    actor: actor.id,
    payload: { direction: "out", loggedBy: actor.name, from: "today board" },
    occurredAt: at,
  });

  revalidatePath("/today");
  revalidatePath("/");
  revalidatePath(`/contracts/${contractId}`);
  return { ok: true, message: "Logged." };
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

  revalidatePath("/today");
  revalidatePath("/");

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
 * The one number Upwork cannot tell us. Four boxes on a Monday, and the week
 * view turns them into a funnel — bids to chats to contracts won — which is
 * the only honest way to compare how the four profiles are performing.
 */
export async function saveBidCounts(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const weekStartRaw = String(formData.get("weekStart") ?? "");
  const weekStart = new Date(weekStartRaw);
  if (Number.isNaN(weekStart.getTime())) {
    return { ok: false, message: "That week could not be read. Reload and try again." };
  }

  const accountRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.active, true));

  let saved = 0;
  for (const a of accountRows) {
    const raw = String(formData.get(`bids:${a.id}`) ?? "").trim();
    if (raw === "") continue;

    const n = Number(raw.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: "Bid counts must be whole numbers." };
    }

    await db
      .insert(bidWeeks)
      .values({
        accountId: a.id,
        weekStart,
        bids: String(n),
        enteredByUserId: actor.id,
      })
      .onConflictDoUpdate({
        target: [bidWeeks.accountId, bidWeeks.weekStart],
        set: { bids: String(n), enteredByUserId: actor.id, updatedAt: new Date() },
      });
    saved++;
  }

  // Deliberately no revalidatePath here. Revalidating the route the form is
  // rendered on stalls the action response indefinitely; BidEntry calls
  // router.refresh() once the result lands, which updates the same data.
  return saved
    ? { ok: true, message: `Saved ${saved} bid ${saved === 1 ? "count" : "counts"}.` }
    : { ok: false, message: "Nothing to save — enter at least one number." };
}
