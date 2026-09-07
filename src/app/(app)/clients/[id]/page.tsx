import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getClientRecord } from "@/lib/queries/client";
import { money, plural } from "@/lib/format";
import { formatInZone, formatPktDateTime, zoneAbbrev } from "@/lib/time";
import { AccountBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const c = await getClientRecord((await params).id);
  return { title: c ? c.name : "Client" };
}

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const client = await getClientRecord((await params).id);
  if (!client) notFound();

  const now = new Date();
  const stillWithUs = client.activeContracts > 0;

  return (
    <>
      <header>
        <h1 className="text-[19px] leading-tight font-semibold text-ink">
          {client.name}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted">
          {client.country ?? "Country unknown"}
          {client.timezone ? (
            <span>
              · {formatInZone(now, client.timezone)}{" "}
              {zoneAbbrev(now, client.timezone)} for them right now
            </span>
          ) : null}
          {client.upworkClientRef ? (
            <span className="num">· {client.upworkClientRef}</span>
          ) : null}
        </p>

        <div className="panel mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <Figure
            value={stillWithUs ? "Working with us" : "Not currently"}
            label={
              stillWithUs
                ? `${client.activeContracts} active ${plural(client.activeContracts, "contract")}`
                : "no active contracts"
            }
            tone={stillWithUs ? "done" : "plain"}
          />
          <Figure
            value={String(client.totalContracts)}
            label={`${plural(client.totalContracts, "contract")} all time`}
            mono
          />
          <Figure
            value={money(client.totalApproved)}
            label="approved, all time"
          />
          <Figure
            value={client.repeat ? "Repeat client" : "One contract so far"}
            label={
              client.accountsUsed.length > 1
                ? `across ${client.accountsUsed.length} accounts`
                : `first seen ${formatPktDateTime(client.firstSeenAt)}`
            }
            tone={client.repeat ? "done" : "plain"}
          />
        </div>
      </header>

      <section className="panel mt-3">
        <h2 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
          Every contract
        </h2>
        <ul className="mt-2">
          {client.contracts.map((c) => (
            <li key={c.id} className="border-t border-line first:border-t-0">
              <div className="rowlink flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
                <span className="pt-[3px]">
                  <AccountBadge label={c.accountLabel} />
                </span>

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/contracts/${c.id}`}
                    className="text-[13.5px] font-medium text-ink hover:underline"
                  >
                    {c.title}
                  </Link>
                  <p className="mt-0.5 text-[12px] text-muted">
                    <span className="font-medium text-ink-2">
                      {c.ownerName ?? "No owner"}
                    </span>{" "}
                    ·{" "}
                    {c.startedAt
                      ? `started ${formatPktDateTime(c.startedAt)}`
                      : "start date unknown"}
                    {c.endedAt ? `, ended ${formatPktDateTime(c.endedAt)}` : ""}
                  </p>
                </div>

                {/* A backfilled job says so, so nobody mistakes a typed-in
                    memory for something the CRM watched happen. */}
                {c.isHistorical ? (
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.04em] text-muted uppercase">
                    past record
                  </span>
                ) : null}

                <span
                  className={`shrink-0 text-[12px] ${
                    c.status === "active"
                      ? "font-medium text-ink-2"
                      : c.status === "ended"
                        ? "text-done"
                        : "text-muted"
                  }`}
                >
                  {c.status === "ended" ? "completed" : c.status}
                </span>

                <span className="fig w-[76px] shrink-0 text-right text-[13px] text-ink-2">
                  {money(c.approved > 0 ? c.approved : c.value)}
                  {c.approved === 0 && c.type === "hourly" ? " / hr" : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-4 max-w-3xl text-[12px] text-muted">
        Amounts are approved milestones where there are any, otherwise the
        contract value. Hourly work is shown at its rate, because time tracking
        is not in this tool. A past record was typed in from memory on the{" "}
        <Link
          href="/history"
          className="text-ink-2 underline decoration-line-strong underline-offset-2"
        >
          History
        </Link>{" "}
        page, so its value is what somebody remembered rather than what a
        milestone recorded.
      </p>
    </>
  );
}

function Figure({
  value,
  label,
  tone = "plain",
  mono,
}: {
  value: string;
  label: string;
  tone?: "plain" | "done";
  mono?: boolean;
}) {
  return (
    <div>
      <div
        className={`${mono ? "num" : "fig"} text-[15px] leading-tight font-semibold ${
          tone === "done" ? "text-done" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-muted">{label}</div>
    </div>
  );
}
