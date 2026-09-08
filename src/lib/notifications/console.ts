import "server-only";
import type { NotificationTransport, SendOptions, SendResult } from "./transport";

/**
 * The default. With TELEGRAM_ENABLED unset or false, every message is printed
 * and written to the notifications table instead of being delivered, so the
 * whole flow can be exercised without messaging a real person.
 */
/**
 * Telegram numbers its messages, and the bot's force-reply bookkeeping keys
 * off that number. Handing back something unparseable here would make every
 * ask-then-answer round trip fail in test mode only, which is exactly the
 * class of bug test mode exists to catch.
 */
let fakeMessageId = 1000;

export const consoleTransport: NotificationTransport = {
  channel: "console",

  async sendMessage(
    chatId: string,
    text: string,
    options?: SendOptions,
  ): Promise<SendResult> {
    const rule = "─".repeat(58);
    const buttons = (options?.keyboard ?? [])
      .map((row) => row.map((b) => `[ ${b.text} ]`).join("  "))
      .join("\n");

    console.log(
      [
        "",
        rule,
        "NOTIFICATION (not sent — TELEGRAM_ENABLED is not true)",
        `to chat ${chatId}`,
        rule,
        text,
        ...(buttons ? [rule, buttons] : []),
        ...(options?.forceReply ? [rule, "(waiting for a reply)"] : []),
        rule,
        "",
      ].join("\n"),
    );
    return { ok: true, messageId: String(++fakeMessageId) };
  },
};
