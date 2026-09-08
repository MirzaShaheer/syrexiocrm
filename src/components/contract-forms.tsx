"use client";

import { useActionState, useRef, useState } from "react";
import { useRefreshOnSuccess } from "@/components/use-refresh-on-success";
import type { ActionResult } from "@/lib/actions/contracts";
import {
  addNote,
  handOver,
  postUpdate,
  setNextAction,
  setStage,
  snoozeAlert,
  unsnoozeAlert,
} from "@/lib/actions/contract-detail";
import { SNOOZE_DURATIONS } from "@/lib/alert-rules";
import type { Stage } from "@/lib/pipelines";

/** Shared result line. Success is quiet; a refusal says what to do next. */
function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`mt-1 text-[12px] ${state.ok ? "text-muted" : "text-late"}`}
    >
      {state.message}
    </p>
  );
}

/* ----------------------------------------------------------- post update */

export function PostUpdate({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    postUpdate,
    null,
  );
  
  const ref = useRef<HTMLFormElement>(null);
  useRefreshOnSuccess(state, ref);

  return (
    <form
      ref={ref}
      action={action}
      className="border-b border-line pb-3"
    >
      <input type="hidden" name="contractId" value={contractId} />
      <label className="sr-only" htmlFor="update-body">
        Today&rsquo;s update
      </label>
      <div className="flex gap-2">
        <input
          id="update-body"
          name="body"
          autoComplete="off"
          placeholder="What happened today?"
          className="min-h-9 flex-1 rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-9 shrink-0 rounded-sm bg-ink px-3 text-[12px] font-medium text-page disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

/* ------------------------------------------------------------- next action */

export function NextActionForm({
  contractId,
  text,
  dueAtLocal,
  canEdit,
}: {
  contractId: string;
  text: string | null;
  /** Pre-formatted as yyyy-MM-ddTHH:mm in PKT. */
  dueAtLocal: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setNextAction,
    null,
  );
  useRefreshOnSuccess(state);

  if (!canEdit) {
    return (
      <p className="text-[12px] text-muted">
        Only the person who created this contract can change the next action.
      </p>
    );
  }

  return (
    <div>
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <input type="hidden" name="contractId" value={contractId} />
        {/*
          min-w-0 matters: without it the text field cannot shrink below its
          intrinsic width and the flex row collapses it to nothing.
        */}
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="next-text">
            Next action
          </label>
          <input
            id="next-text"
            name="text"
            defaultValue={text ?? ""}
            placeholder="What has to happen next?"
            className="min-h-9 w-full rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted"
          />
        </div>
        <label className="sr-only" htmlFor="next-due">
          Due, Pakistan time
        </label>
        <input
          id="next-due"
          name="dueAt"
          type="datetime-local"
          defaultValue={dueAtLocal}
          className="min-h-9 shrink-0 rounded-sm border border-line-strong bg-raised px-2 text-[13px] text-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-9 shrink-0 rounded-sm border border-line-strong px-3 text-[12px] font-medium text-ink-2 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}

/* ------------------------------------------------------------------ stage */

export function StageForm({
  contractId,
  niche,
  stage,
  stages,
  canEdit,
}: {
  contractId: string;
  niche: string;
  stage: string;
  stages: readonly Stage[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setStage,
    null,
  );
  
  const ref = useRef<HTMLFormElement>(null);
  useRefreshOnSuccess(state, ref);

  const current = stages.find((s) => s.key === stage)?.label ?? stage;
  if (!canEdit) return <span className="text-[13px] text-ink">{current}</span>;

  return (
    <form ref={ref} action={action} className="inline-flex flex-col">
      <input type="hidden" name="contractId" value={contractId} />
      <input type="hidden" name="niche" value={niche} />
      <label className="sr-only" htmlFor="stage-select">
        Stage
      </label>
      <select
        id="stage-select"
        name="stage"
        defaultValue={stage}
        disabled={pending}
        onChange={() => ref.current?.requestSubmit()}
        className="min-h-8 rounded-sm border border-line-strong bg-raised px-2 text-[13px] text-ink disabled:opacity-50"
      >
        {stages.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <Result state={state} />
    </form>
  );
}

/* --------------------------------------------------------------- handover */

export function HandoverForm({
  contractId,
  currentOwnerId,
  people,
}: {
  contractId: string;
  currentOwnerId: string | null;
  people: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    handOver,
    null,
  );
  useRefreshOnSuccess(state);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
      >
        {currentOwnerId ? "Hand over" : "Assign an owner"}
      </button>
    );
  }

  return (
    <form action={action} className="mt-1 flex flex-col gap-2">
      <input type="hidden" name="contractId" value={contractId} />
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="handover-to">
          Hand over to
        </label>
        <select
          id="handover-to"
          name="toUserId"
          defaultValue=""
          className="min-h-9 rounded-sm border border-line-strong bg-raised px-2 text-[13px] text-ink"
        >
          <option value="" disabled>
            Who is taking it on?
          </option>
          {people
            .filter((p) => p.id !== currentOwnerId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        {currentOwnerId ? (
          <input
            name="reason"
            placeholder="Why is it moving?"
            className="min-h-9 min-w-0 flex-1 rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted"
          />
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="min-h-9 rounded-sm bg-ink px-3 text-[12px] font-medium text-page disabled:opacity-50"
        >
          {pending ? "Saving…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-9 px-2 text-[12px] text-muted"
        >
          Cancel
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

/* ------------------------------------------------------------------- note */

export function AddNote({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addNote,
    null,
  );
  
  const ref = useRef<HTMLFormElement>(null);
  useRefreshOnSuccess(state, ref);

  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="contractId" value={contractId} />
      <label className="sr-only" htmlFor="note-body">
        Internal note
      </label>
      <textarea
        id="note-body"
        name="body"
        rows={2}
        placeholder="Something the next person should know. Never shown to the client."
        className="w-full resize-y rounded-sm border border-line-strong bg-raised px-2.5 py-2 text-[13px] text-ink placeholder:text-muted"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-9 rounded-sm border border-line-strong px-3 text-[12px] font-medium text-ink-2 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save note"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------- snooze */

export function SnoozeAlert({
  alertId,
  label,
  snoozedUntilLabel,
  snoozeReason,
  snoozedByName,
}: {
  alertId: string;
  label: string;
  snoozedUntilLabel: string | null;
  snoozeReason: string | null;
  snoozedByName: string | null;
}) {
  const [snoozeState, snoozeAction, snoozing] = useActionState<
    ActionResult | null,
    FormData
  >(snoozeAlert, null);
  const [wakeState, wakeAction, waking] = useActionState<
    ActionResult | null,
    FormData
  >(unsnoozeAlert, null);
  useRefreshOnSuccess(snoozeState);
  useRefreshOnSuccess(wakeState);
  const [open, setOpen] = useState(false);

  if (snoozedUntilLabel) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[13px] text-ink-2">{label}</span>
        <span className="text-[12px] text-muted">
          snoozed until {snoozedUntilLabel}
          {snoozeReason ? ` — ${snoozeReason}` : ""}
          {snoozedByName ? ` (${snoozedByName})` : ""}
        </span>
        <form action={wakeAction}>
          <input type="hidden" name="alertId" value={alertId} />
          <button
            type="submit"
            disabled={waking}
            className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2 disabled:opacity-50"
          >
            {waking ? "…" : "Put it back"}
          </button>
        </form>
        <Result state={wakeState} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium text-late">{label}</span>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
          >
            Snooze
          </button>
        ) : null}
      </div>

      {open ? (
        <form action={snoozeAction} className="mt-1.5 flex flex-wrap gap-2">
          <input type="hidden" name="alertId" value={alertId} />
          <label className="sr-only" htmlFor={`snooze-reason-${alertId}`}>
            Why
          </label>
          <input
            id={`snooze-reason-${alertId}`}
            name="reason"
            placeholder="Why? e.g. client is away until Monday"
            className="min-h-9 min-w-0 flex-1 rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted"
          />
          <label className="sr-only" htmlFor={`snooze-for-${alertId}`}>
            For how long
          </label>
          <select
            id={`snooze-for-${alertId}`}
            name="duration"
            defaultValue="24h"
            className="min-h-9 rounded-sm border border-line-strong bg-raised px-2 text-[13px] text-ink"
          >
            {SNOOZE_DURATIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={snoozing}
            className="min-h-9 rounded-sm bg-ink px-3 text-[12px] font-medium text-page disabled:opacity-50"
          >
            {snoozing ? "…" : "Snooze"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-9 px-2 text-[12px] text-muted"
          >
            Cancel
          </button>
          <div className="basis-full">
            <Result state={snoozeState} />
          </div>
        </form>
      ) : null}
    </div>
  );
}
