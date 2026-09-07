"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/contracts";
import { addPastWork, deletePastWork } from "@/lib/actions/history";
import { HISTORY_OUTCOMES } from "@/lib/history";

const field =
  "min-h-9 w-full rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted";
const label =
  "block text-[11px] font-semibold tracking-[0.07em] text-muted uppercase";

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-[12px] ${state.ok ? "text-done" : "text-late"}`}
    >
      {state.message}
    </p>
  );
}

/**
 * The past-work form.
 *
 * Closed and collapsed by default, because on most visits History is something
 * you read rather than something you add to. Opening it is one click, and the
 * form stays open after a save so a batch of ten old jobs is ten short bursts
 * of typing rather than ten round trips through the page.
 */
export function AddPastWorkForm({
  accounts,
  clients,
  people,
  thisMonth,
}: {
  accounts: { id: string; label: string }[];
  clients: { id: string; name: string }[];
  people: { id: string; name: string }[];
  /** "2025-03" in Pakistan time, as the latest month worth defaulting to. */
  thisMonth: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addPastWork,
    null,
  );
  const [open, setOpen] = useState(false);
  const [newClient, setNewClient] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  /*
    Once a save lands: pull the new row onto the ledger below, then clear the
    fields that change every time while keeping the account and the month,
    because a batch of old jobs is usually the same account month after month.

    The refresh happens here rather than as a revalidatePath("/history") inside
    the action, because revalidating the route a form is rendered on leaves the
    action response hanging and the button stuck on "Saving…". Same reason the
    contract forms refresh from the client.
  */
  const router = useRouter();
  useEffect(() => {
    if (!state?.ok) return;
    router.refresh();
    const form = formRef.current;
    if (!form) return;
    for (const name of [
      "title",
      "value",
      "note",
      "newClientName",
      "newClientCountry",
    ]) {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = "";
      }
    }
  }, [state, router]);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-primary min-h-9 px-4 text-[12px] font-medium"
        >
          Add past client
        </button>
        <p className="text-[12px] text-muted">
          A job that closed before the CRM existed — client, month, value.
        </p>
        <Result state={state} />
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-ink">Add past client</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
        >
          Close
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="h-account">
            Upwork account
          </label>
          <select id="h-account" name="accountId" className={`${field} mt-1`}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="h-month">
            Month it closed
          </label>
          <input
            id="h-month"
            name="wonMonth"
            type="month"
            max={thisMonth}
            defaultValue={thisMonth}
            className={`${field} mt-1`}
          />
        </div>
        <div>
          <label className={label} htmlFor="h-outcome">
            How it ended
          </label>
          <select
            id="h-outcome"
            name="outcome"
            defaultValue="completed"
            className={`${field} mt-1`}
          >
            {HISTORY_OUTCOMES.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className={label}>Client</span>
          <button
            type="button"
            onClick={() => setNewClient((v) => !v)}
            className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
          >
            {newClient ? "Pick one we already have" : "Not in the list yet"}
          </button>
        </div>

        {newClient ? (
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <input name="newClientName" placeholder="Client name" className={field} />
            <input name="newClientCountry" placeholder="Country" className={field} />
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

      <div>
        <label className={label} htmlFor="h-title">
          What was the work?
        </label>
        <input
          id="h-title"
          name="title"
          placeholder="e.g. Shopify store build, 40-page ebook layout"
          className={`${field} mt-1`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="h-type">
            Type
          </label>
          <select id="h-type" name="type" defaultValue="fixed" className={`${field} mt-1`}>
            <option value="fixed">Fixed price</option>
            <option value="hourly">Hourly</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="h-value">
            What it was worth
          </label>
          <input
            id="h-value"
            name="value"
            inputMode="decimal"
            placeholder="1500"
            className={`${field} mt-1`}
          />
          <p className="mt-1 text-[11px] text-muted">
            Roughly is fine. Leave blank if nobody remembers.
          </p>
        </div>
        <div>
          <label className={label} htmlFor="h-landed">
            Who landed it
          </label>
          <select
            id="h-landed"
            name="landedByUserId"
            defaultValue=""
            className={`${field} mt-1`}
          >
            <option value="">Not recorded</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="h-note">
          Anything worth remembering
        </label>
        <textarea
          id="h-note"
          name="note"
          rows={2}
          placeholder="Optional — how they found us, why they left, whether to chase them again"
          className={`${field} mt-1 min-h-16 py-2`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary min-h-9 px-4 text-[12px] font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save and add another"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/**
 * Removing an entry. Two presses, because this is the one destructive control
 * in the product and a stray click should not quietly rewrite a revenue total.
 */
export function DeletePastEntry({
  contractId,
  what,
}: {
  contractId: string;
  what: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    deletePastWork,
    null,
  );
  const [armed, setArmed] = useState(false);

  // Same reason as the form above: the page this control sits on is refreshed
  // from here, never by a revalidatePath inside the action.
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  if (state && !state.ok) {
    return <span className="text-[11px] text-late">{state.message}</span>;
  }

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label={`Remove ${what}`}
        className="text-[11px] text-muted hover:text-late"
      >
        Remove
      </button>
    );
  }

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="contractId" value={contractId} />
      <button
        type="submit"
        disabled={pending}
        className="text-[11px] font-medium text-late disabled:opacity-50"
      >
        {pending ? "Removing…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-[11px] text-muted"
      >
        Keep
      </button>
    </form>
  );
}
