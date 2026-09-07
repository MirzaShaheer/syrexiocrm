import { Suspense } from "react";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  RULES,
  TODAY_MILESTONE_WINDOW_HOURS,
  toneFor,
  toneForRemaining,
  worstTone,
} from "@/lib/alert-rules";
import { formatClock } from "@/lib/time";
import { PIPELINES } from "@/lib/pipelines";
import { getAssignableUsers, getTodayBoard } from "@/lib/queries/today";
import { AssignOwner } from "@/components/assign-owner";
import { BulkAssign, Filters, RepliedButton } from "@/components/today-actions";
import { Clock, CountCard, EmptyState, Row, Section } from "@/components/ui";
import { PageHead, Panel } from "@/components/shell";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

const HOUR_MS = 3_600_000;

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{
    person?: string;
    account?: string;
    stage?: string;
    alert?: string;
  }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const now = new Date();

  const filters = {
    person: sp.person ?? "",
    account: sp.account ?? "",
    stage: sp.stage ?? "",
    alert: sp.alert ?? "",
  };

  const [board, people, accountRows] = await Promise.all([
    getTodayBoard({ filters, now }),
    getAssignableUsers(),
    db
      .select({ id: accounts.id, label: accounts.label })
      .from(accounts)
      .where(eq(accounts.active, true))
      .orderBy(asc(accounts.label)),
  ]);

  const filteredPerson = filters.person
    ? (
        await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, filters.person))
          .limit(1)
      )[0]?.name
    : undefined;

  const dayIsClear =
    board.waiting.length === 0 &&
    board.milestonesDue.length === 0 &&
    board.noUpdate.length === 0 &&
    board.unassigned.length === 0;

  // Each list's tone is computed once and reused by both the rows and the card
  // above them, so a summary count can never claim an urgency its rows lack.
  const waitingTones = board.waiting.map((r) =>
    toneFor(
      (now.getTime() - r.since.getTime()) / HOUR_MS,
      RULES.client_waiting.threshold,
    ),
  );
  const milestoneTones = board.milestonesDue.map((r) =>
    r.submitted
      ? ("plain" as const)
      : toneForRemaining(
          (r.dueAt.getTime() - now.getTime()) / HOUR_MS,
          RULES.milestone_due.threshold,
          TODAY_MILESTONE_WINDOW_HOURS,
        ),
  );
  const noUpdateTones = board.noUpdate.map((r) => {
    const from = r.lastUpdateAt ?? r.startedAt;
    const elapsed = from ? now.getTime() - from.getTime() : 0;
    return toneFor(elapsed / HOUR_MS, RULES.stale_contract.threshold);
  });
  const unassignedTones = board.unassigned.map((r) =>
    toneFor(
      (r.startedAt ? now.getTime() - r.startedAt.getTime() : 0) / HOUR_MS,
      RULES.unassigned.threshold,
    ),
  );

  const qs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  ).toString();
  const q = qs ? `?${qs}` : "";

  // Every stage across every pipeline, de-duplicated for the filter.
  const stageOptions = Array.from(
    new Map(
      Object.values(PIPELINES)
        .flat()
        .map((s) => [s.key, s.label]),
    ).entries(),
  ).map(([value, label]) => ({ value, label }));

  return (
    <>
      <PageHead
        title={filteredPerson ?? "Today"}
        note={
          filteredPerson
            ? "Everything of theirs that is slipping."
            : "Everything that is slipping, and nothing else. Clear these four queues and the day is done."
        }
        action={
          <span className="text-[12px] text-muted">
            {filters.account
              ? accountRows.find((a) => a.id === filters.account)?.label
              : "All four accounts"}
          </span>
        }
      />

      <Panel className="mt-4">
        <Suspense fallback={<div className="h-8" />}>
          <Filters
            accounts={accountRows.map((a) => ({ value: a.id, label: a.label }))}
            people={people.map((p) => ({ value: p.id, label: p.name }))}
            stages={stageOptions}
            current={filters}
          />
        </Suspense>
      </Panel>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountCard
          label="Client waiting"
          count={board.waiting.length}
          href={`/today${q}#client-waiting-on-a-reply`}
          tone={worstTone(waitingTones)}
        />
        <CountCard
          label="Milestones in 48h"
          count={board.milestonesDue.length}
          href={`/today${q}#milestones-due-in-48-hours`}
          tone={worstTone(milestoneTones)}
        />
        <CountCard
          label="No update in 24h"
          count={board.noUpdate.length}
          href={`/today${q}#no-update-posted-in-24-hours`}
          tone={worstTone(noUpdateTones)}
        />
        <CountCard
          label="No owner"
          count={board.unassigned.length}
          href={`/today${q}#new-contract-no-owner-set`}
          tone={worstTone(unassignedTones)}
        />
      </div>

      {dayIsClear ? (
        <div className="panel mt-3">
          <p className="text-[15px] text-ink">
            {qs ? "Nothing matches those filters." : "The day is clear."}
          </p>
          <p className="mt-1 max-w-md text-muted">
            {qs
              ? "Widen the filters, or clear them to see the whole board."
              : "Every active contract has an owner, a next action and a recent update, and no client is waiting on a reply."}
          </p>
          <Link
            href={qs ? "/today" : "/"}
            className="mt-3 inline-block text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
          >
            {qs ? "Clear filters" : "Back to all accounts"}
          </Link>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <Section
            title="Client waiting on a reply"
            isEmpty={board.waiting.length === 0}
            empty={
              <EmptyState
                what="Nobody is waiting on us."
                next="A contract appears here when a client's last message is newer than ours."
              />
            }
          >
            {board.waiting.map((r, i) => (
              <Row
                key={r.id}
                account={r.account}
                title={r.title}
                client={r.client}
                href={`/contracts/${r.id}`}
                owner={r.owner ?? "No owner"}
                reason="no reply sent"
                action={<RepliedButton contractId={r.id} />}
                clock={
                  <Clock
                    value={formatClock(now.getTime() - r.since.getTime())}
                    tone={waitingTones[i]}
                  />
                }
              />
            ))}
          </Section>

          <Section
            title="Milestones due in 48 hours"
            isEmpty={board.milestonesDue.length === 0}
            empty={
              <EmptyState
                what="No milestone deadlines in the next two days."
                next="Add a milestone with a due date on any fixed-price contract and it will appear here as the date approaches."
              />
            }
          >
            {board.milestonesDue.map((r, i) => (
              <Row
                key={r.id}
                account={r.account}
                title={r.title}
                client={r.client}
                href={`/contracts/${r.contractId}`}
                owner={r.owner ?? "No owner"}
                reason={
                  r.submitted
                    ? `${r.milestone}, submitted`
                    : `${r.milestone}, nothing submitted`
                }
                clock={
                  <Clock
                    value={formatClock(r.dueAt.getTime() - now.getTime())}
                    tone={milestoneTones[i]}
                  />
                }
              />
            ))}
          </Section>

          <Section
            title="No update posted in 24 hours"
            isEmpty={board.noUpdate.length === 0}
            empty={
              <EmptyState
                what="Every contract has an update from the last day."
                next="A contract lands here 24 hours after its most recent update."
              />
            }
          >
            {board.noUpdate.map((r, i) => {
              const from = r.lastUpdateAt ?? r.startedAt;
              const elapsed = from ? now.getTime() - from.getTime() : 0;
              return (
                <Row
                  key={r.id}
                  account={r.account}
                  title={r.title}
                  client={r.client}
                  href={`/contracts/${r.id}`}
                  owner={r.owner ?? "No owner"}
                  reason={r.lastUpdateAt ? "no update posted" : "never updated"}
                  clock={
                    <Clock value={formatClock(elapsed)} tone={noUpdateTones[i]} />
                  }
                />
              );
            })}
          </Section>

          <Section
            title="New contract, no owner set"
            note={filters.person ? "owner filter does not apply" : undefined}
            isEmpty={board.unassigned.length === 0}
            empty={
              <EmptyState
                what="Everything active has somebody on it."
                next="A contract created without an owner appears here until somebody picks it up."
              />
            }
          >
            {board.unassigned.map((r, i) => (
              <Row
                key={r.id}
                account={r.account}
                title={r.title}
                client={r.client}
                href={`/contracts/${r.id}`}
                owner="Unassigned"
                reason="nobody is on this"
                action={<AssignOwner contractId={r.id} people={people} />}
                clock={
                  <Clock
                    value={formatClock(
                      r.startedAt ? now.getTime() - r.startedAt.getTime() : 0,
                    )}
                    tone={unassignedTones[i]}
                  />
                }
              />
            ))}
          </Section>

          {board.unassigned.length > 1 ? (
            <div className="panel">
              <h3 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
                Assign several at once
              </h3>
              <BulkAssign
                contracts={board.unassigned.map((r) => ({
                  id: r.id,
                  title: r.title,
                  account: r.account,
                }))}
                people={people}
              />
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
