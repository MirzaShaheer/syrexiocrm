"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { createSession, requireUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import type { ActionResult } from "@/lib/actions/contracts";

/**
 * Your own password, changed by you.
 *
 * Deliberately the only account setting in the product: everything else about
 * a person — their role, whether they are active, whether they hold edit
 * rights — is the owner's to decide, and a settings page full of things you
 * cannot change is worse than no settings page.
 *
 * Resetting somebody *else's* password stays outside the app, in
 * `npm run set-password`. A screen that can change another person's
 * credentials is a screen worth attacking, and it would be used about twice a
 * year.
 */

/** Long enough to matter, short enough that nobody writes it on a sticky note. */
const MIN_LENGTH = 12;

export async function changePassword(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!current || !next || !confirm) {
    return { ok: false, message: "Fill in all three boxes." };
  }
  if (next !== confirm) {
    return { ok: false, message: "The two new passwords do not match." };
  }
  if (next.length < MIN_LENGTH) {
    return {
      ok: false,
      message: `Too short — ${MIN_LENGTH} characters minimum. A long ordinary phrase beats a short clever one.`,
    };
  }
  if (next === current) {
    return { ok: false, message: "That is the password you already have." };
  }

  const [row] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);
  if (!row) return { ok: false, message: "That account no longer exists." };

  /*
    The current password is required even though the session already proves
    who you are. A session can be borrowed — a laptop left open is the whole
    threat here — and the one thing an attacker must not be able to do with a
    borrowed session is lock the real owner out of their own account.
  */
  if (!(await verifyPassword(current, row.passwordHash))) {
    return { ok: false, message: "That is not your current password." };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, actor.id));

  /*
    Every session for this person goes, then a fresh one is issued for the
    browser doing the changing. If you changed your password because somebody
    else had your login, leaving their session alive would defeat the entire
    exercise — and signing yourself out as a reward for good security is a
    good way to teach people not to bother.
  */
  await db.delete(sessions).where(eq(sessions.userId, actor.id));
  await createSession(actor.id);

  return {
    ok: true,
    message: "Password changed. Any other browser signed in as you has been signed out.",
  };
}
