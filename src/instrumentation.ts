/**
 * Runs once when the server starts. Points Telegram at our webhook so the bot
 * can deliver /start messages, and says plainly in the log whether it worked —
 * a webhook that silently failed to register looks exactly like a bot nobody
 * has messaged.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  /*
    Some networks — Pakistan among them — filter Telegram's IPv4 range while
    leaving IPv6 reachable. Node's fetch picks IPv4 often enough that sends
    fail intermittently. Opt in locally with TELEGRAM_FORCE_IPV6=true; hosts
    like Railway reach Telegram on IPv4 normally and should leave it unset.
  */
  if (process.env.TELEGRAM_FORCE_IPV6 === "true") {
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv6first");
    console.log("[telegram] preferring IPv6 for outbound requests");
  }

  /*
   * Spelled the same way `telegramEnabled()` in lib/notifications reads it.
   * A strict `=== "true"` here was a trap: with TELEGRAM_ENABLED=1 the app
   * would happily send messages while this function quietly declined to
   * register the webhook, so alerts went out and nothing anybody sent back
   * ever arrived. Parsed inline rather than imported, because that module
   * pulls in the database and this runs at boot.
   */
  const raw = process.env.TELEGRAM_ENABLED?.trim().toLowerCase();
  const enabled = raw === "true" || raw === "1" || raw === "yes" || raw === "on";

  /*
   * A bot has exactly one webhook, and whoever called setWebhook last owns it.
   *
   * On Vercel every preview deployment runs this same code at cold start with
   * the same environment variables, unless they have been scoped to Production
   * by hand. One request to a preview URL would then repoint the live bot at
   * that preview, and production would go quiet — no error, nothing in the log,
   * just a bot that has stopped answering. Scoping the variables is the real
   * fix; this makes forgetting to survivable.
   */
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    console.log(
      `[telegram] VERCEL_ENV is ${process.env.VERCEL_ENV} — not touching the webhook, which belongs to production.`,
    );
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const url = process.env.APP_URL;

  if (!enabled) {
    console.log(
      "[telegram] TELEGRAM_ENABLED is not true — messages print to the console and the webhook is not registered.",
    );
    return;
  }

  const missing = [
    !token && "TELEGRAM_BOT_TOKEN",
    !secret && "TELEGRAM_WEBHOOK_SECRET",
    !url && "APP_URL",
  ].filter(Boolean);

  if (missing.length) {
    console.error(
      `[telegram] Cannot register the webhook — missing ${missing.join(", ")}.`,
    );
    return;
  }

  if (url!.includes("localhost") || url!.includes("127.0.0.1")) {
    console.warn(
      `[telegram] APP_URL is ${url} — Telegram cannot reach localhost. Set APP_URL to a public URL (the preview tunnel works) before the webhook will deliver.`,
    );
    return;
  }

  // Imported lazily so the module, and the token it reads, is never pulled
  // into a build where notifications are switched off.
  const { registerWebhook } = await import("@/lib/notifications/telegram");

  // The first outbound connection after boot sometimes fails while DNS and the
  // TLS session warm up, and a single failure would leave the whole session
  // with no webhook registered. Two more tries costs nothing.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await registerWebhook(url!, secret!);
    if (result.ok) {
      console.log(`[telegram] ${result.message}`);
      return;
    }
    if (attempt === 3) {
      console.error(`[telegram] ${result.message} — gave up after 3 attempts`);
      return;
    }
    await new Promise((r) => setTimeout(r, attempt * 1500));
  }
}
