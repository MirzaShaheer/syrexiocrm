import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  alerts,
  clients,
  contracts,
  events,
  milestones,
  notes,
  updates,
  users,
} from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import type { Niche } from "@/lib/pipelines";

export type ContractDetail = {
  id: string;
  title: string;
  type: "fixed" | "hourly";
  value: number | null;
  currency: string;
  status: "active" | "paused" | "ended";
  stage: string;
  nextActionText: string | null;
  nextActionDueAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  lastClientMessageAt: Date | null;
  lastTeamMessageAt: Date | null;
  lastUpdateAt: Date | null;
  upworkContractId: string;

  accountId: string;
  accountLabel: string;
  accountNiche: Niche;

  clientId: string;
  clientName: string;
  clientCountry: string | null;
  clientTimezone: string | null;

  ownerUserId: string | null;
  ownerName: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
};

export async function getContractDetail(
  id: string,
): Promise<ContractDetail | null> {
  const owner = alias(users, "owner");
  const [row] = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      type: contracts.type,
      value: contracts.value,
      currency: contracts.currency,
      status: contracts.status,
      stage: contracts.stage,
      nextActionText: contracts.nextActionText,
      nextActionDueAt: contracts.nextActionDueAt,
      startedAt: contracts.startedAt,
      endedAt: contracts.endedAt,
      lastClientMessageAt: contracts.lastClientMessageAt,
      lastTeamMessageAt: contracts.lastTeamMessageAt,
      lastUpdateAt: contracts.lastUpdateAt,
      upworkContractId: contracts.upworkContractId,
      accountId: accounts.id,
      accountLabel: accounts.label,
      accountNiche: accounts.niche,
      clientId: clients.id,
      clientName: clients.name,
      clientCountry: clients.country,
      clientTimezone: clients.timezone,
      ownerUserId: contracts.ownerUserId,
      ownerName: owner.name,
      createdByUserId: contracts.createdByUserId,
    })
    .from(contracts)
    .innerJoin(accounts, eq(accounts.id, contracts.accountId))
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .leftJoin(owner, eq(owner.id, contracts.ownerUserId))
    .where(eq(contracts.id, id))
    .limit(1);

  if (!row) return null;

  let createdByName: string | null = null;
  if (row.createdByUserId) {
    const [c] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, row.createdByUserId))
      .limit(1);
    createdByName = c?.name ?? null;
  }

  return {
    ...row,
    value: row.value === null ? null : Number(row.value),
    createdByName,
  };
}

/* ------------------------------------------------------------------ alerts */

export type OpenAlert = {
  id: string;
  ruleKey: string;
  openedAt: Date;
  snoozedUntil: Date | null;
  snoozeReason: string | null;
  snoozedByName: string | null;
};

export async function getContractAlerts(
  contractId: string,
): Promise<OpenAlert[]> {
  const by = alias(users, "snoozed_by");
  return db
    .select({
      id: alerts.id,
      ruleKey: alerts.ruleKey,
      openedAt: alerts.openedAt,
      snoozedUntil: alerts.snoozedUntil,
      snoozeReason: alerts.snoozeReason,
      snoozedByName: by.name,
    })
    .from(alerts)
    .leftJoin(by, eq(by.id, alerts.snoozedByUserId))
    .where(and(eq(alerts.contractId, contractId), isNull(alerts.resolvedAt)))
    .orderBy(asc(alerts.openedAt));
}

/* ---------------------------------------------------------------- timeline */

export type TimelineEntry = {
  kind: "update" | "note" | "event";
  id: string;
  at: Date;
  /** Display name, or "System" for anything Upwork told us. */
  who: string;
  body: string | null;
  type: string;
  canEdit?: boolean;
};

/**
 * The merged record: updates, internal notes and the audit log in one
 * chronological read. This screen exists so that when a client claims nothing
 * happened last week, the answer takes ten seconds to find.
 *
 * `update_posted` and `note_added` events are excluded because the rows
 * themselves carry the full text — the event is only a pointer.
 */
