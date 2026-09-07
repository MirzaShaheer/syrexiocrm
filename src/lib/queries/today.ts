import "server-only";
import { and, asc, eq, gte, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients, contracts, milestones, users } from "@/db/schema";
import {
  TODAY_MILESTONE_WINDOW_HOURS,
  TODAY_NO_UPDATE_HOURS,
} from "@/lib/alert-rules";

const HOUR_MS = 3_600_000;

const isLiveContract = and(
  eq(contracts.status, "active"),
  eq(contracts.archived, false),
);

/**
 * A snoozed alert stays open — the problem is real — but its contract drops
 * off the board until the snooze passes. Applied per rule, so snoozing
 * "client waiting" over a client's holiday does not also hide a missed
 * milestone on the same contract.
 */
function notSnoozed(rule: string) {
  return sql`not exists (
    select 1 from alerts a
    where a.contract_id = ${contracts.id}
      and a.rule_key = ${rule}
      and a.resolved_at is null
      and a.snoozed_until is not null
      and a.snoozed_until > now()
  )`;
}

export type TodayFilters = {
  /** Account id, or empty for all. */
  account?: string;
  /** Owner user id, or empty for anyone. */
  person?: string;
  /** Stage key, or empty for any. */
  stage?: string;
  /** "open" | "snoozed" | "clear", or empty for any. */
  alert?: string;
};

/** Filters shared by every section, all optional, all URL-backed. */
function filterConditions(f: TodayFilters): (SQL | undefined)[] {
  const out: (SQL | undefined)[] = [];

  if (f.account) out.push(eq(contracts.accountId, f.account));
  if (f.person) out.push(eq(contracts.ownerUserId, f.person));
  if (f.stage) out.push(eq(contracts.stage, f.stage));

  if (f.alert === "open") {
    out.push(sql`exists (
      select 1 from alerts a where a.contract_id = ${contracts.id}
        and a.resolved_at is null
        and (a.snoozed_until is null or a.snoozed_until <= now())
    )`);
  } else if (f.alert === "snoozed") {
    out.push(sql`exists (
      select 1 from alerts a where a.contract_id = ${contracts.id}
        and a.resolved_at is null
        and a.snoozed_until is not null and a.snoozed_until > now()
    )`);
  } else if (f.alert === "clear") {
    out.push(sql`not exists (
      select 1 from alerts a where a.contract_id = ${contracts.id}
        and a.resolved_at is null
    )`);
  }

  return out;
}

export type WaitingRow = {
  id: string;
  account: string;
  title: string;
  client: string;
  owner: string | null;
  since: Date;
};

export type MilestoneRow = {
  id: string;
  contractId: string;
  account: string;
  title: string;
  client: string;
  owner: string | null;
  milestone: string;
  dueAt: Date;
  submitted: boolean;
};

export type NoUpdateRow = {
  id: string;
  account: string;
  title: string;
  client: string;
  owner: string | null;
  lastUpdateAt: Date | null;
  startedAt: Date | null;
};

export type UnassignedRow = {
  id: string;
  account: string;
  title: string;
  client: string;
  startedAt: Date | null;
};

export type TodayBoard = {
  waiting: WaitingRow[];
  milestonesDue: MilestoneRow[];
  noUpdate: NoUpdateRow[];
  unassigned: UnassignedRow[];
};

/**
 * Unowned contracts belong to nobody, so the last section ignores the owner
 * filter — hiding them while a filter is on would defeat the point of the
 * screen. Every other filter still applies to it.
 */
export async function getTodayBoard({
  filters = {},
  now = new Date(),
}: {
  filters?: TodayFilters;
  now?: Date;
}): Promise<TodayBoard> {
  const shared = filterConditions(filters);
  const withoutOwner = filterConditions({ ...filters, person: undefined });

  const waiting = await db
    .select({
      id: contracts.id,
      account: accounts.label,
      title: contracts.title,
      client: clients.name,
      owner: users.name,
      since: contracts.lastClientMessageAt,
    })
    .from(contracts)
    .innerJoin(accounts, eq(accounts.id, contracts.accountId))
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .leftJoin(users, eq(users.id, contracts.ownerUserId))
    .where(
      and(
        isLiveContract,
        ...shared,
        notSnoozed("client_waiting"),
        sql`${contracts.lastClientMessageAt} is not null`,
        or(
          isNull(contracts.lastTeamMessageAt),
          sql`${contracts.lastClientMessageAt} > ${contracts.lastTeamMessageAt}`,
        ),
      ),
    )
    .orderBy(asc(contracts.lastClientMessageAt));

  const milestonesDue = await db
    .select({
      id: milestones.id,
      contractId: contracts.id,
      account: accounts.label,
      title: contracts.title,
      client: clients.name,
      owner: users.name,
      milestone: milestones.title,
      dueAt: milestones.dueAt,
      status: milestones.status,
    })
    .from(milestones)
    .innerJoin(contracts, eq(contracts.id, milestones.contractId))
    .innerJoin(accounts, eq(accounts.id, contracts.accountId))
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .leftJoin(users, eq(users.id, contracts.ownerUserId))
    .where(
      and(
        isLiveContract,
        ...shared,
        notSnoozed("milestone_due"),
        sql`${milestones.status} in ('pending', 'submitted')`,
        gte(milestones.dueAt, now),
        lte(
          milestones.dueAt,
          new Date(now.getTime() + TODAY_MILESTONE_WINDOW_HOURS * HOUR_MS),
        ),
      ),
    )
    .orderBy(asc(milestones.dueAt));

  const noUpdate = await db
    .select({
      id: contracts.id,
      account: accounts.label,
      title: contracts.title,
      client: clients.name,
      owner: users.name,
      lastUpdateAt: contracts.lastUpdateAt,
      startedAt: contracts.startedAt,
    })
    .from(contracts)
    .innerJoin(accounts, eq(accounts.id, contracts.accountId))
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .leftJoin(users, eq(users.id, contracts.ownerUserId))
    .where(
      and(
        isLiveContract,
        ...shared,
        notSnoozed("stale_contract"),
        // Never updated counts from the start date: a contract that landed two
        // hours ago is not yet a failure.
        lte(
          sql`coalesce(${contracts.lastUpdateAt}, ${contracts.startedAt})`,
          new Date(now.getTime() - TODAY_NO_UPDATE_HOURS * HOUR_MS),
        ),
      ),
    )
    .orderBy(sql`coalesce(${contracts.lastUpdateAt}, ${contracts.startedAt}) asc`);

  const unassigned = await db
    .select({
      id: contracts.id,
      account: accounts.label,
      title: contracts.title,
      client: clients.name,
      startedAt: contracts.startedAt,
    })
    .from(contracts)
    .innerJoin(accounts, eq(accounts.id, contracts.accountId))
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .where(
      and(
        isLiveContract,
        ...withoutOwner,
        isNull(contracts.ownerUserId),
        notSnoozed("unassigned"),
      ),
    )
    .orderBy(asc(contracts.startedAt));

  return {
    waiting: waiting.filter((r): r is WaitingRow => r.since !== null),
    milestonesDue: milestonesDue
      .filter((r) => r.dueAt !== null)
      .map((r) => ({
        id: r.id,
        contractId: r.contractId,
        account: r.account,
        title: r.title,
        client: r.client,
        owner: r.owner,
        milestone: r.milestone,
        dueAt: r.dueAt as Date,
        submitted: r.status === "submitted",
      })),
    noUpdate,
    unassigned,
  };
}

/** Active team members, for the assign control and the person filter. */
export async function getAssignableUsers() {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(asc(users.name));
}
