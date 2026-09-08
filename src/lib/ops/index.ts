import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  alerts,
  bidWeeks,
  contracts,
  events,
  milestones,
  notes,
  updates,
  users,
} from "@/db/schema";
import { RULES, SNOOZE_DURATIONS, type RuleKey } from "@/lib/alert-rules";
import { canAssignOwner, canEditContract, type Actor } from "@/lib/permissions";
import { formatPktDateTime } from "@/lib/time";

/**
 * The writes, with the web forms and the bot taken out of them.
 *
 * Everything here takes an actor rather than reading a session cookie, which
 * is the whole point: a button pressed in Telegram has no cookie, and the
 * alternative — a second set of write paths for the bot — would mean two
 * places to keep the permission rules, and one of them would drift.
 *
 * So the server actions in lib/actions parse a form, call one of these, and
 * revalidate. The bot resolves an actor from a chat id and calls the same one.
 * Neither of them decides who may do what; that stays in lib/permissions.
 */

export type OpsActor = Actor & { name: string };

export type OpsResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export const DENIED =
  "This record was created by someone else. Ask them to make the change, or ask Mir for temporary edit access.";

/** The fields every permission check needs. Null when it has been deleted. */
export async function loadContractFor(contractId: string) {
  if (!contractId) return null;
  const [row] = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      ownerUserId: contracts.ownerUserId,
      createdByUserId: contracts.createdByUserId,
      accountId: contracts.accountId,
      stage: contracts.stage,
      nextActionText: contracts.nextActionText,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  return row ?? null;
}

/* ---------------------------------------------------------------- updates */

export async function postUpdateFor(
  actor: OpsActor,
  contractId: string,
  body: string,
): Promise<OpsResult> {
  const text = body.trim();
  if (!text) return { ok: false, message: "Write a line before posting." };
  if (text.length > 2000) {
    return {
      ok: false,
      message: "That is too long for an update. Keep it to a few lines.",
    };
  }

  const contract = await loadContractFor(contractId);
  if (!contract) return { ok: false, message: "That contract no longer exists." };

  const at = new Date();
  await db.insert(updates).values({ contractId, authorUserId: actor.id, body: text });
  await db
    .update(contracts)
    .set({ lastUpdateAt: at, updatedAt: at })
    .where(eq(contracts.id, contractId));
  await db.insert(events).values({
    contractId,
    type: "update_posted",
    actor: actor.id,
    payload: { excerpt: text.slice(0, 120), byName: actor.name },
    occurredAt: at,
  });

  return { ok: true, message: "Update posted." };
}

export async function addNoteFor(
  actor: OpsActor,
  contractId: string,
  body: string,
): Promise<OpsResult> {
  const text = body.trim();
  if (!text) return { ok: false, message: "Write something before saving." };
  if (text.length > 2000) return { ok: false, message: "That is too long for a note." };

  const contract = await loadContractFor(contractId);
  if (!contract) return { ok: false, message: "That contract no longer exists." };

  await db.insert(notes).values({ contractId, authorUserId: actor.id, body: text });
  await db.insert(events).values({
    contractId,
    type: "note_added",
    actor: actor.id,
    payload: { excerpt: text.slice(0, 120), byName: actor.name },
  });

  return { ok: true, message: "Note saved." };
}

/* ------------------------------------------------------------ next action */

export async function setNextActionFor(
  actor: OpsActor,
  contractId: string,
  text: string,
  dueAt: Date | null,
): Promise<OpsResult> {
  const trimmed = text.trim();

  const contract = await loadContractFor(contractId);
  if (!contract) return { ok: false, message: "That contract no longer exists." };
  if (!canEditContract(actor, contract)) return { ok: false, message: DENIED };

  if (trimmed && !dueAt) {
    return {
      ok: false,
      message: "A next action needs a due date, otherwise nothing ever chases it.",
    };
  }
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return { ok: false, message: "That date could not be read. Try again." };
  }

  await db
    .update(contracts)
    .set({
      nextActionText: trimmed || null,
      nextActionDueAt: trimmed ? dueAt : null,
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, contractId));

  await db.insert(events).values({
    contractId,
    type: "next_action_changed",
    actor: actor.id,
    payload: {
      text: trimmed || null,
      dueAt: dueAt ? dueAt.toISOString() : null,
      byName: actor.name,
    },
  });

  return {
    ok: true,
    message: trimmed
      ? `Next action set${dueAt ? `, due ${formatPktDateTime(dueAt)} PKT` : ""}.`
      : "Next action cleared.",
  };
}

/* --------------------------------------------------------- message stamps */

/**
 * The two one-click stamps that keep `client_waiting` alive. `source` is
 * recorded so the timeline can say a reply was logged from a phone at 4am.
 */
export async function markActivityFor(
  actor: OpsActor,
  contractId: string,
  direction: "in" | "out",
  source: string,
): Promise<OpsResult> {
  const contract = await loadContractFor(contractId);
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
    payload: { direction, loggedBy: actor.name, from: source },
    occurredAt: at,
  });

  return {
    ok: true,
    message: direction === "in" ? "Logged a client message." : "Logged our reply.",
  };
}

/* ------------------------------------------------------------- milestones */

