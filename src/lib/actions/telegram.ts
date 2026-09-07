"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isOwner } from "@/lib/permissions";
import { issueLinkCode, unlinkUser } from "@/lib/notifications/linking";
import { notify } from "@/lib/notifications";
import { testMessage } from "@/lib/notifications/templates";
import type { ActionResult } from "@/lib/actions/contracts";

/** A person may only ever generate a code for themselves. */
export async function generateLinkCode(
  _prev: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  try {
    const { code } = await issueLinkCode(actor.id);
    revalidatePath("/settings");
    return { ok: true, message: `New code ready: ${code}` };
  } catch {
    return {
      ok: false,
      message: "Could not generate a code just now. Try again in a moment.",
    };
  }
}

/** Yourself always; anyone else only if you are the owner. */
export async function unlinkTelegram(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const targetId = String(formData.get("userId") ?? "") || actor.id;

  if (targetId !== actor.id && !isOwner(actor)) {
    return {
      ok: false,
      message: "Only Mir can unlink somebody else's Telegram account.",
    };
  }

  const [target] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  if (!target) return { ok: false, message: "That person no longer exists." };

  await unlinkUser(targetId);
  revalidatePath("/settings");
  return {
    ok: true,
    message:
      targetId === actor.id
        ? "Unlinked. You will not get messages until you link again."
        : `Unlinked ${target.name}.`,
  };
}

/** Proves the whole path end to end without waiting for a real alert. */
export async function sendTestMessage(
  _prev: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const { body, template } = testMessage(actor.name);

  const outcome = await notify({
    userId: actor.id,
    template,
    body,
    // A test the user just asked for should not wait until morning.
    immediate: true,
  });

  revalidatePath("/settings");

  switch (outcome.status) {
    case "sent":
      return { ok: true, message: "Sent. Check Telegram." };
    case "skipped":
      return { ok: false, message: `Not sent — ${outcome.reason}.` };
    case "failed":
      return { ok: false, message: `Failed — ${outcome.error}` };
    default:
      return { ok: true, message: "Queued." };
  }
}
