"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { alerts, contracts, events, notes, updates, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { canEditContract, canAssignOwner } from "@/lib/permissions";
import { RULES, SNOOZE_DURATIONS, type RuleKey } from "@/lib/alert-rules";
import { isValidStage, stageLabel, type Niche } from "@/lib/pipelines";
import { formatPktDateTime } from "@/lib/time";
import type { ActionResult } from "@/lib/actions/contracts";

/** Loads the contract and checks the actor may change fields on it. */
async function loadContract(contractId: string) {
  const [row] = await db
    .select({
      id: contracts.id,
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

const DENIED =
  "This record was created by someone else. Ask them to make the change, or ask Mir for temporary edit access.";

/*
 * Revalidates the screens a change affects, but never the contract page
 * itself: revalidating the route a form is rendered on leaves the action
 * response hanging, so the button sits on "Saving…" forever. The contract
 * page refreshes from the client once the result arrives.
 */
function touch(_contractId: string) {
  revalidatePath("/today");
  revalidatePath("/");
}

/* ---------------------------------------------------------------- updates */

/**
 * Today's standup line. Anyone may post one on any contract — appending can
 * never damage somebody else's work, and a contract nobody can update is a
 * contract that goes stale.
 */
export async function postUpdate(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const contractId = String(formData.get("contractId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return { ok: false, message: "Write a line before posting." };
  if (body.length > 2000) {
    return { ok: false, message: "That is too long for an update. Keep it to a line or two." };
  }

  const contract = await loadContract(contractId);
  if (!contract) return { ok: false, message: "That contract no longer exists." };

  const at = new Date();
  await db.insert(updates).values({ contractId, authorUserId: actor.id, body, createdAt: at });
  await db.insert(events).values({
    contractId,
    type: "update_posted",
    actor: actor.id,
    payload: { excerpt: body.slice(0, 120) },
    occurredAt: at,
  });
  await db
    .update(contracts)
    .set({ lastUpdateAt: at, updatedAt: at })
    .where(eq(contracts.id, contractId));

  touch(contractId);
  return { ok: true, message: "Update posted." };
}

/* ------------------------------------------------------------------ notes */

/** Internal only. Never client facing, and separate from the standup record. */
export async function addNote(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const contractId = String(formData.get("contractId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return { ok: false, message: "Write the note before saving." };

  const contract = await loadContract(contractId);
  if (!contract) return { ok: false, message: "That contract no longer exists." };

  await db.insert(notes).values({ contractId, authorUserId: actor.id, body });
  await db.insert(events).values({
    contractId,
    type: "note_added",
    actor: actor.id,
    payload: { excerpt: body.slice(0, 120) },
  });

  touch(contractId);
  return { ok: true, message: "Note saved." };
}

/* ------------------------------------------------------------ next action */

export async function setNextAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const contractId = String(formData.get("contractId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  const due = String(formData.get("dueAt") ?? "").trim();

  const contract = await loadContract(contractId);
  if (!contract) return { ok: false, message: "That contract no longer exists." };
  if (!canEditContract(actor, contract)) return { ok: false, message: DENIED };

  if (text && !due) {
    return {
      ok: false,
      message: "A next action needs a due date, otherwise nothing ever chases it.",
    };
  }

  // datetime-local arrives as the user's wall clock; the team works in PKT.
  const dueAt = due ? new Date(`${due}:00+05:00`) : null;
  if (due && Number.isNaN(dueAt!.getTime())) {
    return { ok: false, message: "That date could not be read. Pick it again." };
  }

  await db
    .update(contracts)
    .set({ nextActionText: text || null, nextActionDueAt: dueAt, updatedAt: new Date() })
    .where(eq(contracts.id, contractId));

  await db.insert(events).values({
    contractId,
    type: "next_action_changed",
    actor: actor.id,
    payload: {
      text: text || null,
      dueAt: dueAt ? dueAt.toISOString() : null,
    },
  });

  touch(contractId);
  return { ok: true, message: text ? "Next action set." : "Next action cleared." };
}

/* ------------------------------------------------------------------ stage */

export async function setStage(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const contractId = String(formData.get("contractId") ?? "");
  const stage = String(formData.get("stage") ?? "");
  const niche = String(formData.get("niche") ?? "") as Niche;

  const contract = await loadContract(contractId);
  if (!contract) return { ok: false, message: "That contract no longer exists." };
  if (!canEditContract(actor, contract)) return { ok: false, message: DENIED };
  if (!isValidStage(niche, stage)) {
    return { ok: false, message: "That stage does not belong to this pipeline." };
  }
  if (stage === contract.stage) return { ok: true, message: "No change." };

  await db
    .update(contracts)
    .set({ stage, updatedAt: new Date() })
    .where(eq(contracts.id, contractId));

  await db.insert(events).values({
    contractId,
    type: "stage_changed",
    actor: actor.id,
    payload: { from: contract.stage, to: stage, toLabel: stageLabel(niche, stage) },
  });

  touch(contractId);
  return { ok: true, message: `Moved to ${stageLabel(niche, stage)}.` };
}

/* --------------------------------------------------------------- handover */

/**
 * Changing an owner is a first-class act, not a dropdown. It records who
 * handed over, to whom, when and why, and it lands in the timeline.
 */
export async function handOver(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const contractId = String(formData.get("contractId") ?? "");
  const toUserId = String(formData.get("toUserId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!toUserId) return { ok: false, message: "Choose who is taking this on." };

  const contract = await loadContract(contractId);
  if (!contract) return { ok: false, message: "That contract no longer exists." };
  if (!canAssignOwner(actor, contract)) {
    return {
      ok: false,
      message:
        "Somebody else owns this one. Ask them to hand it over, or ask Mir for temporary edit access.",
    };
  }
  if (contract.ownerUserId && !reason) {
    return {
      ok: false,
      message: "Say why it is moving. A handover with no reason is how context gets lost.",
    };
  }

  const [assignee] = await db
    .select({ id: users.id, name: users.name, active: users.active })
    .from(users)
    .where(eq(users.id, toUserId))
    .limit(1);
  if (!assignee || !assignee.active) {
    return { ok: false, message: "That person is no longer active. Pick somebody else." };
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
      reason: reason || null,
    },
  });

  touch(contractId);
  return {
    ok: true,
    message: previous ? `Handed to ${assignee.name}.` : `Assigned to ${assignee.name}.`,
  };
}

/* ----------------------------------------------------------------- snooze */

/**
 * A snoozed alert stays open — it is still a real problem — but drops off the
 * board until the snooze passes. Without this, people learn to ignore the
 * alert list, and then the whole system is dead. The reason is required and
 * goes in the timeline, so a snooze is a decision on the record, not a mute.
 */
export async function snoozeAlert(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const alertId = String(formData.get("alertId") ?? "");
  const durationKey = String(formData.get("duration") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!reason) {
    return { ok: false, message: "Give a reason. Snoozing without one is just hiding it." };
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
    .set({ snoozedUntil: until, snoozeReason: reason, snoozedByUserId: actor.id })
    .where(eq(alerts.id, alertId));

  await db.insert(events).values({
    contractId: alert.contractId,
    type: "alert_snoozed",
    actor: actor.id,
    payload: {
      ruleKey: alert.ruleKey,
      ruleLabel: RULES[alert.ruleKey as RuleKey]?.label ?? alert.ruleKey,
      reason,
      until: until.toISOString(),
      untilLabel: formatPktDateTime(until),
    },
  });

  touch(alert.contractId);
  return { ok: true, message: `Snoozed for ${duration.label.toLowerCase()}.` };
}

export async function unsnoozeAlert(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireUser();
  const alertId = String(formData.get("alertId") ?? "");

  const [alert] = await db
    .select({ id: alerts.id, contractId: alerts.contractId })
    .from(alerts)
    .where(eq(alerts.id, alertId))
    .limit(1);
  if (!alert) return { ok: false, message: "That alert no longer exists." };

  await db
    .update(alerts)
    .set({ snoozedUntil: null, snoozeReason: null, snoozedByUserId: null })
    .where(eq(alerts.id, alertId));

  touch(alert.contractId);
  return { ok: true, message: "Back on the board." };
}
