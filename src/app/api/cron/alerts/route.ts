import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts, notifications } from "@/db/schema";
import {
  describeAlertTargets,
  findFinalHourDeadlines,
  runAlertEngine,
} from "@/lib/alerts/engine";
import { runNudges } from "@/lib/alerts/escalation";
import { alertCard } from "@/lib/bot/cards";
import { encode } from "@/lib/bot/callbacks";
import { announceToGroup } from "@/lib/bot/group";
import { sweepPrompts } from "@/lib/bot/prompts";
import { runScheduled } from "@/lib/bot/schedule";
import { flushQueued, notify, sendToGroup } from "@/lib/notifications";
import { purgeWeekCountsTrash } from "@/lib/trash";
import { finalHour } from "@/lib/notifications/templates";
import { RULES } from "@/lib/alert-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The clock the whole product runs on. Point a scheduler at this every
 * fifteen minutes with the shared secret in the Authorization header.
 *
 * In order:
 *   1. recompute every alert rule, opening and resolving
 *   2. message the owner about anything newly opened, once, with buttons
 *   3. re-send anything still unanswered after four hours, to everyone
 *   4. escalate any deadline inside the final hour, through the sleep window
 *   5. run whatever the clock says is due — briefs, sweeps, Monday prompts
 *   6. announce the night's events in the team group
 *   7. release anything held while the team was asleep, and tidy up —
 *      which includes erasing count rows that have sat in the trash 30 days
 */
function authorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "");
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  // First run after going live: open everything without messaging, so nobody
  // wakes up to a dozen alerts about problems that are days old.
  const silent = url.searchParams.get("silent") === "true";

  const started = Date.now();
  const engine = await runAlertEngine({ openSilently: silent });

  /*
   * A silent run means "adopt the state of the world without telling anyone",
   * and that has to include the nag clock as well as the first notification.
   *
   * Eligibility for a nudge is measured from `coalesce(last_nudged_at,
   * notified_at)`, so an alert notified days ago — before this feature existed,
   * or before a silent re-baseline — is overdue the moment the code ships. The
   * first ordinary run would then nudge every open alert at once, to everybody.
   * Stamping them here starts the four hours from now instead.
   */
  let baselined = 0;
  if (silent) {
    const { rowCount } = await db.execute(sql`
      update alerts set last_nudged_at = now()
      where resolved_at is null and last_nudged_at is null
    `);
    baselined = rowCount ?? 0;
  }

  /* ------------------------------------------------ notify newly opened */
  let notified = 0;
  let skipped = 0;
  let failed = 0;
  let unowned = 0;

  if (!silent && engine.opened.length) {
    const targets = await describeAlertTargets(
      engine.opened.map((o) => o.alertId),
    );

    for (const t of targets) {
      const card = alertCard({
        alertId: t.alertId,
        ruleKey: t.ruleKey,
        contractId: t.contractId,
        contractTitle: t.contractTitle,
        clientName: t.clientName,
        accountLabel: t.accountLabel,
        ownerName: t.ownerName,
      });

      /*
       * Nobody owns it, so there is no one person to tell — which used to mean
       * telling nobody at all. An unowned contract is the exact failure the
       * product exists to remove, so it goes to the group, where the card's
       * "I'll take it" button makes claiming it a single tap.
       */
      if (!t.ownerUserId) {
        await sendToGroup({
          template: "alert_opened_unowned",
          body: card.body,
          contractId: t.contractId,
          alertId: t.alertId,
          keyboard: card.keyboard,
        });
        await db
          .update(alerts)
          .set({ notifiedAt: new Date() })
          .where(and(eq(alerts.id, t.alertId), isNull(alerts.notifiedAt)));
        unowned++;
        continue;
      }

      const outcome = await notify({
        userId: t.ownerUserId,
        template: "alert_opened",
        body: card.body,
        keyboard: card.keyboard,
        contractId: t.contractId,
        alertId: t.alertId,
        // A rule counting down to a deadline goes out whatever the hour;
        // everything else waits for the shift. The rule decides, not this
        // loop, so the answer is the same everywhere it is asked.
        immediate: RULES[t.ruleKey].bypassQuietHours,
      });

      // Stamped whether it went out or was held, so it is never sent twice.
      await db
        .update(alerts)
        .set({ notifiedAt: new Date() })
        .where(and(eq(alerts.id, t.alertId), isNull(alerts.notifiedAt)));

      if (outcome.status === "sent" || outcome.status === "queued") notified++;
      else if (outcome.status === "failed") failed++;
      else skipped++;
    }
  }

  /* ---------------------------------- re-send anything still unanswered */
  const nudges = silent ? { nudged: 0, messages: 0 } : await runNudges();

  /* --------------------------------------------------------- final hour */
  let escalated = 0;
  if (!silent) {
    for (const d of await findFinalHourDeadlines()) {
      if (!d.ownerUserId) continue;
      const { template, body } = finalHour({
        milestoneTitle: d.milestoneTitle,
        contractTitle: d.contractTitle,
        accountLabel: d.accountLabel,
        clientName: d.clientName,
        minutesLeft: d.minutesLeft,
        contractId: d.contractId,
      });
      // immediate: a deadline in under an hour is worth a 2am buzz.
      const outcome = await notify({
        userId: d.ownerUserId,
        template,
        body,
        contractId: d.contractId,
        immediate: true,
        // The one button that answers this message, when we know the
        // milestone it is counting down.
        keyboard: d.milestoneId
          ? [[{ text: "✓ Submitted", data: encode("msub", d.milestoneId) }]]
          : undefined,
      });
      if (outcome.status === "sent") escalated++;
    }
  }

  /* -------------------------------------------- whatever the clock says */
  const scheduled = silent
    ? { briefs: 0, sweeps: 0, bidPrompts: 0, reports: 0 }
    : await runScheduled();

  const group = silent ? { posted: 0 } : await announceToGroup();

  /* ------------------------------ release anything held, then tidy up */
  const flushed = await flushQueued();
  const promptsSwept = await sweepPrompts();
  const trashPurged = await purgeWeekCountsTrash();

  const { rows: pending } = await db.execute<{ count: string }>(
    sql`select count(*) as count from ${notifications} where status = 'queued'`,
  );

  return NextResponse.json({
    ok: true,
    ms: Date.now() - started,
    silent,
    contractsEvaluated: engine.evaluated,
    alertsOpened: engine.opened.length,
    alertsResolved: engine.resolved,
    baselined,
    notified,
    unowned,
    skipped,
    failed,
    nudged: nudges.nudged,
    nudgeMessages: nudges.messages,
    escalated,
    ...scheduled,
    groupPosts: group.posted,
    flushed,
    promptsSwept,
    trashPurged,
    stillQueued: Number(pending[0]?.count ?? 0),
  });
}

/** Some schedulers only issue GETs. Same behaviour, same check. */
export async function GET(request: Request) {
  return POST(request);
}
