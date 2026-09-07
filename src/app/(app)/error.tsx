"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Never shows the raw exception. The digest is enough to find it in the server
 * log, and the person gets something they can actually do.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The full error is already in the server log; this is the browser copy.
    console.error("[app error]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="panel max-w-lg">
      <h1 className="text-[17px] font-semibold text-ink">
        That did not load
      </h1>
      <p className="mt-1 text-muted">
        Something went wrong fetching this screen. Nothing you did caused it and
        nothing has been lost.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="min-h-9 rounded-sm bg-ink px-3 text-[12px] font-medium text-page"
        >
          Try again
        </button>
        <Link
          href="/"
          className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
        >
          Back to all accounts
        </Link>
      </div>
      {error.digest ? (
        <p className="num mt-4 text-[11px] text-muted">
          Reference {error.digest} — quote this if you report it.
        </p>
      ) : null}
    </div>
  );
}
