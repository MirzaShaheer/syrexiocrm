import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Niche } from "@/lib/pipelines";

/**
 * Drizzle installs its own pg type parsers, so a raw execute() hands back
 * timestamps as strings. The query builder does this conversion for us; here
 * we have to do it ourselves.
 */
function asDate(v: string | Date | null): Date | null {
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

/**
 * The agency-level read: one rollup row per Upwork account, plus the three
 * figures underneath the tiles. Deliberately a small number of grouped
 * queries rather than one per account, so adding a fifth account costs
 * nothing.
 */

export type Health = "clear" | "watch" | "problem" | "broken";

export type AccountRollup = {
  id: string;
  label: string;
  market: "us" | "pk";
  niche: Niche;
  activeContracts: number;
  /** Distinct contracts with at least one unresolved alert. */
  alertContracts: number;
  openAlerts: number;
  /**
   * Fixed-price value committed on active contracts that has not been
   * approved yet. Hourly work is excluded because a rate is not a value —
   * `hourlyContracts` carries that separately.
   */
  wipValue: number;
  hourlyContracts: number;
  unassigned: number;
  connectionState: "disconnected" | "connected" | "needs_reconnect";
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  health: Health;
};

function healthFor(r: {
  connectionState: string;
  activeContracts: number;
  alertContracts: number;
  unassigned: number;
}): Health {
  // A stale token means every number on this tile may be a lie. Loudest state.
  if (r.connectionState === "needs_reconnect") return "broken";
  if (r.alertContracts === 0) return "clear";
  // Red is reserved for something nobody is currently doing: work with no
  // owner. Everything else has a person on it and is amber at worst. Grading
  // on alert count alone turned every tile red, which told you nothing.
  if (r.unassigned > 0) return "problem";
  return "watch";
}

export async function getAccountRollup(): Promise<AccountRollup[]> {
  const { rows } = await db.execute<{
    id: string;
    label: string;
    market: "us" | "pk";
    niche: Niche;
    active_contracts: string;
    hourly_contracts: string;
    unassigned: string;
    wip_value: string;
    alert_contracts: string;
    open_alerts: string;
    connection_state: AccountRollup["connectionState"];
    last_synced_at: string | Date | null;
    last_sync_error: string | null;
  }>(sql`
    with live as (
      select * from contracts where status = 'active' and archived = false
    ),
    approved as (
      select m.contract_id, sum(m.amount) as paid
      from milestones m
      join live c on c.id = m.contract_id
      where m.status = 'approved'
      group by m.contract_id
    ),
    per_contract as (
      select
        c.account_id,
        c.id,
        c.type,
        c.owner_user_id,
        case when c.type = 'fixed'
             then greatest(coalesce(c.value, 0) - coalesce(a.paid, 0), 0)
             else 0 end as wip
      from live c
      left join approved a on a.contract_id = c.id
    ),
    alerted as (
      select c.account_id,
             count(distinct al.contract_id) as alert_contracts,
             count(*) as open_alerts
      from alerts al
      join live c on c.id = al.contract_id
      where al.resolved_at is null
      group by c.account_id
    )
    select
      acc.id,
      acc.label,
      acc.market,
      acc.niche,
      acc.connection_state,
      acc.last_synced_at,
      acc.last_sync_error,
      coalesce(count(pc.id), 0)                                  as active_contracts,
      coalesce(count(pc.id) filter (where pc.type = 'hourly'), 0) as hourly_contracts,
      coalesce(count(pc.id) filter (where pc.owner_user_id is null), 0) as unassigned,
      coalesce(sum(pc.wip), 0)                                   as wip_value,
      coalesce(max(al.alert_contracts), 0)                       as alert_contracts,
      coalesce(max(al.open_alerts), 0)                           as open_alerts
    from accounts acc
    left join per_contract pc on pc.account_id = acc.id
    left join alerted al on al.account_id = acc.id
    where acc.active = true
    group by acc.id, acc.label, acc.market, acc.niche,
             acc.connection_state, acc.last_synced_at, acc.last_sync_error
    order by acc.label
  `);

  return rows.map((r) => {
    const base = {
      id: r.id,
      label: r.label,
      market: r.market,
      niche: r.niche,
      activeContracts: Number(r.active_contracts),
      alertContracts: Number(r.alert_contracts),
      openAlerts: Number(r.open_alerts),
      wipValue: Number(r.wip_value),
      hourlyContracts: Number(r.hourly_contracts),
      unassigned: Number(r.unassigned),
      connectionState: r.connection_state,
      lastSyncedAt: asDate(r.last_synced_at),
      lastSyncError: r.last_sync_error,
    };
    return { ...base, health: healthFor(base) };
  });
}

export type AgencyTotals = {
  openAlerts: number;
  alertContracts: number;
  milestonesThisWeek: number;
  milestonesThisWeekValue: number;
  deliveredThisMonth: number;
  deliveredLastMonth: number;
};

export async function getAgencyTotals(): Promise<AgencyTotals> {
  const { rows } = await db.execute<{
    open_alerts: string;
    alert_contracts: string;
    ms_count: string;
    ms_value: string;
    this_month: string;
    last_month: string;
  }>(sql`
    with live as (
      select * from contracts where status = 'active' and archived = false
    ),
    -- Calendar months in Pakistan time, not UTC: "this month" has to mean
    -- the month it is where the team is sitting.
    bounds as (
      select
        date_trunc('month', (now() at time zone 'Asia/Karachi')) as month_start,
        date_trunc('month', (now() at time zone 'Asia/Karachi')) - interval '1 month' as prev_start
    )
    select
      (select count(*) from alerts a join live c on c.id = a.contract_id
        where a.resolved_at is null) as open_alerts,
      (select count(distinct a.contract_id) from alerts a join live c on c.id = a.contract_id
        where a.resolved_at is null) as alert_contracts,
      (select count(*) from milestones m join live c on c.id = m.contract_id
        where m.status in ('pending','submitted')
          and m.due_at >= now() and m.due_at < now() + interval '7 days') as ms_count,
      (select coalesce(sum(m.amount), 0) from milestones m join live c on c.id = m.contract_id
        where m.status in ('pending','submitted')
          and m.due_at >= now() and m.due_at < now() + interval '7 days') as ms_value,
      (select coalesce(sum(m.amount), 0) from milestones m, bounds b
        where m.status = 'approved'
          and (m.approved_at at time zone 'Asia/Karachi') >= b.month_start) as this_month,
      (select coalesce(sum(m.amount), 0) from milestones m, bounds b
        where m.status = 'approved'
          and (m.approved_at at time zone 'Asia/Karachi') >= b.prev_start
          and (m.approved_at at time zone 'Asia/Karachi') < b.month_start) as last_month
  `);

  const r = rows[0];
  return {
    openAlerts: Number(r.open_alerts),
    alertContracts: Number(r.alert_contracts),
    milestonesThisWeek: Number(r.ms_count),
    milestonesThisWeekValue: Number(r.ms_value),
    deliveredThisMonth: Number(r.this_month),
    deliveredLastMonth: Number(r.last_month),
  };
}
