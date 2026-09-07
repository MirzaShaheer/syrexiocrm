import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { redeemLinkCode } from "@/lib/notifications/linking";
import { sendToChat } from "@/lib/notifications";
import {
  linkAlreadyUsed,
  linkConfirmed,
  linkExpired,
  linkUnknownCode,
} from "@/lib/notifications/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram sends the secret we registered in this header on every delivery.
 * It is checked before the body is read at all — an unverified request never
 * reaches JSON parsing, let alone the database.
 */
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

function secretMatches(provided: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Compare lengths first; timingSafeEqual throws on a mismatch.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
};

export async function POST(request: Request) {
  // Fires before anything else, including verification, so the log tells us
  // whether Telegram is reaching us at all. Deliberately logs no body and no
  // header value — only that a request arrived and whether the header exists.
  console.log(
    `[telegram:webhook] POST received at ${new Date().toISOString()} · secret header ${
      request.headers.get(SECRET_HEADER) ? "present" : "MISSING"
    }`,
  );

  if (!secretMatches(request.headers.get(SECRET_HEADER))) {
    console.warn("[telegram:webhook] rejected — secret header did not match");
    // Deliberately terse. Do not confirm whether a secret is configured.
    return new NextResponse("Forbidden", { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  const text = (update.message?.text ?? "").trim();
  if (chatId === undefined || !text) return NextResponse.json({ ok: true });

  const chat = String(chatId);

  // The only command the bot understands: /start <code>
  const start = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?/i);
  if (!start) {
    await sendToChat({
      chatId: chat,
      template: "link_help",
      body: "Send /start followed by the code from Settings to link your account.",
    });
    return NextResponse.json({ ok: true });
  }

  const code = start[1];
  if (!code) {
    await sendToChat({
      chatId: chat,
      template: "link_help",
      body: [
        "To link your account, open Settings in the CRM and send the code",
        "shown there like this:",
        "",
        "/start ABCD-2345",
      ].join("\n"),
    });
    return NextResponse.json({ ok: true });
  }

  const result = await redeemLinkCode(code, chat);

  const reply =
    result.outcome === "linked"
      ? linkConfirmed(result.name, ROLE_LABELS[result.role as Role] ?? result.role)
      : result.outcome === "expired"
        ? linkExpired()
        : result.outcome === "used"
          ? linkAlreadyUsed()
          : linkUnknownCode();

  await sendToChat({
    chatId: chat,
    template: reply.template,
    body: reply.body,
    userId: result.outcome === "linked" ? result.userId : null,
  });

  // Always 200. A non-200 makes Telegram redeliver the same update forever.
  return NextResponse.json({ ok: true });
}

/** Telegram only ever POSTs. A GET here is somebody poking around. */
export async function GET() {
  return new NextResponse("Method not allowed", { status: 405 });
}
