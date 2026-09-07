import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  getContractAlerts,
  getContractDetail,
  getContractMilestones,
  getTimeline,
} from "@/lib/queries/contract";
import { getAssignableUsers } from "@/lib/queries/today";
import { canEditContract } from "@/lib/permissions";
import { RULES, type RuleKey } from "@/lib/alert-rules";
import { stagesFor, NICHE_LABELS } from "@/lib/pipelines";
import { agoLabel, bothZones, formatClock, formatPktDateTime } from "@/lib/time";
import { money } from "@/lib/format";
import { AccountBadge } from "@/components/ui";
import { ActivityButtons, AddMilestone, MilestoneStatus } from "@/components/create-forms";
import {
  AddNote,
  HandoverForm,
  NextActionForm,
  PostUpdate,
  SnoozeAlert,
  StageForm,
} from "@/components/contract-forms";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const c = await getContractDetail((await params).id);
  return { title: c ? c.title : "Contract" };
}

/** yyyy-MM-ddTHH:mm in Pakistan time, for a datetime-local input. */
function pktInputValue(d: Date | null): string {
  if (!d) return "";
  const shifted = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

export default async function ContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireUser();
  const { id } = await params;

  const contract = await getContractDetail(id);
  if (!contract) notFound();

  const [timeline, alerts, milestones, people] = await Promise.all([
    getTimeline(id),
    getContractAlerts(id),
    getContractMilestones(id),
    getAssignableUsers(),
  ]);

  const now = new Date();
  const canEdit = canEditContract(actor, contract);
  const stages = stagesFor(contract.accountNiche);
  const tz = contract.clientTimezone;

  const nextActionLate =
    contract.nextActionDueAt !== null && contract.nextActionDueAt < now;
  const noNextAction = !contract.nextActionText;

  return (
    <>
      {/* ------------------------------------------------------------ header */}
      <header>
        <div className="flex items-start gap-3">
          <span className="pt-1">
            <AccountBadge label={contract.accountLabel} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] leading-tight font-semibold text-ink">
              {contract.title}
            </h1>
            <p className="mt-1 text-[12px] text-muted">
              <Link
                href={`/clients/${contract.clientId}`}
                className="text-ink-2 underline decoration-line-strong underline-offset-2"
              >
                {contract.clientName}
              </Link>
              {contract.clientCountry ? ` · ${contract.clientCountry}` : ""} ·{" "}
              <Link
                href={`/accounts/${contract.accountId}`}
                className="text-ink-2 underline decoration-line-strong underline-offset-2"
              >
                {contract.accountLabel}
              </Link>{" "}
              · {NICHE_LABELS[contract.accountNiche]}
            </p>
          </div>
        </div>

        <dl className="panel mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Field label={contract.type === "hourly" ? "Rate" : "Value"}>
            <span className="fig text-[13px] text-ink">
              {money(contract.value)}
              {contract.type === "hourly" ? " / hr" : ""}
            </span>
          </Field>
          <Field label="Stage">
            <StageForm
              contractId={contract.id}
              niche={contract.accountNiche}
              stage={contract.stage}
              stages={stages}
              canEdit={canEdit}
            />
          </Field>
          <Field label="Owner">
            <div>
              <span className="text-[13px] text-ink">
                {contract.ownerName ?? "Nobody"}
              </span>
              <div className="mt-0.5">
                <HandoverForm
                  contractId={contract.id}
                  currentOwnerId={contract.ownerUserId}
                  people={people}
                />
              </div>
            </div>
          </Field>
          <Field label="Status">
            <span className="text-[13px] text-ink capitalize">
              {contract.status}
            </span>
          </Field>
        </dl>
      </header>

      {/* ------------------------------------------------------- next action */}
      <section
        className={`panel mt-3 border-l-[3px] ${
          noNextAction || nextActionLate ? "border-l-late" : "border-l-line-strong"
        }`}
      >
        <h2 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
          Next action
          {noNextAction ? (
            <span className="ml-2 font-normal tracking-normal text-late normal-case">
              none set
            </span>
          ) : nextActionLate ? (
            <span className="ml-2 font-normal tracking-normal text-late normal-case">
              overdue by {formatClock(now.getTime() - contract.nextActionDueAt!.getTime())}
            </span>
          ) : contract.nextActionDueAt ? (
            <span
              className="ml-2 font-normal tracking-normal text-muted normal-case"
              title={bothZones(contract.nextActionDueAt, tz) ?? undefined}
            >
              due {formatPktDateTime(contract.nextActionDueAt)} PKT
            </span>
          ) : null}
        </h2>
        <div className="mt-2">
          <NextActionForm
            contractId={contract.id}
            text={contract.nextActionText}
            dueAtLocal={pktInputValue(contract.nextActionDueAt)}
            canEdit={canEdit}
          />
        </div>
      </section>

      <section className="panel mt-3">
        <h2 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
          Message activity
        </h2>
        <p className="mt-1 mb-2 text-[12px] text-muted">
          One press when a client writes, one when we answer. This is what
          drives &ldquo;client waiting on a reply&rdquo;.
          {contract.lastClientMessageAt ? (
            <>
              {" "}Client last wrote{" "}
              {agoLabel(now.getTime() - contract.lastClientMessageAt.getTime())}.
            </>
          ) : null}
          {contract.lastTeamMessageAt ? (
            <>
              {" "}We last replied{" "}
              {agoLabel(now.getTime() - contract.lastTeamMessageAt.getTime())}.
            </>
          ) : null}
        </p>
        <ActivityButtons contractId={contract.id} />
      </section>

      {/* ------------------------------------------------------------ alerts */}
      {alerts.length > 0 ? (
        <section className="panel mt-3">
          <h2 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
            Open alerts
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {alerts.map((a) => (
              <li key={a.id}>
                <SnoozeAlert
                  alertId={a.id}
                  label={RULES[a.ruleKey as RuleKey]?.label ?? a.ruleKey}
                  snoozedUntilLabel={
                    a.snoozedUntil && a.snoozedUntil > now
                      ? formatPktDateTime(a.snoozedUntil)
                      : null
                  }
                  snoozeReason={a.snoozeReason}
                  snoozedByName={a.snoozedByName}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* -------------------------------------------------------- milestones */}
      {contract.type === "fixed" || milestones.length > 0 ? (
        <section className="panel mt-3">
          <h2 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
            Milestones
          </h2>
          <ul className="mt-2">
            {milestones.map((m) => (
              <li
                key={m.id}
                className="flex items-baseline gap-3 border-t border-line py-2 first:border-t-0"
              >
                <span className="min-w-0 flex-1 text-[13px] text-ink">
                  {m.title}
                </span>
                <MilestoneStatus milestoneId={m.id} status={m.status} />
                {m.dueAt ? (
                  <span
                    className="text-[12px] text-muted"
                    title={bothZones(m.dueAt, tz) ?? undefined}
                  >
                    {formatPktDateTime(m.dueAt)} PKT
                  </span>
                ) : null}
                <span className="fig w-[72px] shrink-0 text-right text-[13px] text-ink-2">
                  {money(m.amount)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2.5">
            <AddMilestone contractId={contract.id} />
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------------- notes */}
      <section className="panel mt-3">
        <h2 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
          Internal note
        </h2>
        <p className="mt-1 mb-2 text-[12px] text-muted">
          Visible to the team, never to the client. Separate from the daily
          update.
        </p>
        <AddNote contractId={contract.id} />
      </section>

      {/* ---------------------------------------------------------- timeline */}
      <section className="panel mt-3">
        <h2 className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
          Timeline
        </h2>

        <div className="mt-2">
          <PostUpdate contractId={contract.id} />
        </div>

        {timeline.length === 0 ? (
          <div className="py-4">
            <p className="text-[13px] text-ink-2">Nothing has happened yet.</p>
            <p className="mt-0.5 text-[12px] text-muted">
              Post the first update above, and every message, milestone and
              change will land here beside it.
            </p>
          </div>
        ) : (
          <ul>
            {timeline.map((e) => (
              <li key={`${e.kind}-${e.id}`} className="border-t border-line py-2.5 first:border-t-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] text-ink">
                    {e.kind === "note" ? (
                      <span className="mr-1.5 rounded-sm bg-surface-2 px-1 py-[1px] text-[10.5px] font-semibold tracking-[0.04em] text-muted uppercase">
                        Note
                      </span>
                    ) : null}
                    {e.body}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-muted">
                  <span className="text-ink-2">{e.who}</span> ·{" "}
                  <span title={bothZones(e.at, tz) ?? undefined}>
                    {formatPktDateTime(e.at)} PKT
                  </span>{" "}
                  · {agoLabel(now.getTime() - e.at.getTime())}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-[12px] text-muted">
        Upwork contract {contract.upworkContractId}
        {contract.createdByName ? ` · record created by ${contract.createdByName}` : ""}
        {contract.startedAt
          ? ` · started ${formatPktDateTime(contract.startedAt)} PKT`
          : ""}
      </p>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
