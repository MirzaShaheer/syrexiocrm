import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts, events } from "@/db/schema";
import { RULES, type RuleKey } from "@/lib/alert-rules";

/**
 * Turns the rules into rows. Every run answers one question per rule: which
 * contracts are in this state right now? Anything newly in it opens an alert;
 * anything that has left it resolves one. Alerts already open are left alone,
 * which is what makes "notify once per opening" true.
 *
 * Every condition below is answered from data the team already types, or from
 * the absence of it. Nothing here needs an Upwork API.
 */

export type EngineResult = {
  opened: { alertId: string; contractId: string; rule: RuleKey }[];
  resolved: number;
  evaluated: number;
};

const HOUR = "hour";

/**
 * One SQL fragment per rule returning the contract ids currently in that
 * state. Kept as SQL rather than fetched-and-filtered so a few hundred
 * contracts stays a single query per rule.
 */
function conditionFor(rule: RuleKey) {
  const t = RULES[rule].threshold;

  switch (rule) {
    // The client wrote and nobody has answered. The two timestamps come from
    // the buttons on the contract, or from Today's one-click Replied.
    case "client_waiting":
      return sql`
        c.last_client_message_at is not null
        and (c.last_team_message_at is null
             or c.last_client_message_at > c.last_team_message_at)
        and c.last_client_message_at <= now() - ${sql.raw(`interval '${t} ${HOUR}'`)}
      `;

    // A deadline typed once, counting itself down ever since.
    case "milestone_due":
      return sql`
        exists (
          select 1 from milestones m
          where m.contract_id = c.id
            and m.status = 'pending'
            and m.due_at is not null
            and m.due_at > now()
            and m.due_at <= now() + ${sql.raw(`interval '${t} ${HOUR}'`)}
        )
      `;

    // Fires precisely because nobody typed anything. Cannot fail from neglect.
    case "stale_contract":
      return sql`
        coalesce(c.last_update_at, c.started_at, c.created_at)
          <= now() - ${sql.raw(`interval '${t} ${HOUR}'`)}
      `;

    case "unassigned":
      return sql`
        c.owner_user_id is null
        and coalesce(c.started_at, c.created_at)
          <= now() - ${sql.raw(`interval '${t} ${HOUR}'`)}
      `;

    // No threshold: an active contract with nothing planned is wrong now.
    case "no_next_action":
      return sql`
        c.next_action_text is null
        or trim(c.next_action_text) = ''
        or (c.next_action_due_at is not null and c.next_action_due_at < now())
      `;
  }
}

/** Contracts a rule can apply to at all. */
const LIVE = sql`c.status = 'active' and c.archived = false`;

/**
 * Runs every rule. `openSilently` marks newly opened alerts as already
 * notified — used on the very first run so going live does not fire a dozen
 * messages about problems that have been sitting there for days.
 */
export async function runAlertEngine(
  options: { openSilently?: boolean } = {},
): Promise<EngineResult> {
  const opened: EngineResult["opened"] = [];
  let resolved = 0;

  const { rows: countRows } = await db.execute<{ count: string }>(
    sql`select count(*) as count from contracts c where ${LIVE}`,
  );
  const evaluated = Number(countRows[0]?.count ?? 0);

  for (const rule of Object.keys(RULES) as RuleKey[]) {
    const condition = conditionFor(rule);

    // --- open anything newly in the state -------------------------------
    const { rows: toOpen } = await db.execute<{
      id: string;
      owner_user_id: string | null;
    }>(sql`
      select c.id, c.owner_user_id
      from contracts c
      where ${LIVE}
        and (${condition})
        and not exists (
          select 1 from alerts a
          where a.contract_id = c.id
            and a.rule_key = ${rule}
            and a.resolved_at is null
        )
    `);

    for (const row of toOpen) {
      const [created] = await db
        .insert(alerts)
        .values({
          contractId: row.id,
          ruleKey: rule,
          ownerUserIdAtOpen: row.owner_user_id,
          // A silent open is recorded as already notified, so the queue
          // never picks it up.
          notifiedAt: options.openSilently ? new Date() : null,
        })
        // The partial unique index is the real guard: two runs racing cannot
        // both open the same alert.
        .onConflictDoNothing()
        .returning({ id: alerts.id });

      if (created) {
        opened.push({ alertId: created.id, contractId: row.id, rule });
        await db.insert(events).values({
          contractId: row.id,
          type: "alert_opened",
          actor: "system",
          payload: { ruleKey: rule, ruleLabel: RULES[rule].label },
        });
      }
    }

    // --- resolve anything that has left the state ------------------------
    const { rows: toResolve } = await db.execute<{
      id: string;
      contract_id: string;
    }>(sql`
      select a.id, a.contract_id
      from alerts a
      join contracts c on c.id = a.contract_id
      where a.resolved_at is null
        and a.rule_key = ${rule}
        and (
          not (${LIVE})
          or not (${condition})
        )
    `);

    for (const row of toResolve) {
      await db
        .update(alerts)
        .set({ resolvedAt: new Date(), snoozedUntil: null, snoozeReason: null })
        .where(and(eq(alerts.id, row.id), isNull(alerts.resolvedAt)));
      resolved++;
      await db.insert(events).values({
        contractId: row.contract_id,
        type: "alert_resolved",
        actor: "system",
        payload: { ruleKey: rule, ruleLabel: RULES[rule].label },
      });
    }
  }

  return { opened, resolved, evaluated };
}

