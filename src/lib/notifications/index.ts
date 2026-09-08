import "server-only";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { isOffShiftPkt, nextShiftStartPkt } from "@/lib/time";
import { consoleTransport } from "./console";
import { telegramTransport } from "./telegram";
import {
  redact,
  type InlineButton,
  type NotificationTransport,
} from "./transport";

/**
 * The one place the product sends anything. Calling code hands over a user,
 * a template and a body; this decides which channel, whether it is a decent
 * hour to send, and records the outcome either way.
 */

/**
 * Default off, so nobody gets messaged by accident on a fresh checkout.
 *
 * Forgiving about how "on" is spelled. A strict `=== "true"` cost an afternoon
 * of deployment debugging once: the variable was present and correct in the
 * dashboard, and the app read it as off because of a stray space. A dashboard
 * field is typed by a person, and `True`, `TRUE`, `1`, `yes` and `true ` all
 * plainly mean the same thing. Anything genuinely unrecognised still reads as
 * off — this loosens the spelling, not the default.
 */
export function telegramEnabled(): boolean {
  const raw = process.env.TELEGRAM_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

/** Swap this one line to move the whole product onto WhatsApp later. */
export function resolveTransport(): NotificationTransport {
  return telegramEnabled() && process.env.TELEGRAM_BOT_TOKEN
    ? telegramTransport
    : consoleTransport;
}

export type NotifyInput = {
  userId: string;
  template: string;
  body: string;
  contractId?: string | null;
  alertId?: string | null;
  /** Buttons under the message. Survive a hold — see the schema comment. */
  keyboard?: InlineButton[][];
  /** Opens the reply box quoting this message. */
  forceReply?: boolean;
  /**
   * Skip the hold. For something the user just did, and for any rule counting
   * down to a deadline — see `bypassQuietHours` in lib/alert-rules.ts. A
   * deadline does not keep office hours, and being told at six that something
   * was due at two is a post-mortem, not an alert.
   */
  immediate?: boolean;
};

export type NotifyOutcome =
  | { status: "sent"; chatId: string; messageId?: string }
  | { status: "queued"; until: Date }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/**
 * Sends now, or parks it until the shift starts. Either way a row lands in
 * `notifications`, so a message that never arrived is visible rather than
 * silently absent.
 */
export async function notify(input: NotifyInput): Promise<NotifyOutcome> {
  const transport = resolveTransport();
  const now = new Date();

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      telegramChatId: users.telegramChatId,
      active: users.active,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  const base = {
    userId: input.userId,
    contractId: input.contractId ?? null,
    alertId: input.alertId ?? null,
    channel: transport.channel,
    template: input.template,
    body: input.body,
    keyboard: input.keyboard ?? null,
  };

  // Not linked yet, or deactivated: record it so Settings can show the gap.
  if (!user || !user.active || !user.telegramChatId) {
    const reason = !user
      ? "user not found"
      : !user.active
        ? "user is deactivated"
        : "no Telegram account linked";
    await db.insert(notifications).values({
      ...base,
      chatId: null,
      status: "skipped",
      error: reason,
    });
    return { status: "skipped", reason };
  }

  // Outside the hours anyone is awake: hold it rather than drop it.
  if (!input.immediate && isOffShiftPkt(now)) {
    const until = nextShiftStartPkt(now);
    await db.insert(notifications).values({
      ...base,
      chatId: user.telegramChatId,
      status: "queued",
      scheduledFor: until,
    });
    return { status: "queued", until };
  }

  const result = await transport.sendMessage(user.telegramChatId, input.body, {
    keyboard: input.keyboard,
    forceReply: input.forceReply,
  });

  await db.insert(notifications).values({
    ...base,
    chatId: user.telegramChatId,
    messageId: result.ok ? (result.messageId ?? null) : null,
    status: result.ok ? "sent" : "failed",
    sentAt: result.ok ? new Date() : null,
    attempts: "1",
    error: result.ok ? null : redact(result.error),
  });

  return result.ok
    ? { status: "sent", chatId: user.telegramChatId, messageId: result.messageId }
    : { status: "failed", error: redact(result.error) };
}

/**
 * Sends straight to a chat id and logs it, for replies inside a conversation
 * the person is already having with the bot. `notify()` cannot be used there:
 * during linking there may be no user to look up yet, and an answer to
 * something somebody just typed has to go out whatever the hour — it is a
 * reply, not an alert.
 */
export async function sendToChat(input: {
  chatId: string;
  template: string;
  body: string;
  userId?: string | null;
  contractId?: string | null;
  alertId?: string | null;
  keyboard?: InlineButton[][];
  forceReply?: boolean;
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const transport = resolveTransport();
  const result = await transport.sendMessage(input.chatId, input.body, {
    keyboard: input.keyboard,
    forceReply: input.forceReply,
  });

  await db.insert(notifications).values({
    userId: input.userId ?? null,
    contractId: input.contractId ?? null,
    alertId: input.alertId ?? null,
    channel: transport.channel,
    template: input.template,
    body: input.body,
    keyboard: input.keyboard ?? null,
    chatId: input.chatId,
    messageId: result.ok ? (result.messageId ?? null) : null,
    status: result.ok ? "sent" : "failed",
    sentAt: result.ok ? new Date() : null,
    attempts: "1",
    error: result.ok ? null : redact(result.error),
  });

  return result.ok
    ? { ok: true, messageId: result.messageId }
    : { ok: false, error: redact(result.error) };
}

/**
 * The group chat, when TELEGRAM_GROUP_CHAT_ID is set.
 *
 * Everything sent here is deliberately about the agency rather than about one
 * person: a contract won, an alert nobody owns, the shift-end summary. It
 * quietly does nothing when no group is configured, because a half-finished
 * bit of setup must not fail the run that was trying to post to it.
 */
export async function sendToGroup(input: {
  template: string;
  body: string;
  contractId?: string | null;
  alertId?: string | null;
  keyboard?: InlineButton[][];
}): Promise<{ ok: boolean; skipped?: boolean }> {
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID?.trim();
  if (!chatId || !/^-?\d+$/.test(chatId)) return { ok: true, skipped: true };

  const result = await sendToChat({ ...input, chatId });
  return { ok: result.ok };
}

/**
 * Sends anything whose hold has expired. Called by the cron; safe to run at
 * any time because it only picks up rows whose `scheduledFor` has passed.
 */
export async function flushQueued(limit = 50): Promise<{
  sent: number;
  failed: number;
}> {
  const transport = resolveTransport();
  const now = new Date();

  const due = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.status, "queued"),
        or(
          isNull(notifications.scheduledFor),
          lte(notifications.scheduledFor, now),
        ),
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(limit);

  let sent = 0;
  let failed = 0;

  for (const row of due) {
    if (!row.chatId) {
      await db
        .update(notifications)
        .set({ status: "skipped", error: "no Telegram account linked" })
        .where(eq(notifications.id, row.id));
      continue;
    }

    const result = await transport.sendMessage(row.chatId, row.body, {
      // The buttons it was written with, hours ago. An alert that arrives
      // without them is back to being something you need a laptop for.
      keyboard: row.keyboard ?? undefined,
    });
    await db
      .update(notifications)
      .set({
        status: result.ok ? "sent" : "failed",
        sentAt: result.ok ? new Date() : null,
        messageId: result.ok ? (result.messageId ?? null) : null,
        attempts: String(Number(row.attempts) + 1),
        error: result.ok ? null : redact(result.error),
      })
      .where(eq(notifications.id, row.id));

    if (result.ok) sent++;
    else failed++;
  }

  return { sent, failed };
}
