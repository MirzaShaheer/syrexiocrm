import Link from "next/link";

/**
 * Catches any URL that matches no route at all. The one inside the (app)
 * group only handles notFound() from a real page, so without this a mistyped
 * address still lands on the framework's bare page — a different typeface, no
 * navigation, no way back.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <p className="num text-[12px] tracking-[0.08em] text-muted uppercase">
        404
      </p>
      <h1 className="mt-2 text-[19px] font-semibold text-ink">
        There is nothing at that address
      </h1>
      <p className="mt-1 text-muted">
        The link may be old, or a contract or client may have been removed.
      </p>
      <div className="mt-4 flex flex-wrap gap-4">
        <Link
          href="/"
          className="text-[13px] text-ink-2 underline decoration-line-strong underline-offset-2"
        >
          All accounts
        </Link>
        <Link
          href="/today"
          className="text-[13px] text-ink-2 underline decoration-line-strong underline-offset-2"
        >
          Today
        </Link>
      </div>
      <p className="mt-6 text-[12px] text-muted">
        Press Ctrl K anywhere in the app to search for a contract or client.
      </p>
    </main>
  );
}
