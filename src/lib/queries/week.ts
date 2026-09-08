import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { listWeekCountsTrash } from "@/lib/trash";
import type { TrashEntry } from "@/lib/week-counts";

/** Numeric columns come back as strings; null has to survive the trip. */
function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function asDate(v: string | Date | null): Date | null {
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

/** Monday 00:00 Pakistan time for the week containing `d`. */
export function weekStartPkt(d = new Date()): Date {
  const shifted = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  const day = shifted.getUTCDay(); // 0 Sun … 6 Sat
  const backToMonday = day === 0 ? 6 : day - 1;
  const monday = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - backToMonday,
  );
  return new Date(monday - 5 * 60 * 60 * 1000);
}

export type AccountFunnel = {
  accountId: string;
  label: string;
  /*
   * The five typed counts. Null on each means nobody entered it, which is a
   * different thing from a genuine zero and is shown differently.
   */
  bids: number | null;
  chatsOpened: number | null;
  contracted: number | null;
  closed: number | null;
  withdrawn: number | null;
  /** Contracts whose last client message landed this week. */
  chatsFromCrm: number;
  /** Contracts that started this week, per the CRM itself. */
  contractsStarted: number;
  /** Approved milestone value this week. */
  earned: number;
};

export type WeekSummary = {
  from: Date;
  to: Date;
  delivered: number;
  milestonesApproved: number;
  valueApproved: number;
  updatesPosted: number;
  alertsOpened: number;
  alertsResolved: number;
  perPerson: {
    id: string;
    name: string;
    /** Every update this person has ever posted. */
    updates: number;
    /** How many of those landed inside this week. */
    updatesThisWeek: number;
    contractsOwned: number;
    alertsOpened: number;
  }[];
  funnel: AccountFunnel[];
  /** Deleted count rows still inside their thirty days, newest first. */
  trash: TrashEntry[];
};

/**
 * The last seven days, which is a different question from the daily problem
 * list: not "what is broken now" but "what actually happened".
 */
