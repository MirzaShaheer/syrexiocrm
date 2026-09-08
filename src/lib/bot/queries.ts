import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, alerts, notifications, users } from "@/db/schema";
import { RULES, type RuleKey } from "@/lib/alert-rules";
import { stageLabel, type Niche } from "@/lib/pipelines";
import type { ContractCardInput } from "./cards";

/**
 * The reads the bot needs, none of which fit the screen-shaped queries in
 * lib/queries — those return whole boards, and a phone wants one row.
 */

/** Null stays null; anything else becomes a real Date. */
function asDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/** Everything `contractCard` renders, for one contract. */
export async function loadContractCard(
  contractId: string,
): Promise<ContractCardInput | null> {
  const { rows } = await db.execute<{
    id: string;
    title: string;
    client_name: string;
    account_label: string;
    niche: Niche;
    owner_name: string | null;
    stage: string;
    next_action_text: string | null;
    /*
     * Strings, not Dates. `db.execute` returns the driver's own parse rather
     * than the typed one a Drizzle `select` gives back, so every one of these
     * is converted below — a card calls `.getTime()` on them.
     */
    next_action_due_at: string | null;
    last_client_message_at: string | null;
    last_team_message_at: string | null;
    last_update_at: string | null;
  }>(sql`
    select c.id, c.title, cl.name as client_name, a.label as account_label,
           a.niche, u.name as owner_name, c.stage,
           c.next_action_text, c.next_action_due_at,
           c.last_client_message_at, c.last_team_message_at, c.last_update_at
    from contracts c
    join clients cl on cl.id = c.client_id
    join accounts a on a.id = c.account_id
    left join users u on u.id = c.owner_user_id
    where c.id = ${contractId}
    limit 1
  `);

  const r = rows[0];
  if (!r) return null;

  return {
    contractId: r.id,
    title: r.title,
    clientName: r.client_name,
    accountLabel: r.account_label,
    ownerName: r.owner_name,
    stageLabel: stageLabel(r.niche, r.stage),
    nextActionText: r.next_action_text,
    nextActionDueAt: asDate(r.next_action_due_at),
    lastClientMessageAt: asDate(r.last_client_message_at),
    lastTeamMessageAt: asDate(r.last_team_message_at),
    lastUpdateAt: asDate(r.last_update_at),
  };
}

/** Contracts and clients matching a typed phrase, for /find. */
export async function searchForBot(
  q: string,
): Promise<{ id: string; title: string; subtitle: string }[]> {
  const like = `%${q.toLowerCase()}%`;
  const { rows } = await db.execute<{
    id: string;
    title: string;
    subtitle: string;
  }>(sql`
    select c.id, c.title, a.label || ' · ' || cl.name as subtitle
    from contracts c
    join clients cl on cl.id = c.client_id
    join accounts a on a.id = c.account_id
    where c.archived = false
      and (lower(c.title) like ${like} or lower(cl.name) like ${like})
    order by c.status = 'active' desc, c.updated_at desc
    limit 8
  `);
  return rows;
}

/** The open alert on a contract, if there is one, for the snooze buttons. */
export async function openAlertFor(
  contractId: string,
  ruleKey?: RuleKey,
): Promise<{ id: string; ruleKey: RuleKey } | null> {
  const [row] = await db
    .select({ id: alerts.id, ruleKey: alerts.ruleKey })
    .from(alerts)
    .where(
      and(
        eq(alerts.contractId, contractId),
        isNull(alerts.resolvedAt),
        ...(ruleKey ? [eq(alerts.ruleKey, ruleKey)] : []),
      ),
    )
    .orderBy(desc(alerts.openedAt))
    .limit(1);

  return row ? { id: row.id, ruleKey: row.ruleKey as RuleKey } : null;
}

/**
 * Which contract a bot message was about.
 *
 * This is what lets somebody reply to an alert with a line of text and have it
 * land as a note, with no command and nothing to remember. The delivery log
 * already records the message id against the contract it concerned, so the
 * answer is a lookup rather than any new state.
 */
export async function contractForMessage(
  chatId: string,
  messageId: string,
): Promise<{ contractId: string; alertId: string | null; body: string } | null> {
  const [row] = await db
    .select({
      contractId: notifications.contractId,
      alertId: notifications.alertId,
      body: notifications.body,
    })
    .from(notifications)
    .where(
      and(eq(notifications.chatId, chatId), eq(notifications.messageId, messageId)),
    )
    .limit(1);

  if (!row?.contractId) return null;
  return { contractId: row.contractId, alertId: row.alertId, body: row.body };
}

/** Active people a contract can be handed to. */
export async function assignableUsers(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(users.name);
}

/** Active Upwork accounts, for the weekly bid question. */
export async function activeAccounts(): Promise<{ id: string; label: string }[]> {
  return db
    .select({ id: accounts.id, label: accounts.label })
    .from(accounts)
    .where(eq(accounts.active, true))
    .orderBy(accounts.label);
}

/** A rule label without importing the rules table everywhere. */
export function ruleLabel(key: string): string {
  return RULES[key as RuleKey]?.label ?? key;
}
