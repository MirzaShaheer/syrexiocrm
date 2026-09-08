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
import { flushQueued, notify } from "@/lib/notifications";
import { alertOpened, finalHour } from "@/lib/notifications/templates";
import { RULES } from "@/lib/alert-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The clock the whole product runs on. Point a scheduler at this every
 * fifteen minutes with the shared secret in the Authorization header.
 *
 * It does four things, in order:
 *   1. recompute every alert rule, opening and resolving
 *   2. message the owner about anything newly opened, once
 *   3. escalate any deadline inside the final hour, through quiet hours
 *   4. release anything that was held overnight
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

  /* ------------------------------------------------ notify newly opened */
  let notified = 0;
  let skipped = 0;
  let failed = 0;

  if (!silent && engine.opened.length) {
    const targets = await describeAlertTargets(
      engine.opened.map((o) => o.alertId),
    );

    for (const t of targets) {
      // Nobody owns it: there is no one person to tell. It still shows on
      // Today, which is where an unowned contract belongs.
      if (!t.ownerUserId) {
        skipped++;
        continue;
      }

      const { template, body } = alertOpened({
        ruleLabel: RULES[t.ruleKey].label,
        contractTitle: t.contractTitle,
        clientName: t.clientName,
        accountLabel: t.accountLabel,
        ownerName: t.ownerName,
        contractId: t.contractId,
      });

      const outcome = await notify({
        userId: t.ownerUserId,
        template,
        body,
        contractId: t.contractId,
        alertId: t.alertId,
        // A rule counting down to a deadline goes out whatever the hour;
        // everything else waits for the morning. The rule decides, not this
        // loop, so the answer is the same everywhere it is asked.
        immediate: RULES[t.ruleKey].bypassQuietHours,
      });

      // Stamped whether it went out or was queued, so it is never sent twice.
      await db
        .update(alerts)
        .set({ notifiedAt: new Date() })
        .where(and(eq(alerts.id, t.alertId), isNull(alerts.notifiedAt)));

      if (outcome.status === "sent" || outcome.status === "queued") notified++;
      else if (outcome.status === "failed") failed++;
      else skipped++;
    }
  }

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
      });
      if (outcome.status === "sent") escalated++;
    }
  }

  /* ---------------------------------------- release anything held overnight */
  const flushed = await flushQueued();

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
    notified,
    skipped,
    failed,
    escalated,
    flushed,
    stillQueued: Number(pending[0]?.count ?? 0),
  });
}

/** Some schedulers only issue GETs. Same behaviour, same check. */
export async function GET(request: Request) {
  return POST(request);
}
