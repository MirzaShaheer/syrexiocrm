import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pktMonthValue } from "@/lib/time";

/**
 * Reads over the past-work record. Everything here is scoped to
 * `is_historical = true`, so none of it can ever be confused with live work.
 */

function asDate(v: string | Date | null): Date | null {
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

export type PastEntry = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  clientCountry: string | null;
  accountId: string;
  accountLabel: string;
  type: "fixed" | "hourly";
  value: number | null;
  outcome: string | null;
  wonMonth: Date;
  enteredByName: string | null;
  createdByUserId: string | null;
  createdAt: Date;
};

export type PastMonth = {
  /** "2025-03" — the grouping key and the sort key. */
  key: string;
  month: Date;
  entries: PastEntry[];
  total: number;
  clients: number;
};

export type HistoryFilters = {
  accountId?: string;
  /** Four digits, or undefined for every year. */
  year?: string;
  q?: string;
};

export type HistoryBoard = {
  months: PastMonth[];
  totalValue: number;
  totalEntries: number;
  /** Distinct clients across the whole filtered set, not summed per month. */
  totalClients: number;
  /** Every year that has an entry, newest first, for the filter. */
  years: string[];
  byAccount: { accountId: string; label: string; entries: number; value: number }[];
  /** Largest month total in the filtered set, so bars can be scaled. */
  peakMonth: number;
};

export async function getHistoryBoard(
  filters: HistoryFilters = {},
): Promise<HistoryBoard> {
  const like = filters.q ? `%${filters.q.toLowerCase()}%` : null;

  const { rows } = await db.execute<{
    id: string;
    title: string;
    client_id: string;
    client_name: string;
    client_country: string | null;
    account_id: string;
    account_label: string;
    type: "fixed" | "hourly";
    value: string | null;
    outcome: string | null;
    won_month: string | Date;
    entered_by_name: string | null;
    created_by_user_id: string | null;
    created_at: string | Date;
  }>(sql`
    select
      ct.id, ct.title,
      cl.id as client_id, cl.name as client_name, cl.country as client_country,
      a.id as account_id, a.label as account_label,
      ct.type, ct.value, ct.outcome,
      coalesce(ct.won_month, ct.ended_at, ct.started_at, ct.created_at) as won_month,
      u.name as entered_by_name, ct.created_by_user_id, ct.created_at
    from contracts ct
    join clients cl on cl.id = ct.client_id
    join accounts a on a.id = ct.account_id
    left join users u on u.id = ct.created_by_user_id
    where ct.is_historical = true
    ${filters.accountId ? sql`and ct.account_id = ${filters.accountId}` : sql``}
    ${
      filters.year
        ? sql`and to_char(coalesce(ct.won_month, ct.ended_at, ct.created_at) at time zone 'Asia/Karachi', 'YYYY') = ${filters.year}`
        : sql``
    }
    ${
      like
        ? sql`and (lower(cl.name) like ${like} or lower(ct.title) like ${like} or lower(coalesce(cl.country, '')) like ${like})`
        : sql``
    }
    order by coalesce(ct.won_month, ct.ended_at, ct.created_at) desc, cl.name
  `);

  const entries: PastEntry[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    clientId: r.client_id,
    clientName: r.client_name,
    clientCountry: r.client_country,
    accountId: r.account_id,
    accountLabel: r.account_label,
    type: r.type,
    value: r.value === null ? null : Number(r.value),
    outcome: r.outcome,
    wonMonth: asDate(r.won_month)!,
    enteredByName: r.entered_by_name,
    createdByUserId: r.created_by_user_id,
    createdAt: asDate(r.created_at)!,
  }));

  // Group by month in JS rather than SQL: the set is small (one row per job
  // the agency has ever closed) and the grouping key has to agree exactly with
  // what the form writes, which is a Pakistan-time month.
  const byMonth = new Map<string, PastEntry[]>();
  for (const e of entries) {
    const key = pktMonthValue(e.wonMonth);
    const list = byMonth.get(key);
    if (list) list.push(e);
    else byMonth.set(key, [e]);
  }

  const months: PastMonth[] = [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => ({
      key,
      month: list[0].wonMonth,
      entries: list,
      total: list.reduce((s, e) => s + (e.value ?? 0), 0),
      clients: new Set(list.map((e) => e.clientId)).size,
    }));

  const accountTotals = new Map<
    string,
    { accountId: string; label: string; entries: number; value: number }
  >();
  for (const e of entries) {
    const row = accountTotals.get(e.accountId) ?? {
      accountId: e.accountId,
      label: e.accountLabel,
      entries: 0,
      value: 0,
    };
    row.entries += 1;
    row.value += e.value ?? 0;
    accountTotals.set(e.accountId, row);
  }

  return {
    months,
    totalValue: entries.reduce((s, e) => s + (e.value ?? 0), 0),
    totalEntries: entries.length,
    totalClients: new Set(entries.map((e) => e.clientId)).size,
    years: await getHistoryYears(),
    byAccount: [...accountTotals.values()].sort((a, b) => b.value - a.value),
    peakMonth: months.reduce((m, x) => Math.max(m, x.total), 0),
  };
}

/** Every year with at least one past entry. Unfiltered, so the filter itself
 *  never hides the option that would bring rows back. */
async function getHistoryYears(): Promise<string[]> {
  const { rows } = await db.execute<{ year: string }>(sql`
    select distinct
      to_char(coalesce(won_month, ended_at, created_at) at time zone 'Asia/Karachi', 'YYYY') as year
    from contracts
    where is_historical = true
    order by year desc
  `);
  return rows.map((r) => r.year).filter(Boolean);
}
