"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { accountColor } from "@/lib/account-colors";
import { money } from "@/lib/format";
import {
  deleteWeekCounts,
  restoreWeekCounts,
  saveWeekCounts,
} from "@/lib/actions/create";
import {
  TRASH_DAYS,
  WEEK_COUNT_FIELDS,
  type DeleteCountsResult,
  type RestoreCountsResult,
  type TrashEntry,
  type WeekCountValues,
  type WeekCountsResult,
} from "@/lib/week-counts";

export type FunnelRow = WeekCountValues & {
  accountId: string;
  label: string;
  /** Contracts whose last client message landed this week, per the CRM. */
  chatsFromCrm: number;
  /** Contracts the CRM recorded as starting this week. */
  contractsStarted: number;
  /** Approved milestone value this week. */
  earned: number;
};

/** No stored row at all, which is what a delete leaves behind. */
const NOTHING: WeekCountValues = {
  bids: null,
  chatsOpened: null,
  contracted: null,
  closed: null,
  withdrawn: null,
};

/**
 * The funnel table, the editor that fills it, and the trash that catches what
 * gets deleted — one client component on purpose. Every one of those actions
 * hands its result back, so the table repaints the moment something changes
 * rather than waiting on a route refresh.
 */
export function WeekFunnel({
  weekStartIso,
  rows,
  trash,
  valueApproved,
}: {
  weekStartIso: string;
  rows: FunnelRow[];
  trash: TrashEntry[];
  valueApproved: number;
}) {
  /* Counts changed since this page rendered, painted over the server copy. */
  const [saved, setSaved] = useState<Record<string, WeekCountValues>>({});
  const [bin, setBin] = useState<TrashEntry[]>(trash);
  const [selectedId, setSelectedId] = useState(rows[0]?.accountId ?? "");
  const [armed, setArmed] = useState(false);

  const [state, action, pending] = useActionState<WeekCountsResult | null, FormData>(
    saveWeekCounts,
    null,
  );
  const [delState, delAction, delPending] = useActionState<
    DeleteCountsResult | null,
    FormData
  >(deleteWeekCounts, null);
  const [resState, resAction, resPending] = useActionState<
    RestoreCountsResult | null,
    FormData
  >(restoreWeekCounts, null);

  const router = useRouter();

  useEffect(() => {
    if (!state?.ok) return;
    setSaved((prev) => ({ ...prev, [state.accountId]: state.counts }));
    // Keeps the rest of the app, and the next visit to this page, in step.
    router.refresh();
  }, [state, router]);

  useEffect(() => {
    if (!delState?.ok) return;
    setSaved((prev) => ({ ...prev, [delState.accountId]: NOTHING }));
    setBin((prev) => [delState.entry, ...prev.filter((e) => e.id !== delState.entry.id)]);
    setArmed(false);
    router.refresh();
  }, [delState, router]);

  useEffect(() => {
    if (!resState?.ok) return;
    setBin((prev) => prev.filter((e) => e.id !== resState.id));
    // A row restored into some other week does not belong in this table.
    if (resState.weekStartIso === weekStartIso) {
      setSaved((prev) => ({ ...prev, [resState.accountId]: resState.counts }));
    }
    router.refresh();
  }, [resState, router, weekStartIso]);

  const current = rows.map((r) => ({ ...r, ...(saved[r.accountId] ?? {}) }));
  const selected = current.find((r) => r.accountId === selectedId) ?? current[0];
  /* bids is not nullable in the table, so a value there means a row exists. */
  const hasStoredRow = selected ? selected.bids !== null : false;

  const view = current.map((r) => {
    const chats = r.chatsOpened ?? r.chatsFromCrm;
    const contracted = r.contracted ?? r.contractsStarted;
    return {
      ...r,
      chats,
      contractedShown: contracted,
      chatsTyped: r.chatsOpened !== null,
      contractedTyped: r.contracted !== null,
      bidToChat: r.bids && r.bids > 0 ? Math.round((chats / r.bids) * 100) : null,
      chatToContract: chats > 0 ? Math.round((contracted / chats) * 100) : null,
    };
  });

  const total = {
    bids: sum(view.map((r) => r.bids)),
    chats: view.reduce((s, r) => s + r.chats, 0),
    contracted: view.reduce((s, r) => s + r.contractedShown, 0),
    closed: sum(view.map((r) => r.closed)),
    withdrawn: sum(view.map((r) => r.withdrawn)),
  };
  const anyBids = view.some((r) => r.bids !== null);

  return (
    <>
      {/* ----------------------------------------------------------- table */}
      <div className="scroll-x mt-3">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-y border-line text-left">
              <Th>Account</Th>
              {WEEK_COUNT_FIELDS.map((f) => (
                <Th key={f.name} right>
                  {f.label}
                </Th>
              ))}
              <Th right>Bid to chat</Th>
              <Th right>Chat to contract</Th>
              <Th right>Approved</Th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const c = accountColor(r.label);
              const on = r.accountId === selected?.accountId;
              return (
                <tr
                  key={r.accountId}
                  className={`border-b border-line ${on ? "bg-surface" : ""}`}
                >
                  <td className="py-2.5 pr-3">
                    <Link href={`/accounts/${r.accountId}`}>
                      <span
                        className="inline-block w-[58px] truncate rounded-sm px-1 py-[2px] text-center text-[10.5px] font-semibold"
                        style={{ backgroundColor: c.tint, color: c.ink }}
                      >
                        {r.label}
                      </span>
                    </Link>
                  </td>
                  <Td muted={r.bids === null}>
                    {r.bids === null ? "not entered" : r.bids}
                  </Td>
                  <Td muted={!r.chatsTyped}>{r.chats}</Td>
                  <Td muted={!r.contractedTyped}>{r.contractedShown}</Td>
                  <Td muted={r.closed === null}>{r.closed ?? "—"}</Td>
                  <Td muted={r.withdrawn === null}>{r.withdrawn ?? "—"}</Td>
                  <Td muted={r.bidToChat === null}>
                    {r.bidToChat === null ? "—" : `${r.bidToChat}%`}
                  </Td>
                  <Td muted={r.chatToContract === null}>
                    {r.chatToContract === null ? "—" : `${r.chatToContract}%`}
                  </Td>
                  <Td fig>{money(r.earned)}</Td>
                </tr>
              );
            })}
            <tr className="border-b border-line font-medium">
              <td className="py-2.5 pr-3 text-[12px] text-muted">All accounts</td>
              <Td muted={total.bids === null}>{total.bids ?? "—"}</Td>
              <Td>{total.chats}</Td>
              <Td>{total.contracted}</Td>
              <Td muted={total.closed === null}>{total.closed ?? "—"}</Td>
              <Td muted={total.withdrawn === null}>{total.withdrawn ?? "—"}</Td>
              <Td muted={!total.bids}>
                {total.bids ? `${Math.round((total.chats / total.bids) * 100)}%` : "—"}
              </Td>
              <Td muted={total.chats === 0}>
                {total.chats > 0
                  ? `${Math.round((total.contracted / total.chats) * 100)}%`
                  : "—"}
              </Td>
              <Td fig>{money(valueApproved)}</Td>
            </tr>
          </tbody>
        </table>
      </div>

      {!anyBids ? (
        <p className="mt-2 text-[12px] text-muted">
          No bid counts entered for this week yet, so the conversion columns are
          blank rather than wrong.
        </p>
      ) : null}

      {/* ---------------------------------------------------------- editor */}
      {selected ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
            Edit a row
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-[172px_1fr]">
            <div
              role="tablist"
              aria-label="Account to edit"
              aria-orientation="vertical"
              className="flex flex-col gap-1 sm:border-r sm:border-line sm:pr-4"
            >
              {current.map((r) => {
                const c = accountColor(r.label);
                const on = r.accountId === selected.accountId;
                return (
                  <button
                    key={r.accountId}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-controls={`counts-${r.accountId}`}
                    onClick={() => {
                      setSelectedId(r.accountId);
                      setArmed(false);
                    }}
                    className={`flex min-h-9 items-center gap-2 rounded-md px-2.5 text-left transition-colors ${
                      on ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: on ? c.ink : c.tint }}
                    />
                    <span className="flex-1 truncate text-[13px] font-medium">
                      {r.label}
                    </span>
                    <span className="num text-[11.5px] text-muted">
                      {r.bids ?? "—"}
                    </span>
                  </button>
                );
              })}
            </div>

            <form
              key={selected.accountId}
              id={`counts-${selected.accountId}`}
              role="tabpanel"
              action={action}
              className="swipe-in flex flex-col gap-3"
            >
              <input type="hidden" name="weekStart" value={weekStartIso} />
              <input type="hidden" name="accountId" value={selected.accountId} />

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {WEEK_COUNT_FIELDS.map((f) => (
                  <div key={f.name}>
                    <label
                      className="block text-[11px] font-semibold tracking-[0.07em] text-muted uppercase"
                      htmlFor={`${f.name}-${selected.accountId}`}
                    >
                      {f.label}
                    </label>
                    <input
                      id={`${f.name}-${selected.accountId}`}
                      name={f.name}
                      inputMode="numeric"
                      autoComplete="off"
                      defaultValue={selected[f.name] ?? ""}
                      placeholder="—"
                      title={f.hint}
                      className="num mt-1 min-h-9 w-full rounded-sm border border-line-strong bg-raised px-2.5 text-[14px] text-ink placeholder:text-muted"
                    />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={pending || delPending}
                  className="btn min-h-9 px-3 text-[12px] font-medium text-ink-2 disabled:opacity-50"
                >
                  {pending ? "Saving…" : `Save ${selected.label}`}
                </button>

                {/*
                 * Two presses, matching the one other destructive control in
                 * the product — though this one lands in the trash rather
                 * than going anywhere final.
                 */}
                {hasStoredRow && !armed ? (
                  <button
                    type="button"
                    onClick={() => setArmed(true)}
                    className="min-h-9 px-1 text-[12px] text-muted hover:text-late"
                  >
                    Delete
                  </button>
                ) : null}

                {hasStoredRow && armed ? (
                  <>
                    <button
                      type="submit"
                      formAction={delAction}
                      disabled={delPending}
                      className="min-h-9 px-1 text-[12px] font-medium text-late disabled:opacity-50"
                    >
                      {delPending ? "Deleting…" : `Delete ${selected.label}'s counts`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setArmed(false)}
                      className="min-h-9 px-1 text-[12px] text-muted"
                    >
                      Keep
                    </button>
                  </>
                ) : null}

                <Note
                  state={state}
                  delState={delState}
                  armed={armed && hasStoredRow}
                />
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ----------------------------------------------------------- trash */}
      {bin.length ? (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
              Trash
            </p>
            <p className="text-[12px] text-muted">
              Deleted counts stay here {TRASH_DAYS} days, then are erased.
            </p>
          </div>

          <ul className="mt-2">
            {bin.map((e) => {
              const c = accountColor(e.accountLabel);
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2.5 last:border-b-0"
                >
                  <span
                    className="inline-block w-[58px] shrink-0 truncate rounded-sm px-1 py-[2px] text-center text-[10.5px] font-semibold"
                    style={{ backgroundColor: c.tint, color: c.ink }}
                  >
                    {e.accountLabel}
                  </span>
                  <span className="text-[12px] text-ink-2">{e.weekLabel}</span>
                  <span className="num text-[12px] text-muted">
                    {WEEK_COUNT_FIELDS.map((f) => e[f.name] ?? "—").join(" · ")}
                  </span>
                  <span className="flex-1" />
                  <span className="text-[11.5px] text-muted">
                    {e.deletedByName ? `deleted by ${e.deletedByName}` : "deleted"} ·{" "}
                    {e.daysLeft === 0
                      ? "erased today"
                      : `${e.daysLeft} ${e.daysLeft === 1 ? "day" : "days"} left`}
                  </span>
                  <form action={resAction}>
                    <input type="hidden" name="trashId" value={e.id} />
                    <button
                      type="submit"
                      disabled={resPending}
                      className="btn min-h-8 px-2.5 text-[12px] text-ink-2 disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>

          {resState && !resState.ok ? (
            <p role="alert" className="mt-2 text-[12px] text-late">
              {resState.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * The one line of feedback under the buttons. Whichever action spoke last
 * wins, so a save message never sits there contradicting a delete.
 */
function Note({
  state,
  delState,
  armed,
}: {
  state: WeekCountsResult | null;
  delState: DeleteCountsResult | null;
  armed: boolean;
}) {
  if (armed) {
    return (
      <span className="text-[12px] text-muted">
        It goes to the trash below, and can be restored for {TRASH_DAYS} days.
      </span>
    );
  }
  const last = delState ?? state;
  if (!last) {
    return (
      <span className="text-[12px] text-muted">
        A blank box stays blank in the table — it is not a zero.
      </span>
    );
  }
  return (
    <span
      role={last.ok ? "status" : "alert"}
      className={`text-[12px] ${last.ok ? "text-muted" : "text-late"}`}
    >
      {last.message}
    </span>
  );
}

/** Null unless somebody typed at least one of them; blanks are not zeroes. */
function sum(values: (number | null)[]): number | null {
  return values.some((v) => v !== null)
    ? values.reduce<number>((s, v) => s + (v ?? 0), 0)
    : null;
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
  fig,
}: {
  children: React.ReactNode;
  muted?: boolean;
  fig?: boolean;
}) {
  return (
    <td
      className={`${fig ? "fig" : "num"} py-2.5 pl-3 text-right ${
        muted ? "text-muted" : "text-ink-2"
      }`}
    >
      {children}
    </td>
  );
}
