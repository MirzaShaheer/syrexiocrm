"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, contracts, events } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  addNoteFor,
  handOverFor,
  postUpdateFor,
  setNextActionFor,
  snoozeAlertFor,
} from "@/lib/ops";
import { canEditContract } from "@/lib/permissions";
import { isValidStage, stageLabel, type Niche } from "@/lib/pipelines";
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
 * Deliberately empty, and it has to stay that way.
 *
 * A server action dispatched from a form on this screen must not call
 * revalidatePath at all — not even for a different route. Measured on a clean
 * production build: with either revalidatePath("/today") or revalidatePath("/")
 * the action hung 10 times out of 10; with neither, 0 out of 10. The server
 * finishes its work and answers 200 with a complete payload in ~110ms, but the
 * client never applies it, so useActionState never settles and the button sits
 * on "Saving…" forever. The earlier version of this function excluded only the
 * contract's own path, which was not enough.
 *
 * Freshness is handled on the client instead: every form here calls
 * router.refresh() once its result lands (useRefreshOnSuccess), and the other
 * screens are dynamic, so navigating to them refetches anyway.
 */
function touch(_contractId: string) {}

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
  const result = await postUpdateFor(
    actor,
    contractId,
    String(formData.get("body") ?? ""),
  );
  if (result.ok) touch(contractId);
  return result;
}

/* ------------------------------------------------------------------ notes */

/** Internal only. Never client facing, and separate from the standup record. */
export async function addNote(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const contractId = String(formData.get("contractId") ?? "");
  const result = await addNoteFor(
    actor,
    contractId,
    String(formData.get("body") ?? ""),
  );
  if (result.ok) touch(contractId);
  return result;
}

/* ------------------------------------------------------------ next action */

export async function setNextAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const contractId = String(formData.get("contractId") ?? "");
  const due = String(formData.get("dueAt") ?? "").trim();
  // datetime-local arrives as the user's wall clock; the team works in PKT.
  const result = await setNextActionFor(
    actor,
    contractId,
    String(formData.get("text") ?? ""),
    due ? new Date(`${due}:00+05:00`) : null,
  );
  if (result.ok) touch(contractId);
  return result;
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
  const result = await handOverFor(
    actor,
    contractId,
    String(formData.get("toUserId") ?? ""),
    String(formData.get("reason") ?? ""),
  );
  if (result.ok) touch(contractId);
  return result;
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
  const result = await snoozeAlertFor(
    actor,
    String(formData.get("alertId") ?? ""),
    String(formData.get("duration") ?? ""),
    String(formData.get("reason") ?? ""),
  );
  // No revalidatePath — see touch() above. Both screens that snooze an alert
  // refresh from the client once the result lands.
  return result;
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
