import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

function asDate(v: string | Date | null): Date | null {
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

export type ClientContract = {
  id: string;
  title: string;
  accountLabel: string;
  accountId: string;
  type: "fixed" | "hourly";
  value: number | null;
  status: "active" | "paused" | "ended";
  stage: string;
  ownerName: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  /** Sum of approved milestones — what they have actually paid out. */
  approved: number;
  /** Backfilled from the History page rather than run inside the CRM. */
  isHistorical: boolean;
};

export type ClientRecord = {
  id: string;
  name: string;
  country: string | null;
  timezone: string | null;
  upworkClientRef: string | null;
  firstSeenAt: Date;
  contracts: ClientContract[];
  totalContracts: number;
  activeContracts: number;
  totalApproved: number;
  accountsUsed: string[];
  /** More than one contract means they came back. */
  repeat: boolean;
};

export async function getClientRecord(id: string): Promise<ClientRecord | null> {
  const { rows: head } = await db.execute<{
    id: string;
    name: string;
    country: string | null;
    timezone: string | null;
    upwork_client_ref: string | null;
    first_seen_at: string | Date;
  }>(sql`
    select id, name, country, timezone, upwork_client_ref, first_seen_at
    from clients where id = ${id} limit 1
  `);
  if (!head.length) return null;
  const c = head[0];

  const { rows } = await db.execute<{
    id: string;
    title: string;
    account_label: string;
    account_id: string;
    type: "fixed" | "hourly";
    value: string | null;
    status: "active" | "paused" | "ended";
    stage: string;
    owner_name: string | null;
    started_at: string | Date | null;
    ended_at: string | Date | null;
    approved: string;
    is_historical: boolean;
  }>(sql`
    select
      ct.id, ct.title, a.label as account_label, a.id as account_id,
      ct.type, ct.value, ct.status, ct.stage,
      u.name as owner_name, ct.started_at, ct.ended_at, ct.is_historical,
      -- A backfilled job has no milestones, so its recorded value is the only
      -- figure there is. Live work still counts only what a client approved.
      case when ct.is_historical then coalesce(ct.value, 0)
           else coalesce((select sum(m.amount) from milestones m
                          where m.contract_id = ct.id and m.status = 'approved'), 0)
      end as approved
    from contracts ct
    join accounts a on a.id = ct.account_id
    left join users u on u.id = ct.owner_user_id
    where ct.client_id = ${id}
    order by ct.started_at desc nulls last
  `);

  const contracts: ClientContract[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    accountLabel: r.account_label,
    accountId: r.account_id,
    type: r.type,
    value: r.value === null ? null : Number(r.value),
    status: r.status,
    stage: r.stage,
    ownerName: r.owner_name,
    startedAt: asDate(r.started_at),
    endedAt: asDate(r.ended_at),
    approved: Number(r.approved),
    isHistorical: r.is_historical,
  }));

  return {
    id: c.id,
    name: c.name,
    country: c.country,
    timezone: c.timezone,
    upworkClientRef: c.upwork_client_ref,
    firstSeenAt: asDate(c.first_seen_at)!,
    contracts,
    totalContracts: contracts.length,
    activeContracts: contracts.filter((x) => x.status === "active").length,
    totalApproved: contracts.reduce((s, x) => s + x.approved, 0),
    accountsUsed: [...new Set(contracts.map((x) => x.accountLabel))].sort(),
    repeat: contracts.length > 1,
  };
}

export type ClientListRow = {
  id: string;
  name: string;
  country: string | null;
  accounts: string[];
  totalContracts: number;
  activeContracts: number;
  totalApproved: number;
  lastActivityAt: Date | null;
  /** What they actually hired us for, from the niches of their contracts. */
  niches: string[];
};

/**
 * Every client the company has ever had, one-off or otherwise. The point of
 * the page is repeat business — which is invisible everywhere else, because
 * the same client can appear under more than one Upwork account.
 */
export async function getClientList(search?: string): Promise<ClientListRow[]> {
  const like = search ? `%${search.toLowerCase()}%` : null;
  const { rows } = await db.execute<{
    id: string;
    name: string;
    country: string | null;
    accounts: string[] | null;
    niches: string[] | null;
    total_contracts: string;
    active_contracts: string;
    total_approved: string;
    last_activity_at: string | Date | null;
  }>(sql`
    select
      cl.id, cl.name, cl.country,
      array_remove(array_agg(distinct a.label), null) as accounts,
      array_remove(array_agg(distinct a.niche::text), null) as niches,
      count(ct.id) as total_contracts,
      count(ct.id) filter (where ct.status = 'active') as active_contracts,
      coalesce(sum(
        case when ct.is_historical then coalesce(ct.value, 0)
             else coalesce((select sum(m.amount) from milestones m
                            where m.contract_id = ct.id and m.status = 'approved'), 0)
        end
      ), 0) as total_approved,
      max(coalesce(ct.ended_at, ct.started_at)) as last_activity_at
    from clients cl
    left join contracts ct on ct.client_id = cl.id
    left join accounts a on a.id = ct.account_id
    ${like ? sql`where lower(cl.name) like ${like} or lower(coalesce(cl.country, '')) like ${like}` : sql``}
    group by cl.id, cl.name, cl.country
    order by count(ct.id) filter (where ct.status = 'active') desc,
             count(ct.id) desc, cl.name
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    accounts: r.accounts ?? [],
    niches: r.niches ?? [],
    totalContracts: Number(r.total_contracts),
    activeContracts: Number(r.active_contracts),
    totalApproved: Number(r.total_approved),
    lastActivityAt: asDate(r.last_activity_at),
  }));
}
