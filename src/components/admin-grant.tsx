"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions/contracts";
import { grantAdmin, revokeAdmin } from "@/lib/actions/people";
import { GRANT_DURATIONS } from "@/lib/permissions";

/** Owner-only. Time-boxed by design: nothing to remember to take back. */
export function AdminGrant({
  userId,
  name,
  activeUntilLabel,
}: {
  userId: string;
  name: string;
  activeUntilLabel: string | null;
}) {
  const [grantState, grant, granting] = useActionState<
    ActionResult | null,
    FormData
  >(grantAdmin, null);
  const [revokeState, revoke, revoking] = useActionState<
    ActionResult | null,
    FormData
  >(revokeAdmin, null);
  const [open, setOpen] = useState(false);

  const state = grantState ?? revokeState;

  if (activeUntilLabel) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-2">
        <span className="text-[12px] text-ink-2">
          edit access until {activeUntilLabel}
        </span>
        <form action={revoke}>
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            disabled={revoking}
            className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2 disabled:opacity-50"
          >
            {revoking ? "…" : "Revoke"}
          </button>
        </form>
        {state && !state.ok ? (
          <span className="text-[11px] text-late">{state.message}</span>
        ) : null}
      </span>
    );
  }

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
        >
          Give edit access
        </button>
        {state ? (
          <span
            className={`text-[11px] ${state.ok ? "text-muted" : "text-late"}`}
          >
            {state.message}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <form action={grant} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <label className="sr-only" htmlFor={`grant-${userId}`}>
        How long should {name} have edit access
      </label>
      <select
        id={`grant-${userId}`}
        name="duration"
        defaultValue="7d"
        className="min-h-8 rounded-sm border border-line-strong bg-raised px-2 text-[12px] text-ink"
      >
        {GRANT_DURATIONS.map((d) => (
          <option key={d.key} value={d.key}>
            {d.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={granting}
        className="min-h-8 rounded-sm bg-ink px-2.5 text-[12px] font-medium text-page disabled:opacity-50"
      >
        {granting ? "…" : "Grant"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[12px] text-muted"
      >
        Cancel
      </button>
      {state && !state.ok ? (
        <span className="text-[11px] text-late">{state.message}</span>
      ) : null}
    </form>
  );
}
