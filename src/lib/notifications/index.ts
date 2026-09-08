import "server-only";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { isNightPkt, nextMorningPkt } from "@/lib/time";
import { consoleTransport } from "./console";
import { telegramTransport } from "./telegram";
import { redact, type NotificationTransport } from "./transport";

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
  /** Skip the quiet-hours hold. Only for something the user just did. */
  immediate?: boolean;
};

export type NotifyOutcome =
  | { status: "sent" }
  | { status: "queued"; until: Date }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/**
 * Sends now, or parks it until morning. Either way a row lands in
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

  // Quiet hours: hold it rather than drop it.
  if (!input.immediate && isNightPkt(now)) {
    const until = nextMorningPkt(now);
    await db.insert(notifications).values({
      ...base,
      chatId: user.telegramChatId,
      status: "queued",
      scheduledFor: until,
    });
    return { status: "queued", until };
  }

  const result = await transport.sendMessage(user.telegramChatId, input.body);

  await db.insert(notifications).values({
    ...base,
    chatId: user.telegramChatId,
    status: result.ok ? "sent" : "failed",
    sentAt: result.ok ? new Date() : null,
    attempts: "1",
    error: result.ok ? null : redact(result.error),
  });

  return result.ok
    ? { status: "sent" }
    : { status: "failed", error: redact(result.error) };
}

/**
 * Sends straight to a chat id and logs it, for replies inside the linking
 * conversation. `notify()` cannot be used there: the person is mid-link, so
 * there may be no user to look up yet, and a reply to "/start" has to go out
 * immediately whatever the hour — it is an answer to something they just did,
 * not an alert.
 */
export async function sendToChat(input: {
  chatId: string;
  template: string;
  body: string;
  userId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const transport = resolveTransport();
  const result = await transport.sendMessage(input.chatId, input.body);

  await db.insert(notifications).values({
    userId: input.userId ?? null,
    channel: transport.channel,
    template: input.template,
    body: input.body,
    chatId: input.chatId,
    status: result.ok ? "sent" : "failed",
    sentAt: result.ok ? new Date() : null,
    attempts: "1",
    error: result.ok ? null : redact(result.error),
  });

  return result.ok ? { ok: true } : { ok: false, error: redact(result.error) };
}

/**
 * Sends anything whose hold has expired. Called by the morning cron in the
 * next phase; safe to run at any time because it only picks up rows whose
 * `scheduledFor` has passed.
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

    const result = await transport.sendMessage(row.chatId, row.body);
    await db
      .update(notifications)
      .set({
        status: result.ok ? "sent" : "failed",
        sentAt: result.ok ? new Date() : null,
        attempts: String(Number(row.attempts) + 1),
        error: result.ok ? null : redact(result.error),
      })
      .where(eq(notifications.id, row.id));

    if (result.ok) sent++;
    else failed++;
  }

  return { sent, failed };
}
