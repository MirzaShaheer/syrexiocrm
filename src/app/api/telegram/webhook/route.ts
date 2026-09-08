import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { handleUpdate, type TelegramUpdate } from "@/lib/bot/handle";
import { redact } from "@/lib/notifications/transport";

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

  /*
   * Every failure is swallowed and logged rather than returned.
   *
   * A non-200 makes Telegram redeliver the same update, backing off but never
   * giving up, so one message the bot cannot handle would otherwise be retried
   * for days — and each retry would run whatever part of the handler did work
   * before the throw. Answering 200 and logging is the only safe shape here.
   */
  try {
    await handleUpdate(update);
  } catch (err) {
    console.error(`[telegram:webhook] handler failed: ${redact(err)}`);
  }

  return NextResponse.json({ ok: true });
}

/** Telegram only ever POSTs. A GET here is somebody poking around. */
export async function GET() {
  return new NextResponse("Method not allowed", { status: 405 });
}
