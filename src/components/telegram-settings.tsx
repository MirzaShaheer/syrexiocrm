"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions/contracts";
import {
  generateLinkCode,
  sendTestMessage,
  unlinkTelegram,
} from "@/lib/actions/telegram";

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <span
      role={state.ok ? "status" : "alert"}
      className={`text-[12px] ${state.ok ? "text-muted" : "text-late"}`}
    >
      {state.message}
    </span>
  );
}

const btn =
  "min-h-9 rounded-sm border border-line-strong px-3 text-[12px] font-medium text-ink-2 disabled:opacity-50";

/** Your own code, the instructions, and a way to prove it works. */
export function MyTelegramLink({
  code,
  expiresLabel,
  botName,
  linked,
}: {
  code: string | null;
  expiresLabel: string | null;
  botName: string | null;
  linked: boolean;
}) {
  const [genState, genAction, generating] = useActionState<
    ActionResult | null,
    FormData
  >(generateLinkCode, null);
  const [testState, testAction, testing] = useActionState<
    ActionResult | null,
    FormData
  >(sendTestMessage, null);
  const [unlinkState, unlinkAction, unlinking] = useActionState<
    ActionResult | null,
    FormData
  >(unlinkTelegram, null);

  if (linked) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-ink">
          Your Telegram is linked. You will get a message when one of your
          contracts needs you.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <form action={testAction}>
            <button type="submit" disabled={testing} className={btn}>
              {testing ? "Sending…" : "Send a test message"}
            </button>
          </form>
          <form action={unlinkAction}>
            <button type="submit" disabled={unlinking} className={btn}>
              {unlinking ? "Unlinking…" : "Unlink"}
            </button>
          </form>
          <Result state={testState ?? unlinkState} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex list-decimal flex-col gap-1 pl-4 text-[13px] text-ink-2">
        <li>
          Open{" "}
          {botName ? (
            <span className="num text-ink">@{botName}</span>
          ) : (
            "the agency bot"
          )}{" "}
          in Telegram.
        </li>
        <li>
          Send it{" "}
          <span className="num text-ink">
            /start {code ?? "YOUR-CODE"}
          </span>
        </li>
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        {code ? (
          <span className="num rounded-sm border border-line-strong bg-surface px-3 py-2 text-[16px] font-semibold tracking-[0.08em] text-ink">
            {code}
          </span>
        ) : (
          <span className="text-[13px] text-muted">No code yet.</span>
        )}
        <form action={genAction}>
          <button type="submit" disabled={generating} className={btn}>
            {generating ? "Generating…" : code ? "Generate a new code" : "Generate a code"}
          </button>
        </form>
      </div>

      <p className="text-[12px] text-muted">
        {expiresLabel
          ? `This code works once and expires at ${expiresLabel} PKT.`
          : "Codes work once and last fifteen minutes."}
      </p>
      <Result state={genState} />
    </div>
  );
}

/** Owner-only control for somebody else's link. */
export function UnlinkPerson({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    unlinkTelegram,
    null,
  );

  return (
    <span className="inline-flex items-center gap-2">
      <form action={action}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={pending}
          aria-label={`Unlink ${name}`}
          className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2 disabled:opacity-50"
        >
          {pending ? "…" : "Unlink"}
        </button>
      </form>
      {state && !state.ok ? (
        <span className="text-[11px] text-late">{state.message}</span>
      ) : null}
    </span>
  );
}
