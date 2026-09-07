import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAccountRollup, getAgencyTotals } from "@/lib/queries/overview";
import { AccountTile } from "@/components/account";
import { PageHead, Panel } from "@/components/shell";
import { delta, money, plural } from "@/lib/format";
import { formatClock } from "@/lib/time";

export const metadata = { title: "Agency" };
export const dynamic = "force-dynamic";

export default async function AgencyPage() {
  await requireUser();
  const [rollup, totals] = await Promise.all([
    getAccountRollup(),
    getAgencyTotals(),
  ]);

  const now = new Date();
  const stale = rollup.filter((a) => a.connectionState === "needs_reconnect");
  const monthDelta = delta(totals.deliveredThisMonth, totals.deliveredLastMonth);

  return (
    <>
      <PageHead
        title="Overview"
        note="All four Upwork accounts on one screen. Open an account to work inside it, or go to Today for the list of things that need somebody."
      />

      {/* A failing sync means every figure below it may be wrong. Loudest thing
          on the page, above the tiles, or it is not doing its job. */}
      {stale.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-line border-l-[3px] border-l-late bg-raised px-3.5 py-2.5 shadow-[var(--shadow-sm)]">
          <span className="font-medium text-late">
            {stale.length === 1
              ? `${stale[0].label} has not synced`
              : `${stale.length} accounts have not synced`}
          </span>
          <span className="text-[12px] text-muted">
            {stale
              .map(
                (a) =>
                  `${a.label}, last success ${
                    a.lastSyncedAt ? formatClock(now.getTime() - a.lastSyncedAt.getTime()) + " ago" : "never"
                  }`,
              )
              .join(" · ")}
          </span>
          <Link href="/settings" className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2">
            Reconnect
          </Link>
        </div>
      ) : null}

      <section className="mt-4">
        <h2 className="sr-only">All accounts</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rollup.map((a) => (
            <AccountTile key={a.id} a={a} />
          ))}
        </div>
      </section>

      <Panel className="mt-4 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
        <Figure
          value={String(totals.openAlerts)}
          mono
          label="Open alerts"
          detail={
            totals.openAlerts === 0
              ? "Nothing is late across any account"
              : `across ${totals.alertContracts} ${plural(totals.alertContracts, "contract")}`
          }
          href="/today"
          hrefLabel="Open the problem list"
          tone={totals.openAlerts === 0 ? "plain" : "late"}
        />

        <Figure
          value={money(totals.milestonesThisWeekValue)}
          label="Milestones due this week"
          detail={
            totals.milestonesThisWeek === 0
              ? "None due in the next seven days"
              : `${totals.milestonesThisWeek} ${plural(totals.milestonesThisWeek, "milestone")} in the next seven days`
          }
        />

        <Figure
          value={money(totals.deliveredThisMonth)}
          label="Approved this month"
          detail={`${money(totals.deliveredLastMonth)} last month · ${monthDelta.text}`}
        />
      </Panel>
    </>
  );
}

function Figure({
  value,
  label,
  detail,
  href,
  hrefLabel,
  tone = "plain",
  mono = false,
}: {
  value: string;
  label: string;
  detail: string;
  href?: string;
  hrefLabel?: string;
  tone?: "plain" | "late";
  mono?: boolean;
}) {
  return (
    <div>
      <div
        className={`${mono ? "num" : "fig"} text-[26px] leading-none font-semibold ${
          tone === "late" ? "text-late" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[13px] font-medium text-ink-2">{label}</div>
      <p className="mt-0.5 text-[12px] text-muted">{detail}</p>
      {href ? (
        <Link
          href={href}
          className="mt-1.5 inline-block text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
        >
          {hrefLabel}
        </Link>
      ) : null}
    </div>
  );
}