const MILESTONE_STATUSES = ["pending", "submitted", "approved", "cancelled"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export async function setMilestoneStatusFor(
  actor: OpsActor,
  milestoneId: string,
  status: string,
): Promise<OpsResult> {
  if (!MILESTONE_STATUSES.includes(status as MilestoneStatus)) {
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
      status: status as MilestoneStatus,
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
      payload: { title: m.title, amount: m.amount, byName: actor.name },
      occurredAt: at,
    });
  }

  return { ok: true, message: `${m.title} marked ${status}.` };
}

/* --------------------------------------------------------------- handover */

export async function handOverFor(
  actor: OpsActor,
  contractId: string,
  toUserId: string,
  reason: string,
): Promise<OpsResult> {
  if (!toUserId) return { ok: false, message: "Choose who is taking this on." };

  const contract = await loadContractFor(contractId);
  if (!contract) return { ok: false, message: "That contract no longer exists." };
  if (!canAssignOwner(actor, contract)) {
    return {
      ok: false,
      message:
        "Somebody else owns this one. Ask them to hand it over, or ask Mir for temporary edit access.",
    };
  }
  if (contract.ownerUserId && !reason.trim()) {
    return {
      ok: false,
      message:
        "Say why it is moving. A handover with no reason is how context gets lost.",
    };
  }

  const [assignee] = await db
    .select({ id: users.id, name: users.name, active: users.active })
    .from(users)
    .where(eq(users.id, toUserId))
    .limit(1);
  if (!assignee || !assignee.active) {
    return {
      ok: false,
      message: "That person is no longer active. Pick somebody else.",
    };
  }
  if (assignee.id === contract.ownerUserId) {
    return { ok: true, message: "They already own it." };
  }

  const previous = contract.ownerUserId;
  await db
    .update(contracts)
    .set({ ownerUserId: assignee.id, updatedAt: new Date() })
    .where(eq(contracts.id, contractId));

  await db.insert(events).values({
    contractId,
    type: previous ? "owner_handover" : "owner_assigned",
    actor: actor.id,
    payload: {
      fromUserId: previous,
      toUserId: assignee.id,
      toName: assignee.name,
      byName: actor.name,
      reason: reason.trim() || null,
    },
  });

  return {
    ok: true,
    message: previous
      ? `Handed to ${assignee.name}.`
      : `Assigned to ${assignee.name}.`,
  };
}

/* ----------------------------------------------------------------- snooze */

export async function snoozeAlertFor(
  actor: OpsActor,
  alertId: string,
  durationKey: string,
  reason: string,
): Promise<OpsResult> {
  const trimmed = reason.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: "Give a reason. Snoozing without one is just hiding it.",
    };
  }
  const duration = SNOOZE_DURATIONS.find((d) => d.key === durationKey);
  if (!duration) return { ok: false, message: "Choose how long to snooze it for." };

  const [alert] = await db
    .select({
      id: alerts.id,
      contractId: alerts.contractId,
      ruleKey: alerts.ruleKey,
    })
    .from(alerts)
    .where(and(eq(alerts.id, alertId), isNull(alerts.resolvedAt)))
    .limit(1);
  if (!alert) return { ok: false, message: "That alert has already been resolved." };

  const until = new Date(Date.now() + duration.hours * 3_600_000);

  await db
    .update(alerts)
    .set({ snoozedUntil: until, snoozeReason: trimmed, snoozedByUserId: actor.id })
    .where(eq(alerts.id, alertId));

  await db.insert(events).values({
    contractId: alert.contractId,
    type: "alert_snoozed",
    actor: actor.id,
    payload: {
      ruleKey: alert.ruleKey,
      ruleLabel: RULES[alert.ruleKey as RuleKey]?.label ?? alert.ruleKey,
      reason: trimmed,
      until: until.toISOString(),
      untilLabel: formatPktDateTime(until),
      byName: actor.name,
    },
  });

  return { ok: true, message: `Snoozed for ${duration.label.toLowerCase()}.` };
}

/* ------------------------------------------------------------------ bids */

/**
 * One number, for one account, for one week. The full five-box form lives on
 * the Week screen; this is the Monday-night prompt, which asks for the only
 * figure nobody can derive from anything else.
 */
export async function saveBidCountFor(
  actor: OpsActor,
  accountId: string,
  weekStart: Date,
  bids: number,
): Promise<OpsResult> {
  if (!Number.isInteger(bids) || bids < 0) {
    return { ok: false, message: "Send a whole number, like 24." };
  }
  if (bids > 99_999) return { ok: false, message: "That looks like a typo — too large." };

  const [account] = await db
    .select({ id: accounts.id, label: accounts.label })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.active, true)))
    .limit(1);
  if (!account) return { ok: false, message: "That account is no longer active." };

  await db
    .insert(bidWeeks)
    .values({
      accountId: account.id,
      weekStart,
      bids: String(bids),
      enteredByUserId: actor.id,
    })
    .onConflictDoUpdate({
      target: [bidWeeks.accountId, bidWeeks.weekStart],
      // Only the bid count. The other four boxes belong to the Week screen and
      // must not be wiped by somebody answering a one-question prompt.
      set: { bids: String(bids), enteredByUserId: actor.id, updatedAt: new Date() },
    });

  return { ok: true, message: `Saved ${bids} bids for ${account.label}.` };
}
