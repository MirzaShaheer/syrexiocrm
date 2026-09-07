import "server-only";
import type { NotificationTransport, SendResult } from "./transport";

/**
 * The default. With TELEGRAM_ENABLED unset or false, every message is printed
 * and written to the notifications table instead of being delivered, so the
 * whole flow can be exercised without messaging a real person.
 */
export const consoleTransport: NotificationTransport = {
  channel: "console",

  async sendMessage(chatId: string, text: string): Promise<SendResult> {
    const rule = "─".repeat(58);
    console.log(
      [
        "",
        rule,
        `NOTIFICATION (not sent — TELEGRAM_ENABLED is not true)`,
        `to chat ${chatId}`,
        rule,
        text,
        rule,
        "",
      ].join("\n"),
    );
    return { ok: true };
  },
};
