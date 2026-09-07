import "server-only";
import {
  redact,
  type NotificationTransport,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const telegramTransport: NotificationTransport = {
  channel: "telegram",

  async sendMessage(chatId: string, text: string): Promise<SendResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { res, json } = await call("sendMessage", {
          chat_id: chatId,
          text,
          // Plain text on purpose. Telegram's markdown needs every one of
          // _*[]()~`>#+-=|{}.! escaped, and a single missed character makes
          // the API reject the whole message. Not worth the bugs.
          parse_mode: undefined,
          disable_web_page_preview: true,
        });

        if (res.ok && json?.ok) return { ok: true };

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
      allowed_updates: ["message"],
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
