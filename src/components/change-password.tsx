"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { changePassword } from "@/lib/actions/account";
import type { ActionResult } from "@/lib/actions/contracts";

const field =
  "min-h-9 w-full max-w-sm rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted";
const label =
  "block text-[11px] font-semibold tracking-[0.07em] text-muted uppercase";

/**
 * Closed until asked for. Changing a password is a rare, deliberate act, and
 * three password boxes sitting open on a settings page every day is three
 * boxes a browser will offer to autofill into.
 */
export function ChangePassword() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    changePassword,
    null,
  );
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Empty the boxes once it lands, so a changed password is not left sitting
  // in three form fields behind whoever walks past next.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn min-h-9 px-3 text-[12px] font-medium"
        >
          Change password
        </button>
        {state?.ok ? (
          <p role="status" className="text-[12px] text-done">
            {state.message}
          </p>
        ) : (
          <p className="text-[12px] text-muted">
            Yours alone. Nobody else can see it or set it for you.
          </p>
        )}
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-ink">Change password</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
        >
          Cancel
        </button>
      </div>

      <div>
        <label className={label} htmlFor="cp-current">
          Current password
        </label>
        <input
          id="cp-current"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className={`${field} mt-1`}
        />
      </div>

      <div>
        <label className={label} htmlFor="cp-new">
          New password
        </label>
        <input
          id="cp-new"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className={`${field} mt-1`}
        />
        <p className="mt-1 text-[11px] text-muted">
          Twelve characters or more. A long ordinary phrase beats a short
          clever one.
        </p>
      </div>

      <div>
        <label className={label} htmlFor="cp-confirm">
          New password again
        </label>
        <input
          id="cp-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className={`${field} mt-1`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary min-h-9 px-4 text-[12px] font-medium disabled:opacity-50"
        >
          {pending ? "Changing…" : "Change password"}
        </button>
        {state ? (
          <p
            role={state.ok ? "status" : "alert"}
            className={`text-[12px] ${state.ok ? "text-done" : "text-late"}`}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
