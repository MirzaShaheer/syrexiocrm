import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getWeek } from "@/lib/queries/week";
import { money, plural } from "@/lib/format";
import { formatPktDateTime } from "@/lib/time";
import { accountColor } from "@/lib/account-colors";
import { BidEntry } from "@/components/bid-entry";
import { PageHead, Panel, PanelTitle } from "@/components/shell";

export const metadata = { title: "Week" };
export const dynamic = "force-dynamic";

export default async function WeekPage() {
  await requireUser();
  const week = await getWeek();

  const totalBids = week.funnel.reduce((s, f) => s + (f.bids ?? 0), 0);
  const totalChats = week.funnel.reduce((s, f) => s + f.chatsOpened, 0);
  const totalWon = week.funnel.reduce((s, f) => s + f.won, 0);
  const anyBids = week.funnel.some((f) => f.bids !== null);

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
        <PanelTitle>How each profile is performing</PanelTitle>
        <p className="mt-1 text-[12px] text-muted">
          Bids are typed in — Upwork has no API for proposals or Connects.
          Chats and contracts won are counted from the CRM.
        </p>

        <div className="scroll-x mt-3">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-line text-left">
                <Th>Account</Th>
                <Th right>Bids</Th>
                <Th right>Chats opened</Th>
                <Th right>Won</Th>
                <Th right>Bid to chat</Th>
                <Th right>Chat to win</Th>
                <Th right>Approved</Th>
              </tr>
            </thead>
            <tbody>
              {week.funnel.map((f) => {
                const c = accountColor(f.label);
                const bidToChat =
                  f.bids && f.bids > 0
                    ? `${Math.round((f.chatsOpened / f.bids) * 100)}%`
                    : "—";
                const chatToWin =
                  f.chatsOpened > 0
                    ? `${Math.round((f.won / f.chatsOpened) * 100)}%`
                    : "—";
                return (
                  <tr key={f.accountId} className="border-b border-line">
                    <td className="py-2.5 pr-3">
                      <Link href={`/accounts/${f.accountId}`}>
                        <span
                          className="inline-block w-[58px] truncate rounded-sm px-1 py-[2px] text-center text-[10.5px] font-semibold"
                          style={{ backgroundColor: c.tint, color: c.ink }}
                        >
                          {f.label}
                        </span>
                      </Link>
                    </td>
                    <Td muted={f.bids === null}>
                      {f.bids === null ? "not entered" : f.bids}
                    </Td>
                    <Td>{f.chatsOpened}</Td>
                    <Td>{f.won}</Td>
                    <Td muted={bidToChat === "—"}>{bidToChat}</Td>
                    <Td muted={chatToWin === "—"}>{chatToWin}</Td>
                    <Td fig>{money(f.earned)}</Td>
                  </tr>
                );
              })}
              <tr className="border-b border-line font-medium">
                <td className="py-2.5 pr-3 text-[12px] text-muted">All four</td>
                <Td muted={!anyBids}>{anyBids ? totalBids : "—"}</Td>
                <Td>{totalChats}</Td>
                <Td>{totalWon}</Td>
                <Td muted={!anyBids || totalBids === 0}>
                  {anyBids && totalBids > 0
                    ? `${Math.round((totalChats / totalBids) * 100)}%`
                    : "—"}
                </Td>
                <Td muted={totalChats === 0}>
                  {totalChats > 0
                    ? `${Math.round((totalWon / totalChats) * 100)}%`
                    : "—"}
                </Td>
                <Td fig>{money(week.valueApproved)}</Td>
              </tr>
            </tbody>
          </table>
        </div>

        {!anyBids ? (
          <p className="mt-2 text-[12px] text-muted">
            No bid counts entered for this week yet, so the conversion columns
            are blank rather than wrong.
          </p>
        ) : null}
      </Panel>

      {/* ----------------------------------------------------- bid entry */}
      <Panel className="mt-4">
        <PanelTitle note="One number per account. Ten seconds every Monday.">
          Bids sent this week
        </PanelTitle>
        <div className="mt-3">
          <BidEntry
            weekStartIso={week.from.toISOString()}
            accounts={week.funnel.map((f) => ({
              id: f.accountId,
              label: f.label,
              bids: f.bids,
            }))}
          />
        </div>
      </Panel>

      {/* ---------------------------------------------------------- people */}
      <Panel className="mt-4">
        <PanelTitle>Updates posted, per person</PanelTitle>
        <div className="scroll-x mt-3">
          <table className="w-full min-w-[420px] border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-line text-left">
                <Th>Person</Th>
                <Th right>Updates</Th>
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
