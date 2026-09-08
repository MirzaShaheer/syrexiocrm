import "server-only";
import {
  redact,
  type NotificationTransport,
  type SendOptions,
  type SendResult,
} from "./transport";

/**
 * The only module that touches the bot token. It is read here, used to build
 * the request URL, and never returned, logged or included in an error.
 */

const API = "https://api.telegram.org";

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

/** Never log the result of this. */
function endpoint(method: string): string {
  return `${API}/bot${token()}/${method}`;
}

type TelegramResponse = {
  ok: boolean;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
  result?: unknown;
};

async function call(
  method: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; json: TelegramResponse | null }> {
  const res = await fetch(endpoint(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // Telegram is fast; a hung request must not hold a queue worker open.
    signal: AbortSignal.timeout(15_000),
  });
  let json: TelegramResponse | null = null;
  try {
    json = (await res.json()) as TelegramResponse;
  } catch {
    json = null;
  }
  return { res, json };
}

/** Telegram's own cap is 60s; anything longer means wait for the next run. */
const MAX_RETRY_WAIT_SECONDS = 30;
const MAX_ATTEMPTS = 3;
/** Telegram rejects anything past 4096 characters outright. */
const MAX_TEXT = 4000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A person who blocked the bot, or deleted the chat, is not a transient
 * failure. Retrying is pointless and the link should be shown as broken.
 */
function isBlocked(description: string | undefined): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  return (
    d.includes("bot was blocked") ||
    d.includes("user is deactivated") ||
    d.includes("chat not found") ||
    d.includes("bot was kicked")
  );
}

/** Telegram's shape for the buttons under a message. */
function replyMarkup(options?: SendOptions): Record<string, unknown> | undefined {
  if (options?.keyboard?.length) {
    return {
      inline_keyboard: options.keyboard.map((row) =>
        row.map((b) => ({ text: b.text, callback_data: b.data })),
      ),
    };
  }
  if (options?.forceReply) {
    return { force_reply: true, selective: true };
  }
  return undefined;
}

export const telegramTransport: NotificationTransport = {
  channel: "telegram",

  async sendMessage(
    chatId: string,
    text: string,
    options?: SendOptions,
  ): Promise<SendResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { res, json } = await call("sendMessage", {
          chat_id: chatId,
          text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text,
          // Plain text on purpose. Telegram's markdown needs every one of
          // _*[]()~`>#+-=|{}.! escaped, and a single missed character makes
          // the API reject the whole message. Not worth the bugs.
          parse_mode: undefined,
          disable_web_page_preview: true,
          reply_markup: replyMarkup(options),
        });

        if (res.ok && json?.ok) {
          const result = json.result as { message_id?: number } | undefined;
          return {
            ok: true,
            messageId:
              result?.message_id === undefined
                ? undefined
                : String(result.message_id),
          };
        }

        // 429: Telegram tells us exactly how long to wait. Honour it.
        if (res.status === 429) {
          const retryAfter = json?.parameters?.retry_after ?? 1;
          if (attempt < MAX_ATTEMPTS && retryAfter <= MAX_RETRY_WAIT_SECONDS) {
            await sleep(retryAfter * 1000);
            continue;
          }
          return {
            ok: false,
            error: `Rate limited by Telegram, retry after ${retryAfter}s`,
            retryAfter,
          };
        }

        if (isBlocked(json?.description)) {
          return {
            ok: false,
            blocked: true,
            error: redact(`Telegram ${res.status}: ${json?.description}`),
          };
        }

        // 5xx is worth one more go; 4xx is our fault and will not improve.
        if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
          await sleep(attempt * 1000);
          continue;
        }

        return {
          ok: false,
          error: redact(
            json?.description
              ? `Telegram ${res.status}: ${json.description}`
              : `Telegram ${res.status}`,
          ),
        };
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(attempt * 1000);
          continue;
        }
        return { ok: false, error: redact(err) };
      }
    }
    return { ok: false, error: "Gave up after repeated failures" };
  },
};

/**
 * Clears the little spinner on a tapped button, with a one-line toast.
 *
 * Telegram spins that button until this is called, and an unanswered callback
 * looks to the person like the bot has hung. It is fire-and-forget on purpose:
 * failing to clear a spinner must never fail the write it was reporting on.
 */
export async function answerCallback(
  callbackId: string,
  text?: string,
  alert = false,
): Promise<void> {
  try {
    await call("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: text ? text.slice(0, 200) : undefined,
      show_alert: alert,
    });
  } catch {
    // Nothing to do about it, and nothing depends on it.
  }
}

/**
 * Rewrites a message already on someone's phone, dropping its buttons.
 *
 * This is what stops an alert being answered twice: once "Replied" is pressed
 * the message becomes a record of what happened rather than an offer to do it
 * again. Failure is not worth surfacing — the write already succeeded.
 */
export async function editMessage(
  chatId: string,
  messageId: string,
  text: string,
  options?: SendOptions,
): Promise<void> {
  try {
    await call("editMessageText", {
      chat_id: chatId,
      message_id: Number(messageId),
      text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text,
      disable_web_page_preview: true,
      reply_markup: replyMarkup(options),
    });
  } catch {
    // See above.
  }
}

/**
 * Points Telegram at our webhook and asks it to include the secret header on
 * every delivery. Returns a message safe to log — never the token or the URL
 * containing it.
 */
export async function registerWebhook(
  publicUrl: string,
  secret: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const url = `${publicUrl.replace(/\/$/, "")}/api/telegram/webhook`;
    const { res, json } = await call("setWebhook", {
      url,
      secret_token: secret,
      // callback_query is what a tapped button arrives as. Without it here,
      // Telegram silently drops every press and the buttons look dead.
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });

    if (res.ok && json?.ok) return { ok: true, message: `Webhook set to ${url}` };
    return {
      ok: false,
      message: redact(
        json?.description
          ? `setWebhook failed (${res.status}): ${json.description}`
          : `setWebhook failed (${res.status})`,
      ),
    };
  } catch (err) {
    return { ok: false, message: redact(err) };
  }
}

/** Diagnostics for the settings page. Never exposes the token. */
export async function getWebhookInfo(): Promise<{
  ok: boolean;
  url?: string;
  pendingUpdateCount?: number;
  lastErrorMessage?: string;
  message?: string;
}> {
  try {
    const { res, json } = await call("getWebhookInfo", {});
    if (!res.ok || !json?.ok) {
      return { ok: false, message: redact(json?.description ?? `HTTP ${res.status}`) };
    }
    const r = (json.result ?? {}) as {
      url?: string;
      pending_update_count?: number;
      last_error_message?: string;
    };
    return {
      ok: true,
      url: r.url || undefined,
      pendingUpdateCount: r.pending_update_count,
      lastErrorMessage: r.last_error_message
        ? redact(r.last_error_message)
        : undefined,
    };
  } catch (err) {
    return { ok: false, message: redact(err) };
  }
}
