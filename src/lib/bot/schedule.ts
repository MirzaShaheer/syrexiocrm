import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { notify, sendToGroup } from "@/lib/notifications";
import { appUrl } from "@/lib/notifications/templates";
import { weekStartPkt } from "@/lib/queries/week";
import {
  formatPktDateTime,
  isWorkingNight,
  pktHour,
  pktWeekday,
} from "@/lib/time";
import { encode } from "./callbacks";
import { buildBrief } from "./digest";
import { linkedTeam } from "./identity";
import { activeAccounts } from "./queries";

/**
 * The things that happen at a time rather than in response to something.
 *
 * All of it hangs off the same fifteen-minute cron as the alert engine, which
 * is the whole scheduling story in this product — no queue, no job runner, no
 * second thing to keep alive. Each job names an hour, checks whether it has
 * already run inside that hour, and does nothing otherwise. That check is what
 * makes running the cron more often than expected harmless.
 */

/** 6pm: the shift is starting. */
const BRIEF_HOUR = 18;
/** 5am: an hour left, and time to see what is still open. */
const SWEEP_HOUR = 5;
/** Monday 7pm, an hour into the week's first shift. */
const BIDS_HOUR = 19;
/** Monday 8pm, for the owner only. */
const REPORT_HOUR = 20;

/**
 * Has this exact message already gone out recently?
 *
 * Six hours is comfortably longer than any gap between cron runs and shorter
 * than the gap between two of the same job, so it cannot suppress a real send
 * and cannot let a duplicate through.
 */
async function alreadySent(template: string, userId: string | null): Promise<boolean> {
  const { rows } = await db.execute<{ count: string }>(sql`
    select count(*) as count from ${notifications}
    where template = ${template}
      and created_at > now() - interval '6 hours'
      and ${userId ? sql`user_id = ${userId}` : sql`user_id is null`}
  `);
  return Number(rows[0]?.count ?? 0) > 0;
}

export type ScheduleResult = {
  briefs: number;
  sweeps: number;
  bidPrompts: number;
  reports: number;
};

export async function runScheduled(now = new Date()): Promise<ScheduleResult> {
  const hour = pktHour(now);
  const weekday = pktWeekday(now);
  const out: ScheduleResult = { briefs: 0, sweeps: 0, bidPrompts: 0, reports: 0 };

  // Only on nights the office actually runs. The team watches from home at the
  // weekend, which is a reason to let an alert through — not a reason to send
  // somebody a shift briefing on a Saturday evening.
  if (hour === BRIEF_HOUR && isWorkingNight(weekday)) {
    out.briefs = await sendBriefs(now);
  }

  if (hour === SWEEP_HOUR && isWorkingNight((weekday + 6) % 7)) {
    out.sweeps = await sendSweeps(now);
  }

  if (weekday === 1 && hour === BIDS_HOUR) {
    out.bidPrompts = await sendBidPrompts();
  }

  if (weekday === 1 && hour === REPORT_HOUR) {
    out.reports = await sendUndeliveredReport();
  }

  return out;
}

/* ------------------------------------------------------------ shift start */

async function sendBriefs(now: Date): Promise<number> {
  const team = await linkedTeam();
  let sent = 0;

  for (const member of team) {
    if (await alreadySent("brief_shift_start", member.userId)) continue;

    const brief = await buildBrief({
      personId: member.userId,
      heading: `Shift starting. ${member.name}, here is yours:`,
      now,
    });
    // A briefing that says "nothing" every evening trains people to swipe it
    // away, and then the one that matters gets swiped too.
    if (brief.empty) continue;

    const outcome = await notify({
      userId: member.userId,
      template: "brief_shift_start",
      body: `${brief.body}\n\n${appUrl()}/today`,
      keyboard: brief.keyboard,
      immediate: true,
    });
    if (outcome.status === "sent") sent++;
  }

  const all = await buildBrief({ heading: "Tonight, across the agency:", now });
  if (!all.empty) {
    await sendToGroup({
      template: "brief_shift_start_group",
      body: all.body,
      keyboard: all.keyboard,
    });
  }

  return sent;
}

/* -------------------------------------------------------------- shift end */

async function sendSweeps(now: Date): Promise<number> {
  const team = await linkedTeam();
  let sent = 0;

  for (const member of team) {
    if (await alreadySent("sweep_shift_end", member.userId)) continue;

    const brief = await buildBrief({
      personId: member.userId,
      heading: "An hour of the shift left. Still open on yours:",
      now,
    });
    if (brief.empty) continue;

    const outcome = await notify({
      userId: member.userId,
      template: "sweep_shift_end",
      body: brief.body,
      keyboard: brief.keyboard,
      immediate: true,
    });
    if (outcome.status === "sent") sent++;
  }

  return sent;
}

/* ------------------------------------------------------------------ bids */

/**
 * The four numbers Upwork will not give us, asked for at the one moment
 * somebody is awake, at a desk, and has just started the week.
 */
async function sendBidPrompts(): Promise<number> {
  const accounts = await activeAccounts();
  if (!accounts.length) return 0;

  const team = await linkedTeam();
  const recipients = team.filter(
    (m) => m.role === "owner" || m.role === "manager",
  );
  const weekStart = weekStartPkt();
  let sent = 0;

  for (const member of recipients) {
    if (await alreadySent("bids_prompt", member.userId)) continue;

    const outcome = await notify({
      userId: member.userId,
      template: "bids_prompt",
      body: [
        `Bid counts for the week starting ${formatPktDateTime(weekStart)} PKT.`,
        "",
        "Upwork exposes no proposal data through any API, so this is the only",
        "way the funnel gets a top. Pick an account and send the number.",
      ].join("\n"),
      keyboard: accounts.map((a) => [{ text: a.label, data: encode("bid", a.id) }]),
      immediate: true,
    });
    if (outcome.status === "sent") sent++;
  }

  return sent;
}

/* ---------------------------------------------------------------- report */

/**
 * What the product tried to say and could not.
 *
 * A skipped notification is recorded and then never looked at, so somebody
 * unlinked from Telegram silently stops being told anything — the board looks
 * calm and one person has simply dropped out of the system.
 */
async function sendUndeliveredReport(): Promise<number> {
  const team = await linkedTeam();
  const owner = team.find((m) => m.role === "owner");
  if (!owner) return 0;
  if (await alreadySent("undelivered_report", owner.userId)) return 0;

  const { rows } = await db.execute<{
    name: string | null;
    reason: string | null;
    count: string;
  }>(sql`
    select u.name, n.error as reason, count(*) as count
    from notifications n
    left join users u on u.id = n.user_id
    where n.status in ('skipped', 'failed')
      and n.created_at > now() - interval '7 days'
    group by u.name, n.error
    order by count(*) desc
    limit 10
  `);

  if (!rows.length) return 0;

  const outcome = await notify({
    userId: owner.userId,
    template: "undelivered_report",
    body: [
      "Messages that did not reach anyone this week:",
      "",
      ...rows.map(
        (r) => `· ${r.name ?? "unknown"} — ${r.count} × ${r.reason ?? "unknown reason"}`,
      ),
      "",
      "Anyone listed here is not being told about their own contracts.",
      "",
      `${appUrl()}/settings`,
    ].join("\n"),
    immediate: true,
  });

  return outcome.status === "sent" ? 1 : 0;
}
