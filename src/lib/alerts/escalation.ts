import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { RULES, type RuleKey } from "@/lib/alert-rules";
import { nudgeCard } from "@/lib/bot/cards";
import { linkedTeam } from "@/lib/bot/identity";
import { notify, sendToGroup } from "@/lib/notifications";

/**
 * The nag.
 *
 * Before this, an alert was messaged to its owner once and then went quiet
 * forever, however long it stayed open — so the product's one job, telling you
 * what is slipping, stopped the moment the first message was ignored.
 *
 * Now an unanswered alert comes back every four hours, and every repeat goes
 * to the whole team rather than one person. That is a deliberately blunt rule
 * and it is the owner's call: an alert that has been sitting open for half a
 * shift is not a private matter any more.
 *
 * Two things stop it, both of which are somebody deciding something: the alert
 * resolves, or it is snoozed with a reason.
 */

const NUDGE_INTERVAL_HOURS = 4;

export type Nudgeable = {
  alertId: string;
  ruleKey: RuleKey;
  contractId: string;
  contractTitle: string;
  clientName: string;
  accountLabel: string;
  ownerUserId: string | null;
  ownerName: string | null;
  openedAt: Date;
  nudgeCount: number;
};

/**
 * Alerts that have been open, unsnoozed and unanswered for another four hours.
 *
 * The clock runs from the last time we said something rather than from when
 * the alert opened, so an alert never arrives twice in one window however
 * often the cron runs.
 */
export async function findNudgeable(): Promise<Nudgeable[]> {
  const { rows } = await db.execute<{
    alert_id: string;
    rule_key: RuleKey;
    contract_id: string;
    contract_title: string;
    client_name: string;
    account_label: string;
    owner_user_id: string | null;
    owner_name: string | null;
    /*
     * A string, not a Date. `db.execute` returns the driver's own parse rather
     * than the typed one a Drizzle `select` gives back, and every timestamp
     * that reaches a card has to be converted before something calls
     * `.getTime()` on it.
     */
    opened_at: string;
    nudge_count: string;
  }>(sql`
    select a.id as alert_id, a.rule_key, a.opened_at, a.nudge_count,
           c.id as contract_id, c.title as contract_title,
           cl.name as client_name, acc.label as account_label,
           c.owner_user_id, u.name as owner_name
    from alerts a
    join contracts c on c.id = a.contract_id
    join clients cl on cl.id = c.client_id
    join accounts acc on acc.id = c.account_id
    left join users u on u.id = c.owner_user_id
    where a.resolved_at is null
      and a.notified_at is not null
      and (a.snoozed_until is null or a.snoozed_until <= now())
      and c.status = 'active' and c.archived = false
      and coalesce(a.last_nudged_at, a.notified_at)
            <= now() - ${sql.raw(`interval '${NUDGE_INTERVAL_HOURS} hours'`)}
    order by a.opened_at asc
    limit 20
  `);

  return rows.map((r) => ({
    alertId: r.alert_id,
    ruleKey: r.rule_key,
    contractId: r.contract_id,
    contractTitle: r.contract_title,
    clientName: r.client_name,
    accountLabel: r.account_label,
    ownerUserId: r.owner_user_id,
    ownerName: r.owner_name,
    openedAt: new Date(r.opened_at),
    nudgeCount: Number(r.nudge_count),
  }));
}

/**
 * Sends one round of nudges. Stamps first, sends second: a failure part-way
 * through a fan-out must not leave the alert eligible again on the next run,
 * which would message everyone who did receive it a second time.
 */
export async function runNudges(): Promise<{ nudged: number; messages: number }> {
  const due = await findNudgeable();
  if (!due.length) return { nudged: 0, messages: 0 };

  const team = await linkedTeam();
  let messages = 0;

  for (const alert of due) {
    await db.execute(sql`
      update alerts
      set last_nudged_at = now(), nudge_count = nudge_count + 1
      where id = ${alert.alertId}
    `);

    const card = nudgeCard({
      ...alert,
      nudgeCount: alert.nudgeCount + 1,
      detail: null,
    });

    for (const member of team) {
      const outcome = await notify({
        userId: member.userId,
        template: "alert_nudge",
        body: card.body,
        keyboard: card.keyboard,
        contractId: alert.contractId,
        alertId: alert.alertId,
        // A deadline rule stays allowed through the sleep window; everything
        // else is held until 6pm, exactly as the first message was.
        immediate: RULES[alert.ruleKey].bypassQuietHours,
      });
      if (outcome.status === "sent" || outcome.status === "queued") messages++;
    }

    await sendToGroup({
      template: "alert_nudge_group",
      body: card.body,
      contractId: alert.contractId,
      alertId: alert.alertId,
      keyboard: card.keyboard,
    });
  }

  return { nudged: due.length, messages };
}
