"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/contracts";
import { saveBidCounts } from "@/lib/actions/create";

/**
 * The only manual number in the week view. Upwork exposes no proposal or
 * Connects data through any API, so this is typed — four boxes, once a week.
 */
export function BidEntry({
  weekStartIso,
  accounts,
}: {
  weekStartIso: string;
  accounts: { id: string; label: string; bids: number | null }[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveBidCounts,
    null,
  );
  const router = useRouter();

  /*
   * The action deliberately does not revalidate /week — doing that from inside
   * an action rendered on the same route never returns. Refreshing here gets
   * the same fresh figures, after the result has already landed.
   */
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="weekStart" value={weekStartIso} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {accounts.map((a) => (
          <div key={a.id}>
            <label
              className="block text-[11px] font-semibold tracking-[0.07em] text-muted uppercase"
              htmlFor={`bids-${a.id}`}
            >
              {a.label}
            </label>
            <input
              id={`bids-${a.id}`}
              name={`bids:${a.id}`}
              inputMode="numeric"
              defaultValue={a.bids ?? ""}
              placeholder="—"
              className="num mt-1 min-h-9 w-full rounded-sm border border-line-strong bg-raised px-2.5 text-[14px] text-ink placeholder:text-muted"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-9 rounded-sm border border-line-strong px-3 text-[12px] font-medium text-ink-2 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save bid counts"}
        </button>
        {state ? (
          <span
            role={state.ok ? "status" : "alert"}
            className={`text-[12px] ${state.ok ? "text-muted" : "text-late"}`}
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
