import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { OpsActor } from "@/lib/ops";
import type { Role } from "@/lib/permissions";

/**
 * Who is on the other end of a chat.
 *
 * This is the bot's entire authentication story, and it is worth being clear
 * about what it rests on: a chat id is bound to a person once, by that person
 * redeeming a single-use code from Settings, and Telegram will not let anyone
 * else send from that chat. So the chat id is the credential.
 *
 * What it is *not* is an authorisation. The actor this returns is handed
 * straight to lib/ops, which asks lib/permissions the same questions it asks
 * for a web request. A linked chat means "we know who you are", never "yes".
 */
export async function actorForChat(chatId: string): Promise<OpsActor | null> {
  if (!chatId) return null;

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      adminUntil: users.adminUntil,
      active: users.active,
    })
    .from(users)
    .where(and(eq(users.telegramChatId, chatId), eq(users.active, true)))
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role as Role,
    adminUntil: row.adminUntil,
  };
}

/**
 * Everyone who can currently be reached, for the messages that go to the whole
 * team — an alert nobody has answered, a contract won, a shift-end summary.
 */
export async function linkedTeam(): Promise<
  { userId: string; name: string; chatId: string; role: Role }[]
> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      chatId: users.telegramChatId,
      active: users.active,
    })
    .from(users)
    .where(eq(users.active, true));

  return rows
    .filter((r): r is typeof r & { chatId: string } => Boolean(r.chatId))
    .map((r) => ({
      userId: r.id,
      name: r.name,
      chatId: r.chatId,
      role: r.role as Role,
    }));
}

/**
 * The group chat, when one is configured.
 *
 * Set TELEGRAM_GROUP_CHAT_ID to the id of a group the bot has been added to.
 * Group ids are negative, which is the usual way this is got wrong — a value
 * without the minus sign silently addresses a private chat that does not
 * exist, and every group message fails as "chat not found".
 */
export function groupChatId(): string | null {
  const raw = process.env.TELEGRAM_GROUP_CHAT_ID?.trim();
  if (!raw) return null;
  return /^-?\d+$/.test(raw) ? raw : null;
}
