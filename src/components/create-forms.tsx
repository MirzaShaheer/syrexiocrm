"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/actions/contracts";
import {
  addMilestone,
  createContract,
  markActivity,
  setMilestoneStatus,
} from "@/lib/actions/create";
import { PIPELINES, type Niche } from "@/lib/pipelines";

const field =
  "min-h-9 w-full rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted";
const label = "block text-[11px] font-semibold tracking-[0.07em] text-muted uppercase";

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-[12px] ${state.ok ? "text-muted" : "text-late"}`}
    >
      {state.message}
    </p>
  );
}

/* ------------------------------------------------------- new contract form */

export function NewContractForm({
  accounts,
  clients,
  people,
  today,
}: {
  accounts: { id: string; label: string; niche: Niche }[];
  clients: { id: string; name: string }[];
  people: { id: string; name: string }[];
  /** yyyy-MM-dd in Pakistan time, so "started today" is the default. */
  today: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createContract,
    null,
  );
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [newClient, setNewClient] = useState(false);

  const niche = accounts.find((a) => a.id === accountId)?.niche;
  const stages = niche ? PIPELINES[niche] : [];

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="c-account">
            Upwork account
          </label>
          <select
            id="c-account"
            name="accountId"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={`${field} mt-1`}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="c-stage">
            Stage
          </label>
          <select id="c-stage" name="stage" className={`${field} mt-1`}>
            {stages.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted">
            The pipeline follows the account&rsquo;s niche.
          </p>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="c-title">
          What is the work?
        </label>
        <input
          id="c-title"
          name="title"
          required
          placeholder="e.g. Marketing site and CMS migration"
          className={`${field} mt-1`}
        />
      </div>

      {/* ------------------------------------------------------------ client */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className={label}>Client</span>
          <button
            type="button"
            onClick={() => setNewClient((v) => !v)}
            className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
          >
            {newClient ? "Pick an existing client" : "This is a new client"}
          </button>
        </div>

        {newClient ? (
          <div className="mt-1 grid gap-2 sm:grid-cols-3">
            <input
              name="newClientName"
              placeholder="Client name"
              className={field}
            />
            <input
              name="newClientCountry"
              placeholder="Country"
              className={field}
            />
            <select name="newClientTimezone" defaultValue="" className={field}>
              <option value="">Their timezone</option>
              <option value="America/New_York">US Eastern</option>
              <option value="America/Chicago">US Central</option>
              <option value="America/Denver">US Mountain</option>
              <option value="America/Los_Angeles">US Pacific</option>
              <option value="Europe/London">UK</option>
              <option value="Australia/Sydney">Australia east</option>
              <option value="Asia/Dubai">Gulf</option>
              <option value="Asia/Karachi">Pakistan</option>
            </select>
          </div>
        ) : (
          <select name="clientId" defaultValue="" className={`${field} mt-1`}>
            <option value="">Choose a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="c-type">
            Type
          </label>
          <select id="c-type" name="type" defaultValue="fixed" className={`${field} mt-1`}>
            <option value="fixed">Fixed price</option>
            <option value="hourly">Hourly</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="c-value">
            Value or hourly rate
          </label>
          <input
            id="c-value"
            name="value"
            inputMode="decimal"
            placeholder="1500"
            className={`${field} mt-1`}
          />
        </div>
        <div>
          <label className={label} htmlFor="c-started">
            Started
          </label>
          <input
            id="c-started"
            name="startedAt"
            type="date"
            defaultValue={today}
            className={`${field} mt-1`}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="c-owner">
            Owner
          </label>
          <select id="c-owner" name="ownerUserId" defaultValue="" className={`${field} mt-1`}>
            <option value="">Nobody yet</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted">
            Leaving this empty puts it on Today until somebody picks it up.
          </p>
        </div>
        <div>
          <label className={label} htmlFor="c-ref">
            Upwork contract id
          </label>
          <input
            id="c-ref"
            name="upworkContractId"
            placeholder="Optional"
            className={`${field} mt-1`}
          />
          <p className="mt-1 text-[11px] text-muted">
            Leave blank and one is generated.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <label className={label} htmlFor="c-next">
            Next action
          </label>
          <input
            id="c-next"
            name="nextActionText"
            placeholder="What has to happen next?"
            className={`${field} mt-1`}
          />
        </div>
        <div>
          <label className={label} htmlFor="c-due">
            Due, Pakistan time
          </label>
          <input
            id="c-due"
            name="nextActionDueAt"
            type="datetime-local"
            className={`${field} mt-1`}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-9 rounded-sm bg-ink px-4 text-[12px] font-medium text-page disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create contract"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/* -------------------------------------------------------- message activity */

export function ActivityButtons({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    markActivity,
    null,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={action}>
        <input type="hidden" name="contractId" value={contractId} />
        <input type="hidden" name="direction" value="in" />
        <button
          type="submit"
          disabled={pending}
          className="min-h-8 rounded-sm border border-line-strong px-2.5 text-[12px] text-ink-2 disabled:opacity-50"
        >
          Client messaged
        </button>
      </form>
      <form action={action}>
        <input type="hidden" name="contractId" value={contractId} />
        <input type="hidden" name="direction" value="out" />
        <button
          type="submit"
          disabled={pending}
          className="min-h-8 rounded-sm border border-line-strong px-2.5 text-[12px] text-ink-2 disabled:opacity-50"
        >
          We replied
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}

/* -------------------------------------------------------------- milestones */

export function AddMilestone({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addMilestone,
    null,
  );
  const ref = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);

  /*
    Empty the row once the milestone lands, so the next one can be typed
    straight in. Keyed off the result rather than wrapping the action: wrapping
    it takes the pending state out of React's hands and the button never stops
    saying "Adding…".
  */
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
      >
        Add a milestone
      </button>
    );
  }

  return (
    <form
      ref={ref}
      action={action}
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="contractId" value={contractId} />
      <input
        name="title"
        placeholder="Milestone title"
        className={`${field} min-w-0 flex-1`}
      />
      <input
        name="amount"
        inputMode="decimal"
        placeholder="Amount"
        className={`${field} w-28`}
      />
      <input name="dueAt" type="datetime-local" className={`${field} w-52`} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-9 rounded-sm bg-ink px-3 text-[12px] font-medium text-page disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="min-h-9 px-2 text-[12px] text-muted"
      >
        Done
      </button>
      <div className="basis-full">
        <Result state={state} />
      </div>
    </form>
  );
}

export function MilestoneStatus({
  milestoneId,
  status,
}: {
  milestoneId: string;
  status: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setMilestoneStatus,
    null,
  );
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form ref={ref} action={action} className="inline-flex">
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <label className="sr-only" htmlFor={`ms-${milestoneId}`}>
        Milestone status
      </label>
      <select
        id={`ms-${milestoneId}`}
        name="status"
        defaultValue={status}
        disabled={pending}
        onChange={() => ref.current?.requestSubmit()}
        className={`min-h-7 rounded-sm border border-line bg-raised px-1.5 text-[12px] ${
          status === "approved" ? "text-done" : "text-muted"
        } disabled:opacity-50`}
      >
        <option value="pending">pending</option>
        <option value="submitted">submitted</option>
        <option value="approved">approved</option>
        <option value="cancelled">cancelled</option>
      </select>
      {state && !state.ok ? (
        <span className="ml-2 text-[11px] text-late">{state.message}</span>
      ) : null}
    </form>
  );
}
