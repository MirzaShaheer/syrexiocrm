"use client";

import { useActionState, useRef } from "react";
import { assignOwner, type ActionResult } from "@/lib/actions/contracts";

/**
 * Inline on the row, so an unowned contract can be given an owner without
 * leaving the board. Submits on change. A refusal is shown right here — the
 * first version failed silently, which is worse than failing loudly.
 */
export function AssignOwner({
  contractId,
  people,
}: {
  contractId: string;
  people: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    assignOwner,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="contractId" value={contractId} />
        <label className="sr-only" htmlFor={`assign-${contractId}`}>
          Assign an owner
        </label>
        <select
          id={`assign-${contractId}`}
          name="userId"
          defaultValue=""
          disabled={pending}
          onChange={(e) => {
            if (e.target.value) formRef.current?.requestSubmit();
          }}
          className="min-h-9 rounded-sm border border-line-strong bg-raised px-2 py-1 text-[12px] text-ink-2 disabled:opacity-50"
        >
          <option value="" disabled>
            {pending ? "Assigning…" : "Assign"}
          </option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </form>

      {state && !state.ok ? (
        <p role="alert" className="max-w-[240px] text-[11px] text-late sm:text-right">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
