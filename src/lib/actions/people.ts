"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  canGrantAdmin,
  grantExpiry,
  GRANT_DURATIONS,
  type GrantDurationKey,
} from "@/lib/permissions";
import { notify } from "@/lib/notifications";
import { adminGranted, adminRevoked } from "@/lib/notifications/templates";
import type { ActionResult } from "@/lib/actions/contracts";

/**
 * Elevated access is time-boxed and only the owner hands it out. Both granting
 * and revoking tell the person on Telegram, because access you did not know
 * you had is access you will not use, and access silently removed is worse.
 */
export async function grantAdmin(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const duration = String(formData.get("duration") ?? "") as GrantDurationKey;

  const [target] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return { ok: false, message: "That person no longer exists." };

  if (!canGrantAdmin(actor, target)) {
    return {
      ok: false,
      message:
        actor.id === target.id
          ? "You cannot grant elevated access to yourself."
          : "Only Mir can grant elevated access.",
    };
  }

  const chosen = GRANT_DURATIONS.find((d) => d.key === duration);
  if (!chosen) return { ok: false, message: "Choose how long the access should last." };

  const until = grantExpiry(duration);
  await db.update(users).set({ adminUntil: until }).where(eq(users.id, userId));

  const msg = adminGranted(chosen.label, until);
  await notify({ userId, template: msg.template, body: msg.body });

  revalidatePath("/people");
  revalidatePath("/settings");
  return { ok: true, message: `${target.name} has edit access for ${chosen.label.toLowerCase()}.` };
}

export async function revokeAdmin(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") ?? "");

  const [target] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return { ok: false, message: "That person no longer exists." };

  if (!canGrantAdmin(actor, target)) {
    return { ok: false, message: "Only Mir can revoke elevated access." };
  }

  await db.update(users).set({ adminUntil: null }).where(eq(users.id, userId));

  const msg = adminRevoked();
  await notify({ userId, template: msg.template, body: msg.body });

  revalidatePath("/people");
  revalidatePath("/settings");
  return { ok: true, message: `Revoked ${target.name}'s elevated access.` };
}