export async function getTimeline(
  contractId: string,
): Promise<TimelineEntry[]> {
  const [updateRows, noteRows, eventRows] = await Promise.all([
    db
      .select({
        id: updates.id,
        at: updates.createdAt,
        who: users.name,
        body: updates.body,
        authorUserId: updates.authorUserId,
      })
      .from(updates)
      .innerJoin(users, eq(users.id, updates.authorUserId))
      .where(eq(updates.contractId, contractId))
      .orderBy(desc(updates.createdAt)),

    db
      .select({
        id: notes.id,
        at: notes.createdAt,
        who: users.name,
        body: notes.body,
        authorUserId: notes.authorUserId,
      })
      .from(notes)
      .innerJoin(users, eq(users.id, notes.authorUserId))
      .where(eq(notes.contractId, contractId))
      .orderBy(desc(notes.createdAt)),

    db
      .select({
        id: events.id,
        at: events.occurredAt,
        type: events.type,
        actor: events.actor,
        payload: events.payload,
      })
      .from(events)
      .where(
        and(
          eq(events.contractId, contractId),
          sql`${events.type} not in ('update_posted', 'note_added')`,
        ),
      )
      .orderBy(desc(events.occurredAt)),
  ]);

  // Resolve actor ids to names in one pass rather than per row.
  const actorIds = [
    ...new Set(eventRows.map((e) => e.actor).filter((a) => a !== "system")),
  ];
  const actorNames = new Map<string, string>();
  if (actorIds.length) {
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, actorIds));
    for (const r of rows) actorNames.set(r.id, r.name);
  }

  const entries: TimelineEntry[] = [
    ...updateRows.map((u) => ({
      kind: "update" as const,
      id: u.id,
      at: u.at,
      who: u.who,
      body: u.body,
      type: "update",
    })),
    ...noteRows.map((n) => ({
      kind: "note" as const,
      id: n.id,
      at: n.at,
      who: n.who,
      body: n.body,
      type: "note",
    })),
    ...eventRows.map((e) => ({
      kind: "event" as const,
      id: e.id,
      at: e.at,
      who: e.actor === "system" ? "Upwork" : (actorNames.get(e.actor) ?? "Someone"),
      body: describeEvent(e.type, e.payload),
      type: e.type,
    })),
  ];

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}

function humanise(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Plain English for an audit row. No raw type strings in front of a person. */
function describeEvent(
  type: string,
  payload: Record<string, unknown>,
): string {
  const p = payload as Record<string, string | number | null | undefined>;
  switch (type) {
    case "contract_created":
      return p.manual
        ? `Contract added${p.byName ? ` by ${p.byName}` : ""}`
        : "Contract started on Upwork";
    case "owner_assigned":
      return `Assigned to ${p.toName ?? "someone"}`;
    case "owner_handover":
      return `Handed over to ${p.toName ?? "someone"}${p.reason ? ` — ${p.reason}` : ""}`;
    case "stage_changed":
      // Older rows carry only the raw key, so tidy it rather than print
      // "Stage moved to internal_review" at a person.
      return `Stage moved to ${p.toLabel ?? humanise(p.to) ?? "a new stage"}`;
    case "next_action_changed":
      return p.text ? `Next action set: ${p.text}` : "Next action cleared";
    case "milestone_submitted":
      return `Milestone submitted: ${p.title ?? ""}`;
    case "milestone_approved":
      return `Milestone approved: ${p.title ?? ""}`;
    case "message_received":
      return `Client message received${p.from ? ` from ${p.from}` : ""}`;
    case "message_sent":
      return "Reply sent to client";
    case "alert_snoozed":
      return `${p.ruleLabel ?? "Alert"} snoozed until ${p.untilLabel ?? "later"} — ${p.reason ?? ""}`;
    case "value_changed":
      return `Value changed to ${p.toLabel ?? p.to ?? ""}`;
    default:
      return type.replace(/_/g, " ");
  }
}

/* -------------------------------------------------------------- milestones */

export async function getContractMilestones(contractId: string) {
  const rows = await db
    .select()
    .from(milestones)
    .where(eq(milestones.contractId, contractId))
    .orderBy(asc(milestones.dueAt));
  return rows.map((m) => ({
    ...m,
    amount: m.amount === null ? null : Number(m.amount),
  }));
}
