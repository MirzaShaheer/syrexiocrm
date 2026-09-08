import "server-only";

/**
 * The contract every channel implements. Calling code only ever sees this, so
 * swapping Telegram for WhatsApp later is a one-line change in `resolve()` and
 * nothing else in the product moves.
 */

/**
 * One tappable button. `data` is what comes back when it is pressed, and
 * Telegram caps it at 64 bytes — see lib/bot/callbacks.ts, which is the only
 * place allowed to build one.
 */
export type InlineButton = { text: string; data: string };

export type SendOptions = {
  /** Rows of buttons under the message. */
  keyboard?: InlineButton[][];
  /**
   * Opens the reply box with this message quoted. The answer arrives back
   * carrying the id of the message it replied to, which is the only thread
   * Telegram gives us between a question and its answer.
   */
  forceReply?: boolean;
};

export type SendResult =
  | {
      ok: true;
      /** The sent message's id, when the channel reports one. */
      messageId?: string;
    }
  | {
      ok: false;
      /** Already redacted. Safe to store and to show a person. */
      error: string;
      /** Set when the channel asked us to wait, in seconds. */
      retryAfter?: number;
      /**
       * The recipient blocked the bot or deleted the chat. Retrying never
       * helps, and the link should be treated as broken rather than flaky.
       */
      blocked?: boolean;
    };

export interface NotificationTransport {
  /** Which channel this is, for the notifications log. */
  readonly channel: "telegram" | "console";
  sendMessage(
    chatId: string,
    text: string,
    options?: SendOptions,
  ): Promise<SendResult>;
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
