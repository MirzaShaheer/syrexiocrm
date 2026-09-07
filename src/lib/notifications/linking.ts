import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { telegramLinkCodes, users } from "@/db/schema";

/** Fifteen minutes, as specified. Long enough to switch apps, short enough. */
export const CODE_TTL_MINUTES = 15;

/**
 * Crockford-ish alphabet: no I, O, 0 or 1, because these get read off a screen
 * and typed into a phone. Formatted ABCD-2345 for the same reason.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export type LiveCode = { code: string; expiresAt: Date };

/**
 * Issues a fresh code and retires any the user still had outstanding, so only
 * the code currently on screen can ever work.
 */
export async function issueLinkCode(userId: string): Promise<LiveCode> {
  const now = new Date();

  await db
    .update(telegramLinkCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(telegramLinkCodes.userId, userId),
        isNull(telegramLinkCodes.usedAt),
      ),
    );

  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);

  // Collisions are vanishingly unlikely, but a unique index means a retry is
  // cheaper than an outage.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    try {
      await db.insert(telegramLinkCodes).values({ userId, code, expiresAt });
      return { code, expiresAt };
    } catch {
      if (attempt === 4) throw new Error("Could not generate a link code");
    }
  }
  throw new Error("Could not generate a link code");
}

/** The user's current unused, unexpired code, if they have one. */
export async function getLiveCode(userId: string): Promise<LiveCode | null> {
  const [row] = await db
    .select({
      code: telegramLinkCodes.code,
      expiresAt: telegramLinkCodes.expiresAt,
    })
    .from(telegramLinkCodes)
    .where(
      and(
        eq(telegramLinkCodes.userId, userId),
        isNull(telegramLinkCodes.usedAt),
        gt(telegramLinkCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(telegramLinkCodes.createdAt))
    .limit(1);
  return row ?? null;
}

export type RedeemResult =
  | { outcome: "linked"; userId: string; name: string; role: string }
  | { outcome: "unknown" }
  | { outcome: "expired" }
  | { outcome: "used" };

/**
 * Redeems a code and binds the chat id to that user. Single use: the code is
 * marked spent in the same breath, so a code shared by accident cannot link a
 * second person.
 */
export async function redeemLinkCode(
  rawCode: string,
  chatId: string,
): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  const now = new Date();

  const [row] = await db
    .select({
      id: telegramLinkCodes.id,
      userId: telegramLinkCodes.userId,
      expiresAt: telegramLinkCodes.expiresAt,
      usedAt: telegramLinkCodes.usedAt,
    })
    .from(telegramLinkCodes)
    .where(eq(telegramLinkCodes.code, code))
    .limit(1);

  if (!row) return { outcome: "unknown" };
  if (row.usedAt) return { outcome: "used" };
  if (row.expiresAt <= now) return { outcome: "expired" };

  const [user] = await db
    .select({ id: users.id, name: users.name, role: users.role, active: users.active })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (!user || !user.active) return { outcome: "unknown" };

  await db
    .update(telegramLinkCodes)
    .set({ usedAt: now })
    .where(eq(telegramLinkCodes.id, row.id));

  await db
    .update(users)
    .set({ telegramChatId: chatId, telegramLinkedAt: now })
    .where(eq(users.id, user.id));

  return {
    outcome: "linked",
    userId: user.id,
    name: user.name,
    role: user.role,
  };
}

export async function unlinkUser(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ telegramChatId: null, telegramLinkedAt: null })
    .where(eq(users.id, userId));

  await db
    .update(telegramLinkCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(telegramLinkCodes.userId, userId),
        isNull(telegramLinkCodes.usedAt),
      ),
    );
}