/**
 * The final hour. A deadline inside sixty minutes with nothing submitted is
 * the one thing worth interrupting somebody for, so it is checked separately
 * and — unlike everything else — is allowed through quiet hours.
 */
export async function findFinalHourDeadlines(): Promise<
  {
    contractId: string;
    contractTitle: string;
    clientName: string;
    accountLabel: string;
    ownerUserId: string | null;
    ownerName: string | null;
    milestoneTitle: string;
    minutesLeft: number;
  }[]
> {
  const { rows } = await db.execute<{
    contract_id: string;
    contract_title: string;
    client_name: string;
    account_label: string;
    owner_user_id: string | null;
    owner_name: string | null;
    milestone_title: string;
    minutes_left: string;
  }>(sql`
    select
      c.id as contract_id, c.title as contract_title,
      cl.name as client_name, a.label as account_label,
      c.owner_user_id, u.name as owner_name,
      m.title as milestone_title,
      round(extract(epoch from (m.due_at - now())) / 60) as minutes_left
    from milestones m
    join contracts c on c.id = m.contract_id
    join clients cl on cl.id = c.client_id
    join accounts a on a.id = c.account_id
    left join users u on u.id = c.owner_user_id
    where c.status = 'active' and c.archived = false
      and m.status = 'pending'
      and m.due_at is not null
      and m.due_at > now()
      and m.due_at <= now() + interval '60 minutes'
      -- once per milestone, ever
      and not exists (
        select 1 from notifications n
        where n.contract_id = c.id
          and n.template = 'final_hour'
          and n.body like '%' || m.title || '%'
      )
    order by m.due_at asc
  `);

  return rows.map((r) => ({
    contractId: r.contract_id,
    contractTitle: r.contract_title,
    clientName: r.client_name,
    accountLabel: r.account_label,
    ownerUserId: r.owner_user_id,
    ownerName: r.owner_name,
    milestoneTitle: r.milestone_title,
    minutesLeft: Number(r.minutes_left),
  }));
}

/** Details needed to write a notification about a newly opened alert. */
export async function describeAlertTargets(
  alertIds: string[],
): Promise<
  {
    alertId: string;
    ruleKey: RuleKey;
    contractId: string;
    contractTitle: string;
    clientName: string;
    accountLabel: string;
    ownerUserId: string | null;
    ownerName: string | null;
  }[]
> {
  if (!alertIds.length) return [];
  const { rows } = await db.execute<{
    alert_id: string;
    rule_key: RuleKey;
    contract_id: string;
    contract_title: string;
    client_name: string;
    account_label: string;
    owner_user_id: string | null;
    owner_name: string | null;
  }>(sql`
    select a.id as alert_id, a.rule_key, c.id as contract_id,
           c.title as contract_title, cl.name as client_name,
           acc.label as account_label, c.owner_user_id, u.name as owner_name
    from alerts a
    join contracts c on c.id = a.contract_id
    join clients cl on cl.id = c.client_id
    join accounts acc on acc.id = c.account_id
    left join users u on u.id = c.owner_user_id
    where a.id in ${alertIds}
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
  }));
}
