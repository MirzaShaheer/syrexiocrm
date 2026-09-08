import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getWeek } from "@/lib/queries/week";
import { money, plural } from "@/lib/format";
import { formatPktDateTime } from "@/lib/time";
import { WeekFunnel } from "@/components/week-funnel";
import { PageHead, Panel, PanelTitle } from "@/components/shell";

export const metadata = { title: "Week" };
export const dynamic = "force-dynamic";

export default async function WeekPage() {
  await requireUser();
  const week = await getWeek();

  return (
    <>
      <PageHead
        title="This week"
        note="What the four accounts actually produced, and the funnel that produced it."
        action={
          <span className="text-[12px] text-muted">
            {formatPktDateTime(week.from).split(",")[0]} to{" "}
            {formatPktDateTime(new Date(week.to.getTime() - 1)).split(",")[0]} ·
            Pakistan time
          </span>
        }
      />

      {/* ---------------------------------------------------- what happened */}
      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat n={week.valueApproved} label="approved" money />
        <Stat n={week.milestonesApproved} label={plural(week.milestonesApproved, "milestone")} />
        <Stat n={week.delivered} label="contracts ended" />
        <Stat n={week.updatesPosted} label="updates posted" />
        <Stat n={week.alertsOpened} label="alerts opened" />
        <Stat n={week.alertsResolved} label="alerts closed" tone="done" />
      </section>

      {/* ---------------------------------------------------------- funnel */}
      <Panel className="mt-4">
        <PanelTitle note="Pick a profile below the table to edit its row.">
          How each profile is performing
        </PanelTitle>
        <p className="mt-1 text-[12px] text-muted">
          Upwork has no API for proposals, chats or Connects, so every count
          here is typed in. Approved value is the CRM&rsquo;s own figure.
        </p>

        <WeekFunnel
          weekStartIso={week.from.toISOString()}
          rows={week.funnel}
          trash={week.trash}
          valueApproved={week.valueApproved}
        />
      </Panel>

      {/* ---------------------------------------------------------- people */}
      <Panel className="mt-4">
        <PanelTitle note="Every update on record, not only this week's.">
          Updates posted, per person
        </PanelTitle>
        <div className="scroll-x mt-3">
          <table className="w-full min-w-[520px] border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-line text-left">
                <Th>Person</Th>
                <Th right>Updates, all time</Th>
                <Th right>This week</Th>
                <Th right>Contracts</Th>
                <Th right>Alerts raised</Th>
              </tr>
            </thead>
            <tbody>
              {week.perPerson.map((p) => (
                <tr key={p.id} className="border-b border-line">
                  <td className="py-2.5 pr-3">
                    <Link
                      href={`/today?person=${p.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <Td muted={p.updates === 0}>{p.updates}</Td>
                  <Td muted={p.updatesThisWeek === 0}>{p.updatesThisWeek}</Td>
                  <Td>{p.contractsOwned}</Td>
                  <Td tone={p.alertsOpened > 0 ? "late" : undefined}>
                    {p.alertsOpened}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function Stat({
  n,
  label,
  money: isMoney,
  tone,
}: {
  n: number;
  label: string;
  money?: boolean;
  tone?: "done";
}) {
  return (
    <div className="tile p-3.5">
      <div
        className={`${isMoney ? "fig" : "num"} text-[20px] leading-none font-semibold ${
          tone === "done" ? "text-done" : "text-ink"
        }`}
      >
        {isMoney ? money(n) : n}
      </div>
      <div className="mt-1.5 text-[11.5px] text-muted">{label}</div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`py-2 text-[11px] font-medium text-muted ${right ? "pl-3 text-right" : "pr-3"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  muted,
  tone,
  fig,
}: {
  children: React.ReactNode;
  muted?: boolean;
  tone?: "late";
  fig?: boolean;
}) {
  return (
    <td
      className={`${fig ? "fig" : "num"} py-2.5 pl-3 text-right ${
        tone === "late"
          ? "font-medium text-late"
          : muted
            ? "text-muted"
            : "text-ink-2"
      }`}
    >
      {children}
    </td>
  );
}
