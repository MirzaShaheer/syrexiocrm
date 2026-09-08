"use client";

import { useActionState, useState } from "react";
import { useRefreshOnSuccess } from "@/components/use-refresh-on-success";
import { useRouter, useSearchParams } from "next/navigation";
import type { ActionResult } from "@/lib/actions/contracts";
import { bulkAssign, markReplied } from "@/lib/actions/create";

/**
 * One click, on the row you are already looking at. The "client waiting" rule
 * is the only one that depends on somebody remembering to log something, so
 * clearing it has to be cheaper than ignoring it.
 */
export function RepliedButton({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    markReplied,
    null,
  );
  useRefreshOnSuccess(state);

  if (state?.ok) {
    return <span className="text-[11.5px] text-done">Logged</span>;
  }

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="contractId" value={contractId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-7 rounded-sm border border-line-strong px-2 text-[11.5px] text-ink-2 hover:bg-surface disabled:opacity-50"
      >
        {pending ? "…" : "Replied"}
      </button>
      {state && !state.ok ? (
        <span className="text-[11px] text-late">{state.message}</span>
      ) : null}
    </form>
  );
}

/* ------------------------------------------------------------ bulk assign */

export function BulkAssign({
  contracts,
  people,
}: {
  contracts: { id: string; title: string; account: string }[];
  people: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    bulkAssign,
    null,
  );
  useRefreshOnSuccess(state);
  const [selected, setSelected] = useState<string[]>([]);

  const allSelected = selected.length === contracts.length && contracts.length > 0;

  return (
    <form action={action} className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelected(allSelected ? [] : contracts.map((c) => c.id))}
          className="min-h-8 rounded-sm border border-line-strong px-2 text-[12px] text-ink-2 hover:bg-surface"
        >
          {allSelected ? "Clear all" : `Select all ${contracts.length}`}
        </button>

        <label className="sr-only" htmlFor="bulk-user">
          Assign the selected contracts to
        </label>
        <select
          id="bulk-user"
          name="userId"
          defaultValue=""
          className="min-h-8 rounded-sm border border-line-strong bg-raised px-2 text-[12px] text-ink"
        >
          <option value="">Assign selected to…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={pending || selected.length === 0}
          className="min-h-8 rounded-sm bg-ink px-3 text-[12px] font-medium text-page disabled:opacity-40"
        >
          {pending ? "Assigning…" : `Assign ${selected.length || ""}`.trim()}
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

      <ul className="flex flex-col gap-1">
        {contracts.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              <input
                type="checkbox"
                name="contractId"
                value={c.id}
                checked={selected.includes(c.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id),
                  )
                }
                className="size-3.5 accent-current"
              />
              <span className="text-muted">{c.account}</span>
              <span className="truncate">{c.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </form>
  );
}

/* ---------------------------------------------------------------- filters */

export type FilterOption = { value: string; label: string };

/**
 * Filters live in the URL, so a refresh keeps them and a filtered board can
 * be pasted to somebody else.
 */
export function Filters({
  accounts,
  people,
  stages,
  current,
}: {
  accounts: FilterOption[];
  people: FilterOption[];
  stages: FilterOption[];
  current: { account: string; person: string; stage: string; alert: string };
}) {
  const router = useRouter();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  const active =
    current.account || current.person || current.stage || current.alert;

  const cls =
    "min-h-8 rounded-sm border border-line bg-raised px-2 text-[12px] text-ink-2";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        label="Account"
        value={current.account}
        onChange={(v) => set("account", v)}
        options={accounts}
        placeholder="All accounts"
        className={cls}
      />
      <Select
        label="Owner"
        value={current.person}
        onChange={(v) => set("person", v)}
        options={people}
        placeholder="Anyone"
        className={cls}
      />
      <Select
        label="Stage"
        value={current.stage}
        onChange={(v) => set("stage", v)}
        options={stages}
        placeholder="Any stage"
        className={cls}
      />
      <Select
        label="Alert state"
        value={current.alert}
        onChange={(v) => set("alert", v)}
        options={[
          { value: "open", label: "In an alert state" },
          { value: "snoozed", label: "Snoozed" },
          { value: "clear", label: "No alerts" },
        ]}
        placeholder="Any state"
        className={cls}
      />
      {active ? (
        <button
          type="button"
          onClick={() => router.push("?", { scroll: false })}
          className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  placeholder: string;
  className: string;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={`filter-${label}`}>
        {label}
      </label>
      <select
        id={`filter-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}
