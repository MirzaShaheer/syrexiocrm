import "server-only";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { botPrompts } from "@/db/schema";

/**
 * The bot's memory of what it asked.
 *
 * Telegram carries no conversation state, so a question and its answer are
 * tied together by one thing only: the answer quotes the message id of the
 * question. That id is what gets stored here, alongside what the answer is
 * for.
 *
 * Deliberately short-lived. Somebody replying to a question from yesterday is
 * not answering it, and writing that text onto a contract would be worse than
 * ignoring it.
 */

export type PromptKind =
  | "next_action"
  | "update"
  | "note"
  | "snooze_reason"
  | "handover_reason"
  | "bids";

/** Long enough to finish typing, short enough that a stale reply is dropped. */
const DEFAULT_MINUTES = 120;
/** The Monday bid question can sit unanswered through a whole shift. */
const BIDS_MINUTES = 60 * 14;

export async function openPrompt(input: {
  chatId: string;
  messageId: string;
  userId: string;
  kind: PromptKind;
  contractId?: string | null;
  accountId?: string | null;
  alertId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const minutes = input.kind === "bids" ? BIDS_MINUTES : DEFAULT_MINUTES;

  await db
    .insert(botPrompts)
    .values({
      chatId: input.chatId,
      messageId: input.messageId,
      userId: input.userId,
      kind: input.kind,
      contractId: input.contractId ?? null,
      accountId: input.accountId ?? null,
      alertId: input.alertId ?? null,
      payload: input.payload ?? {},
      expiresAt: new Date(Date.now() + minutes * 60_000),
    })
    // A message id is unique within a chat, so a conflict means Telegram
    // redelivered an update we already recorded. Keep the first.
    .onConflictDoNothing();
}

export type OpenPrompt = {
  id: string;
  userId: string;
  kind: PromptKind;
  contractId: string | null;
  accountId: string | null;
  alertId: string | null;
  payload: Record<string, unknown>;
};

/**
 * Claims the question this message is answering, or null if there is not one.
 *
 * Marks it answered in the same statement that reads it, so two deliveries of
 * the same reply cannot both write. Telegram retries aggressively, and a
 * duplicated update posted twice is the kind of thing people stop trusting.
 */
export async function takePrompt(
  chatId: string,
  messageId: string,
): Promise<OpenPrompt | null> {
  const [row] = await db
    .update(botPrompts)
    .set({ answeredAt: new Date() })
    .where(
      and(
        eq(botPrompts.chatId, chatId),
        eq(botPrompts.messageId, messageId),
        isNull(botPrompts.answeredAt),
      ),
    )
    .returning({
      id: botPrompts.id,
      userId: botPrompts.userId,
      kind: botPrompts.kind,
      contractId: botPrompts.contractId,
      accountId: botPrompts.accountId,
      alertId: botPrompts.alertId,
      payload: botPrompts.payload,
      expiresAt: botPrompts.expiresAt,
    });

  if (!row) return null;
  if (row.expiresAt <= new Date()) return null;

  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as PromptKind,
    contractId: row.contractId,
    accountId: row.accountId,
    alertId: row.alertId,
    payload: row.payload,
  };
}

/** Housekeeping, run from the cron. Nothing depends on the count. */
export async function sweepPrompts(): Promise<number> {
  const gone = await db
    .delete(botPrompts)
    .where(lt(botPrompts.expiresAt, new Date()))
    .returning({ id: botPrompts.id });
  return gone.length;
}
