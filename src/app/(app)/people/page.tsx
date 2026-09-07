import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPeopleBoard } from "@/lib/queries/week";
import { isOwner, ROLE_LABELS, type Role } from "@/lib/permissions";
import { formatPktDateTime } from "@/lib/time";
import { AdminGrant } from "@/components/admin-grant";
import { PageHead, Panel } from "@/components/shell";

export const metadata = { title: "People" };
export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const actor = await requireUser();
  const people = await getPeopleBoard();
  const now = new Date();

  return (
    <>
      <PageHead
        title="People"
        note="The same numbers for everyone. A shared picture, not a private report — nobody here has a view of the team that the team does not have."
      />

      <Panel className="scroll-x mt-4">
        <table className="w-full min-w-[680px] border-collapse text-[13px]">
          <thead>
            <tr className="border-y border-line text-left">
              <Th>Person</Th>
              <Th right>Contracts</Th>
              <Th right>In alert</Th>
              <Th right>Awaiting reply</Th>
              <Th right>Updates this week</Th>
              <Th>Telegram</Th>
              {isOwner(actor) ? <Th>Access</Th> : null}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const elevated = p.adminUntil !== null && p.adminUntil > now;
              return (
                <tr key={p.id} className="border-b border-line align-top">
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
                  <Td tone={p.awaitingReply > 0 ? "late" : undefined}>
                    {p.awaitingReply}
                  </Td>
                  <Td
                    tone={
                      p.updatesExpected > 0 && p.updatesThisWeek === 0
                        ? "late"
                        : undefined
                    }
                  >
                    {p.updatesThisWeek}
                    <span className="text-muted">
                      {p.updatesExpected > 0 ? ` / ${p.updatesExpected}` : ""}
                    </span>
                  </Td>
                  <td className="py-2.5 pr-3 text-[12px]">
                    <span
                      className={p.telegramLinked ? "text-done" : "text-muted"}
                    >
                      {p.telegramLinked ? "linked" : "not linked"}
                    </span>
                  </td>
                  {isOwner(actor) ? (
                    <td className="py-2.5 pr-3">
                      {p.id === actor.id ? (
                        <span className="text-[12px] text-muted">owner</span>
                      ) : (
                        <AdminGrant
                          userId={p.id}
                          name={p.name}
                          activeUntilLabel={
                            elevated ? formatPktDateTime(p.adminUntil!) : null
                          }
                        />
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel className="mt-4">
        <p className="max-w-3xl text-[12px] text-muted">
          Updates expected is one per owned contract per working day. It is a
          yardstick, not a target — a contract that genuinely had no movement is
          better served by an honest silence than a filler line.
        </p>
        {isOwner(actor) ? (
          <p className="mt-2 max-w-3xl text-[12px] text-muted">
            The Access column is yours alone. A grant lets someone edit records
            they did not create, expires on its own, and is written to the audit
            log both when you give it and when you take it back.
          </p>
        ) : (
          <p className="mt-2 max-w-3xl text-[12px] text-muted">
            You can read every contract and add to any of them. Changing a field
            somebody else wrote needs a time-boxed access grant, which only Mir
            gives out.
          </p>
        )}
      </Panel>
    </>
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
