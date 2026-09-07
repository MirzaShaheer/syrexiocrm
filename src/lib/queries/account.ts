import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import type { Niche } from "@/lib/pipelines";

/** Raw execute() returns timestamps as strings; the query builder does not. */
function asDate(v: string | Date | null): Date | null {
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

export type AccountRef = {
  id: string;
  label: string;
  market: "us" | "pk";
  niche: Niche;
};

/** Every active account, for the switcher. Cheap enough to run on every page. */
export async function getAccountRefs(): Promise<AccountRef[]> {
  return db
    .select({
      id: accounts.id,
      label: accounts.label,
      market: accounts.market,
      niche: accounts.niche,
    })
    .from(accounts)
    .where(eq(accounts.active, true))
    .orderBy(asc(accounts.label));
}

export async function getAccount(id: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  return row ?? null;
}

export type AccountContract = {
  id: string;
  title: string;
  client: string;
  owner: string | null;
  ownerId: string | null;
  stage: string;
  type: "fixed" | "hourly";
  value: number | null;
  nextActionText: string | null;
  nextActionDueAt: Date | null;
  lastUpdateAt: Date | null;
  lastClientMessageAt: Date | null;
  lastTeamMessageAt: Date | null;
  openAlerts: number;
};

export async function getAccountContracts(
  accountId: string,
): Promise<AccountContract[]> {
  const { rows } = await db.execute<{
    id: string;
    title: string;
    client: string;
    owner: string | null;
    owner_id: string | null;
    stage: string;
    type: "fixed" | "hourly";
    value: string | null;
    next_action_text: string | null;
    next_action_due_at: string | Date | null;
    last_update_at: string | Date | null;
    last_client_message_at: string | Date | null;
    last_team_message_at: string | Date | null;
    open_alerts: string;
  }>(sql`
    select
      c.id, c.title, cl.name as client,
      u.name as owner, c.owner_user_id as owner_id,
      c.stage, c.type, c.value,
      c.next_action_text, c.next_action_due_at,
      c.last_update_at, c.last_client_message_at, c.last_team_message_at,
      coalesce((select count(*) from alerts a
                where a.contract_id = c.id and a.resolved_at is null), 0) as open_alerts
    from contracts c
    join clients cl on cl.id = c.client_id
    left join users u on u.id = c.owner_user_id
    where c.account_id = ${accountId}
      and c.status = 'active'
      and c.archived = false
    order by open_alerts desc, c.last_update_at asc nulls first
  `);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    client: r.client,
    owner: r.owner,
    ownerId: r.owner_id,
    stage: r.stage,
    type: r.type,
    value: r.value === null ? null : Number(r.value),
    nextActionText: r.next_action_text,
    nextActionDueAt: asDate(r.next_action_due_at),
    lastUpdateAt: asDate(r.last_update_at),
    lastClientMessageAt: asDate(r.last_client_message_at),
    lastTeamMessageAt: asDate(r.last_team_message_at),
    openAlerts: Number(r.open_alerts),
  }));
}

export type AccountPerson = {
  id: string;
  name: string;
  role: string;
  activeContracts: number;
  alertContracts: number;
  updatesThisWeek: number;
  awaitingReply: number;
};

/** Who is carrying what, inside one account. */
export async function getAccountPeople(
  accountId: string,
): Promise<AccountPerson[]> {
  const { rows } = await db.execute<{
    id: string;
    name: string;
    role: string;
    active_contracts: string;
    alert_contracts: string;
    updates_this_week: string;
    awaiting_reply: string;
  }>(sql`
    with live as (
      select * from contracts
      where account_id = ${accountId} and status = 'active' and archived = false
    )
    select
      u.id, u.name, u.role,
      count(distinct c.id) as active_contracts,
      count(distinct c.id) filter (
        where exists (select 1 from alerts a
                      where a.contract_id = c.id and a.resolved_at is null)
      ) as alert_contracts,
      count(distinct c.id) filter (
        where c.last_client_message_at is not null
          and (c.last_team_message_at is null
               or c.last_client_message_at > c.last_team_message_at)
      ) as awaiting_reply,
      (select count(*) from updates up
       join live lc on lc.id = up.contract_id
       where up.author_user_id = u.id and up.created_at >= now() - interval '7 days'
      ) as updates_this_week
    from users u
    left join live c on c.owner_user_id = u.id
    where u.active = true
    group by u.id, u.name, u.role
    having count(distinct c.id) > 0
        or (select count(*) from updates up
            join live lc on lc.id = up.contract_id
            where up.author_user_id = u.id
              and up.created_at >= now() - interval '7 days') > 0
    order by count(distinct c.id) desc, u.name
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    activeContracts: Number(r.active_contracts),
    alertContracts: Number(r.alert_contracts),
    updatesThisWeek: Number(r.updates_this_week),
    awaitingReply: Number(r.awaiting_reply),
  }));
}

export type AccountMilestone = {
  id: string;
  contractId: string;
  contract: string;
  client: string;
  title: string;
  amount: number | null;
  dueAt: Date;
  status: "pending" | "submitted";
};

export async function getAccountMilestones(
  accountId: string,
): Promise<AccountMilestone[]> {
  const { rows } = await db.execute<{
    id: string;
    contract_id: string;
    contract: string;
    client: string;
    title: string;
    amount: string | null;
    due_at: string | Date;
    status: "pending" | "submitted";
  }>(sql`
    select m.id, m.contract_id, c.title as contract, cl.name as client,
           m.title, m.amount, m.due_at, m.status
    from milestones m
    join contracts c on c.id = m.contract_id
    join clients cl on cl.id = c.client_id
    where c.account_id = ${accountId}
      and c.status = 'active' and c.archived = false
      and m.status in ('pending','submitted')
      and m.due_at is not null
    order by m.due_at asc
    limit 12
  `);

  return rows.map((r) => ({
    id: r.id,
    contractId: r.contract_id,
    contract: r.contract,
    client: r.client,
    title: r.title,
    amount: r.amount === null ? null : Number(r.amount),
    dueAt: asDate(r.due_at)!,
    status: r.status,
  }));
}
