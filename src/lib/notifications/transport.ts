import "server-only";

/**
 * The contract every channel implements. Calling code only ever sees this, so
 * swapping Telegram for WhatsApp later is a one-line change in `resolve()` and
 * nothing else in the product moves.
 */
export type SendResult =
  | { ok: true }
  | {
      ok: false;
      /** Already redacted. Safe to store and to show a person. */
      error: string;
      /** Set when the channel asked us to wait, in seconds. */
      retryAfter?: number;
    };

export interface NotificationTransport {
  /** Which channel this is, for the notifications log. */
  readonly channel: "telegram" | "console";
  sendMessage(chatId: string, text: string): Promise<SendResult>;
}

/**
 * The bot token appears in the Telegram API path, so any error that echoes a
 * URL would leak it into logs and into the notifications table. Everything
 * leaving the transport goes through here first.
 */
export function redact(input: unknown): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  let text =
    input instanceof Error
      ? `${input.name}: ${input.message}`
      : typeof input === "string"
        ? input
        : JSON.stringify(input);

  if (token) text = text.split(token).join("<redacted>");
  // Belt and braces: catch any bot path even if the token differs.
  text = text.replace(/\/bot\d+:[A-Za-z0-9_-]+/g, "/bot<redacted>");
  return text.slice(0, 500);
}