export async function getWeek(reference = new Date()): Promise<WeekSummary> {
  const from = weekStartPkt(reference);
  const to = new Date(from.getTime() + 7 * 24 * 3_600_000);

  const { rows: totals } = await db.execute<{
    delivered: string;
    milestones_approved: string;
    value_approved: string;
    updates_posted: string;
    alerts_opened: string;
    alerts_resolved: string;
  }>(sql`
    select
      (select count(*) from contracts
        where ended_at >= ${from} and ended_at < ${to}) as delivered,
      (select count(*) from milestones
        where status = 'approved' and approved_at >= ${from} and approved_at < ${to}) as milestones_approved,
      (select coalesce(sum(amount), 0) from milestones
        where status = 'approved' and approved_at >= ${from} and approved_at < ${to}) as value_approved,
      (select count(*) from updates
        where created_at >= ${from} and created_at < ${to}) as updates_posted,
      (select count(*) from events
        where type = 'alert_opened' and occurred_at >= ${from} and occurred_at < ${to}) as alerts_opened,
      (select count(*) from events
        where type = 'alert_resolved' and occurred_at >= ${from} and occurred_at < ${to}) as alerts_resolved
  `);

  const { rows: people } = await db.execute<{
    id: string;
    name: string;
    updates: string;
    updates_this_week: string;
    contracts_owned: string;
    alerts_opened: string;
  }>(sql`
    select u.id, u.name,
      (select count(*) from updates up
        where up.author_user_id = u.id) as updates,
      (select count(*) from updates up
        where up.author_user_id = u.id and up.created_at >= ${from} and up.created_at < ${to}) as updates_this_week,
      (select count(*) from contracts c
        where c.owner_user_id = u.id and c.status = 'active' and c.archived = false) as contracts_owned,
      (select count(*) from alerts a
        where a.owner_user_id_at_open = u.id and a.opened_at >= ${from} and a.opened_at < ${to}) as alerts_opened
    from users u
    where u.active = true
    order by u.name
  `);

  const { rows: funnel } = await db.execute<{
    account_id: string;
    label: string;
    bids: string | null;
    chats_opened: string | null;
    contracted: string | null;
    closed: string | null;
    withdrawn: string | null;
    chats_from_crm: string;
    contracts_started: string;
    earned: string;
  }>(sql`
    select
      a.id as account_id, a.label,
      b.bids, b.chats_opened, b.contracted, b.closed, b.withdrawn,
      (select count(*) from contracts c
        where c.account_id = a.id
          and c.last_client_message_at >= ${from} and c.last_client_message_at < ${to}) as chats_from_crm,
      (select count(*) from contracts c
        where c.account_id = a.id
          and c.started_at >= ${from} and c.started_at < ${to}) as contracts_started,
      (select coalesce(sum(m.amount), 0) from milestones m
        join contracts c on c.id = m.contract_id
        where c.account_id = a.id and m.status = 'approved'
          and m.approved_at >= ${from} and m.approved_at < ${to}) as earned
    from accounts a
    left join bid_weeks b on b.account_id = a.id and b.week_start = ${from}
    where a.active = true
    order by a.label
  `);

  const trash = await listWeekCountsTrash(reference);

  const t = totals[0];
  return {
    from,
    to,
    delivered: Number(t.delivered),
    milestonesApproved: Number(t.milestones_approved),
    valueApproved: Number(t.value_approved),
    updatesPosted: Number(t.updates_posted),
    alertsOpened: Number(t.alerts_opened),
    alertsResolved: Number(t.alerts_resolved),
    perPerson: people.map((p) => ({
      id: p.id,
      name: p.name,
      updates: Number(p.updates),
      updatesThisWeek: Number(p.updates_this_week),
      contractsOwned: Number(p.contracts_owned),
      alertsOpened: Number(p.alerts_opened),
    })),
    funnel: funnel.map((f) => ({
      accountId: f.account_id,
      label: f.label,
      bids: num(f.bids),
      chatsOpened: num(f.chats_opened),
      contracted: num(f.contracted),
      closed: num(f.closed),
      withdrawn: num(f.withdrawn),
      chatsFromCrm: Number(f.chats_from_crm),
      contractsStarted: Number(f.contracts_started),
      earned: Number(f.earned),
    })),
    trash,
  };
}

/** Everything the People screen shows, across all accounts. */
export async function getPeopleBoard() {
  const from = weekStartPkt();
  const { rows } = await db.execute<{
    id: string;
    name: string;
    role: string;
    admin_until: string | Date | null;
    telegram_chat_id: string | null;
    active_contracts: string;
    alert_contracts: string;
    awaiting_reply: string;
    updates_this_week: string;
    contracts_needing_update: string;
  }>(sql`
    with live as (
      select * from contracts where status = 'active' and archived = false
    )
    select
      u.id, u.name, u.role, u.admin_until, u.telegram_chat_id,
      (select count(*) from live c where c.owner_user_id = u.id) as active_contracts,
      (select count(*) from live c where c.owner_user_id = u.id
        and exists (select 1 from alerts a where a.contract_id = c.id
                    and a.resolved_at is null
                    and (a.snoozed_until is null or a.snoozed_until <= now()))) as alert_contracts,
      (select count(*) from live c where c.owner_user_id = u.id
        and c.last_client_message_at is not null
        and (c.last_team_message_at is null
             or c.last_client_message_at > c.last_team_message_at)) as awaiting_reply,
      (select count(*) from updates up where up.author_user_id = u.id
        and up.created_at >= ${from}) as updates_this_week,
      (select count(*) from live c where c.owner_user_id = u.id) as contracts_needing_update
    from users u
    where u.active = true
    order by (select count(*) from live c where c.owner_user_id = u.id) desc, u.name
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    adminUntil: asDate(r.admin_until),
    telegramLinked: Boolean(r.telegram_chat_id),
    activeContracts: Number(r.active_contracts),
    alertContracts: Number(r.alert_contracts),
    awaitingReply: Number(r.awaiting_reply),
    updatesThisWeek: Number(r.updates_this_week),
    /** One update per owned contract per working day is the yardstick. */
    updatesExpected: Number(r.contracts_needing_update) * 5,
  }));
}
