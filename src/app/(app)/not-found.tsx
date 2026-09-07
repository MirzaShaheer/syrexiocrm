import Link from "next/link";

/**
 * The account route can 404 on a bad id. Without this it would fall through to
 * the framework's default page, which has no navigation — the same dead end
 * the audit flagged. A full set of error and loading states comes in phase 4.
 */
export default function NotFound() {
  return (
    <div className="panel max-w-md">
      <h1 className="text-[17px] font-semibold text-ink">
        That page does not exist
      </h1>
      <p className="mt-1 text-muted">
        The link may be stale, or the account may have been deactivated.
      </p>
      <Link
        href="/"
        className="mt-3 inline-block text-ink-2 underline decoration-line-strong underline-offset-2"
      >
        Back to all accounts
      </Link>
    </div>
  );
}
