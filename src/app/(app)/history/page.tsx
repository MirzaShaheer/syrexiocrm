import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAssignableUsers } from "@/lib/queries/today";
import { getHistoryBoard } from "@/lib/queries/history";
import { canDeletePastWork } from "@/lib/permissions";
import { outcomeLabel, outcomeTone } from "@/lib/history";
import { money, moneyCompact, plural } from "@/lib/format";
import { formatPktMonth, pktThisMonth } from "@/lib/time";
import { AccountBadge } from "@/components/ui";
import { PageHead, Panel } from "@/components/shell";
import { AddPastWorkForm, DeletePastEntry } from "@/components/history-forms";

export const metadata = { title: "History" };
export const dynamic = "force-dynamic";

/**
 * The record of everything the agency closed before this CRM existed.
 *
 * It reads as a ledger by month, newest first, because that is the shape of
 * the question people actually ask: "how did last March go, and who did we
 * land?" Nothing here is live — every row is a finished job — so the page
 * carries no clocks, no alerts and no urgency colour.
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; year?: string; q?: string }>;
}) {
  const actor = await requireUser();
  const params = await searchParams;
  const filters = {
    accountId: params.account || undefined,
    year: params.year || undefined,
    q: params.q?.trim() || undefined,
  };

  const [board, accountRows, clientRows, people] = await Promise.all([
    getHistoryBoard(filters),
    db
      .select({ id: accounts.id, label: accounts.label })
      .from(accounts)
      .where(eq(accounts.active, true))
      .orderBy(asc(accounts.label)),
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .orderBy(asc(clients.name)),
    getAssignableUsers(),
  ]);

  const filtered = Boolean(filters.accountId || filters.year || filters.q);

  return (
    <>
      <PageHead
        title="History"
        note="Work that closed before the CRM existed. Entered by month, so the client record and the revenue picture go back further than the software does."
      />

      <Panel className="mt-4">
        <AddPastWorkForm
          accounts={accountRows}
          clients={clientRows}
          people={people}
          thisMonth={pktThisMonth()}
        />
      </Panel>

      {/* ----------------------------------------------------------- totals */}
      <Panel className="mt-4">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <Figure value={money(board.totalValue)} label="recorded in total" fig />
          <Figure
            value={String(board.totalEntries)}
            label={plural(board.totalEntries, "past job")}
          />
          <Figure
            value={String(board.totalClients)}
            label={plural(board.totalClients, "client")}
          />
        </div>

        {board.byAccount.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {board.byAccount.map((a) => (
              <span
                key={a.accountId}
                className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5"
              >
                <AccountBadge label={a.label} />
                <span className="fig text-[12.5px] font-medium text-ink-2">
                  {moneyCompact(a.value)}
                </span>
                <span className="text-[11.5px] text-muted">
                  {a.entries} {plural(a.entries, "job")}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </Panel>

      {/* ---------------------------------------------------------- filters */}
      <Panel className="mt-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div>
            <label
              className="block text-[11px] font-semibold tracking-[0.07em] text-muted uppercase"
              htmlFor="h-filter-account"
            >
              Account
            </label>
            <select
              id="h-filter-account"
              name="account"
              defaultValue={filters.accountId ?? ""}
              className="mt-1 min-h-9 rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink"
            >
              <option value="">All four</option>
              {accountRows.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-[11px] font-semibold tracking-[0.07em] text-muted uppercase"
              htmlFor="h-filter-year"
            >
              Year
            </label>
            <select
              id="h-filter-year"
              name="year"
              defaultValue={filters.year ?? ""}
              className="mt-1 min-h-9 rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink"
            >
              <option value="">Every year</option>
              {board.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 flex-1">
            <label
              className="block text-[11px] font-semibold tracking-[0.07em] text-muted uppercase"
              htmlFor="h-filter-q"
            >
              Search
            </label>
            <input
              id="h-filter-q"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Client, country, or what the work was"
              className="mt-1 min-h-9 w-full max-w-sm rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted"
            />
          </div>

          <button type="submit" className="btn min-h-9 px-3 text-[12px] font-medium">
            Apply
          </button>
          {filtered ? (
            <Link
              href="/history"
              className="min-h-9 self-end pb-2 text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </Panel>

      {/* ----------------------------------------------------------- ledger */}
      {board.months.length === 0 ? (
        <Panel className="mt-4">
          <p className="text-[13px] text-ink-2">
            {filtered
              ? "Nothing recorded matches those filters."
              : "No past work recorded yet."}
          </p>
          <p className="mt-1 text-[12px] text-muted">
            {filtered
              ? "Widen the year or the account, or clear the search."
              : "Add the clients the agency landed before this CRM existed — one month at a time. They will show up on the Clients page too, so repeat business finally counts properly."}
          </p>
        </Panel>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {board.months.map((m) => (
            <Panel key={m.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-[14px] font-semibold text-ink">
                  {formatPktMonth(m.month)}
                </h2>
                <div className="flex items-baseline gap-4">
                  <span className="text-[12px] text-muted">
                    {m.entries.length} {plural(m.entries.length, "job")} ·{" "}
                    {m.clients} {plural(m.clients, "client")}
                  </span>
                  <span className="fig text-[14px] font-semibold text-ink">
                    {money(m.total)}
                  </span>
                </div>
              </div>

              {/* One bar per month, scaled against the best month in view. It
                  is the only chart in the product, and it earns its place by
                  making a run of thin months visible at a glance. */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{
                    width: `${
                      board.peakMonth > 0
                        ? Math.max(2, Math.round((m.total / board.peakMonth) * 100))
                        : 2
                    }%`,
                  }}
                />
              </div>

              <ul className="mt-3">
                {m.entries.map((e) => {
                  const tone = outcomeTone(e.outcome);
                  return (
                    <li
                      key={e.id}
                      className="border-t border-line first:border-t-0"
                    >
                      <div className="rowlink flex flex-wrap items-start gap-x-3 gap-y-1.5 py-2.5">
                        <span className="pt-[3px]">
                          <AccountBadge label={e.accountLabel} />
                        </span>

                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/clients/${e.clientId}`}
                            className="text-[13.5px] font-medium text-ink hover:underline"
                          >
                            {e.clientName}
                          </Link>
                          <span className="text-[13px] text-muted"> · {e.title}</span>
                          <p className="mt-0.5 text-[12px] text-muted">
                            <span
                              className={
                                tone === "late"
                                  ? "text-late"
                                  : tone === "done"
                                    ? "text-done"
                                    : "text-ink-2"
                              }
                            >
                              {outcomeLabel(e.outcome)}
                            </span>
                            {e.clientCountry ? ` · ${e.clientCountry}` : ""}
                            {e.type === "hourly" ? " · hourly" : ""}
                            {e.enteredByName ? ` · entered by ${e.enteredByName}` : ""}
                          </p>
                        </div>

                        {canDeletePastWork(actor, e) ? (
                          <DeletePastEntry
                            contractId={e.id}
                            what={`${e.clientName}, ${e.title}`}
                          />
                        ) : null}

                        <span className="fig w-[76px] shrink-0 text-right text-[13px] text-ink-2">
                          {e.value === null ? "—" : money(e.value)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function Figure({
  value,
  label,
  fig,
}: {
  value: string;
  label: string;
  fig?: boolean;
}) {
  return (
    <div>
      <div
        className={`${fig ? "fig" : "num"} text-[24px] leading-none font-semibold text-ink`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[12px] text-muted">{label}</div>
    </div>
  );
}
