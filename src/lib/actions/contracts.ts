"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contracts, events, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { canAssignOwner } from "@/lib/permissions";

/**
 * Actions return a result rather than throwing, so a refusal renders next to
 * the control that caused it instead of replacing the page with an error
 * boundary. A denied action must always say what to do next.
 */
export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function assignOwner(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const contractId = String(formData.get("contractId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  if (!contractId || !userId) {
    return { ok: false, message: "Pick somebody to assign this to." };
  }

  const [contract] = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      ownerUserId: contracts.ownerUserId,
      createdByUserId: contracts.createdByUserId,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);

  if (!contract) {
    return { ok: false, message: "That contract no longer exists. Refresh the page." };
  }

  if (!canAssignOwner(actor, contract)) {
    return {
      ok: false,
      message:
        "Somebody else owns this one. Ask them to hand it over, or ask Mir for temporary edit access.",
    };
  }

  const [assignee] = await db
    .select({ id: users.id, name: users.name, active: users.active })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!assignee || !assignee.active) {
    return { ok: false, message: "That person is no longer active. Pick somebody else." };
  }

  const previousOwner = contract.ownerUserId;

  await db
    .update(contracts)
    .set({ ownerUserId: assignee.id, updatedAt: new Date() })
    .where(eq(contracts.id, contractId));

  // Every ownership change is a handover: who did it, to whom, from whom.
  await db.insert(events).values({
    contractId,
    type: previousOwner ? "owner_handover" : "owner_assigned",
    actor: actor.id,
    payload: {
      fromUserId: previousOwner,
      toUserId: assignee.id,
      toName: assignee.name,
      byName: actor.name,
    },
  });

  // No revalidatePath: this action is dispatched from a form on Today, and a
  // revalidating action leaves the client hanging on "Assigning…" for ever.
  // The row refreshes from the client instead. See the README trap.

  return { ok: true, message: `Assigned to ${assignee.name}.` };
}
