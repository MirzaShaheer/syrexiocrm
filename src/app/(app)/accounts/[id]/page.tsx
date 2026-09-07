import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  getAccount,
  getAccountContracts,
  getAccountMilestones,
  getAccountPeople,
} from "@/lib/queries/account";
import { getAccountRollup } from "@/lib/queries/overview";
import { NICHE_LABELS, isTerminalStage, stageLabel } from "@/lib/pipelines";
import { RULES, toneFor, toneForRemaining } from "@/lib/alert-rules";
import { formatClock, formatPktDateTime } from "@/lib/time";
import { money, plural } from "@/lib/format";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Clock } from "@/components/ui";

export const dynamic = "force-dynamic";

const HOUR_MS = 3_600_000;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const account = await getAccount((await params).id);
  return { title: account ? account.label : "Account" };
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const account = await getAccount(id);
  if (!account || !account.active) notFound();

  const [contracts, milestones, people, rollup] = await Promise.all([
    getAccountContracts(id),
    getAccountMilestones(id),
    getAccountPeople(id),
    getAccountRollup(),
  ]);

  const now = new Date();
  const summary = rollup.find((a) => a.id === id);

  return (
    <>
      <header>
        <h1 className="text-[21px] leading-tight font-semibold text-ink">
          {account.label}
        </h1>
        <p className="mt-0.5 text-[13px] text-muted">
          {NICHE_LABELS[account.niche]} ·{" "}
          {account.market === "us" ? "United States" : "Pakistan"} ·{" "}
          {account.lastSyncedAt ? (
            <>
              synced {formatClock(now.getTime() - account.lastSyncedAt.getTime())} ago
            </>
          ) : (
            "never synced"
          )}
        </p>

        {account.connectionState === "needs_reconnect" ? (
          <p className="mt-3 rounded-md border border-line border-l-[3px] border-l-late bg-surface px-3 py-2 text-[13px]">
            <span className="font-medium text-late">Sync is failing.</span>{" "}
            <span className="text-muted">
              Everything below may be out of date.{" "}
            </span>
            <Link href="/settings" className="text-ink-2 underline decoration-line-strong underline-offset-2">
              Reconnect
            </Link>
          </p>
        ) : null}
      </header>

      {summary ? (
        <div className="panel mt-4 grid grid-cols-3 gap-4">
          <Metric n={summary.activeContracts} label="active contracts" />
          <Metric
            n={summary.alertContracts}
            label="in an alert state"
            tone={summary.alertContracts > 0 ? "late" : "plain"}
          />
          <Metric text={money(summary.wipValue)} label="fixed-price in progress" fig />
        </div>
      ) : null}

      {/* -------------------------------------------------------- contracts */}
      <section className="panel mt-3">
        <h2 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
          Contracts <span className="num font-normal">{contracts.length}</span>
        </h2>

        {contracts.length === 0 ? (
          <Empty
            what="No active contracts on this account."
            next="New contracts appear here automatically once Upwork sync runs."
          />
        ) : (
          <ul className="mt-2">
            {contracts.map((c) => {
              const waiting =
                c.lastClientMessageAt &&
                (!c.lastTeamMessageAt ||
                  c.lastClientMessageAt > c.lastTeamMessageAt);
              const staleMs = c.lastUpdateAt
                ? now.getTime() - c.lastUpdateAt.getTime()
                : null;
              return (
                <li key={c.id} className="border-t border-line first:border-t-0">
                  <div className="rowlink flex items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/contracts/${c.id}`}
                        className="block text-ink hover:underline"
                      >
                        <span className="text-[13.5px] font-medium">{c.title}</span>
                        <span className="text-[13px] text-muted"> · {c.client}</span>
                      </Link>
                      <p className="mt-0.5 text-[12px] text-muted">
                        <span className="font-medium text-ink-2">{c.owner ?? "No owner"}</span> ·{" "}
                        <span className={isTerminalStage(account.niche, c.stage) ? "text-done" : undefined}>{stageLabel(account.niche, c.stage)}</span> ·{" "}
                        {c.nextActionText ?? "no next action"}
                        {waiting ? " · client waiting" : ""}
                      </p>
                    </div>

                    {c.openAlerts > 0 ? (
                      <span className="shrink-0 text-[12px] font-medium text-late">
                        {c.openAlerts} {plural(c.openAlerts, "alert")}
                      </span>
                    ) : null}

                    {/* The clock measures one thing — time since the last
                        update — and takes its colour from that same measure.
                        Anything else colours a number by a fact it is not
                        reporting. */}
                    <Clock
                      value={staleMs === null ? "never" : formatClock(staleMs)}
                      tone={
                        staleMs === null
                          ? "late"
                          : toneFor(
                              staleMs / HOUR_MS,
                              RULES.stale_contract.threshold,
                            )
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- milestones */}
      <section className="panel mt-3">
        <h2 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">Upcoming milestones</h2>
        {milestones.length === 0 ? (
          <Empty
            what="No milestones scheduled on this account."
            next="Fixed-price contracts show their milestones here as Upwork sends them."
          />
        ) : (
          <ul className="mt-2">
            {milestones.map((m) => {
              const remaining = (m.dueAt.getTime() - now.getTime()) / HOUR_MS;
              return (
                <li key={m.id} className="border-t border-line first:border-t-0">
                  <div className="rowlink flex items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/contracts/${m.contractId}`}
                        className="block text-ink hover:underline"
                      >
                        <span className="font-medium">{m.title}</span>
                        <span className="text-muted"> · {m.contract}</span>
                      </Link>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {m.status === "submitted"
                          ? "submitted, waiting on approval"
                          : "nothing submitted"}{" "}
                        · due {formatPktDateTime(m.dueAt)} PKT
                      </p>
                    </div>
                    <span className="fig shrink-0 text-[13px] text-ink-2">
                      {money(m.amount)}
                    </span>
                    <Clock
                      value={formatClock(m.dueAt.getTime() - now.getTime())}
                      tone={
                        m.status === "submitted"
                          ? "plain"
                          : toneForRemaining(
                              remaining,
                              RULES.milestone_due.threshold,
                              48,
                            )
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------------- people */}
      <section className="panel mt-3">
        <h2 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
          People on this account
        </h2>
        {people.length === 0 ? (
          <Empty
            what="Nobody owns anything on this account yet."
            next="Assign an owner from the problem list to see them here."
          />
        ) : (
          <div className="scroll-x mt-2">
            <table className="w-full min-w-[460px] border-collapse">
              <thead>
                <tr className="border-y border-line text-left">
                  <Th>Person</Th>
                  <Th right>Contracts</Th>
                  <Th right>In alert</Th>
                  <Th right>Updates, 7d</Th>
                  <Th right>Awaiting reply</Th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-b border-line">
                    <td className="py-2.5 pr-3">
                      <Link
                        href={`/today?person=${p.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="ml-2 text-[12px] text-muted">
                        {ROLE_LABELS[p.role as Role] ?? p.role}
                      </span>
                    </td>
                    <Td>{p.activeContracts}</Td>
                    <Td tone={p.alertContracts > 0 ? "late" : undefined}>
                      {p.alertContracts}
                    </Td>
                    <Td>{p.updatesThisWeek}</Td>
                    <Td tone={p.awaitingReply > 0 ? "late" : undefined}>
                      {p.awaitingReply}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Metric({
  n,
  text,
  label,
  tone = "plain",
  fig,
}: {
  n?: number;
  text?: string;
  label: string;
  tone?: "plain" | "late";
  fig?: boolean;
}) {
  return (
    <div>
      <div
        className={`${fig ? "fig" : "num"} text-[22px] leading-none font-semibold ${
          tone === "late" ? "text-late" : "text-ink"
        }`}
      >
        {text ?? n}
      </div>
      <div className="mt-1 text-[12px] text-muted">{label}</div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`py-2 text-[11px] font-medium text-muted ${
        right ? "pl-3 text-right" : "pr-3"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "late";
}) {
  return (
    <td
      className={`num py-2.5 pl-3 text-right ${
        tone === "late" ? "font-medium text-late" : "text-ink-2"
      }`}
    >
      {children}
    </td>
  );
}

function Empty({ what, next }: { what: string; next: string }) {
  return (
    <div className="mt-2">
      <p className="text-ink-2">{what}</p>
      <p className="mt-0.5 text-[12px] text-muted">{next}</p>
    </div>
  );
}
