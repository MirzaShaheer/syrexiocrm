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

  const enabled = process.env.TELEGRAM_ENABLED === "true";
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
