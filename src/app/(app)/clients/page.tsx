import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getClientList } from "@/lib/queries/client";
import { NICHE_LABELS, type Niche } from "@/lib/pipelines";
import { money, plural } from "@/lib/format";
import { AccountBadge } from "@/components/ui";
import { PageHead, Panel } from "@/components/shell";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireUser();
  const { q } = await searchParams;
  const clients = await getClientList(q?.trim() || undefined);

  const repeat = clients.filter((c) => c.totalContracts > 1).length;

  return (
    <>
      <PageHead
        title="Clients"
        note="Everyone the agency has ever worked with, across all four accounts. Repeat business is invisible anywhere else, because the same client can appear under more than one account."
      />

      <Panel className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        <Figure n={clients.length} label={plural(clients.length, "client")} />
        <Figure n={repeat} label="came back" />
        <Figure
          n={clients.filter((c) => c.activeContracts > 0).length}
          label="working with us now"
        />
      </Panel>

      {/* Filters survive a refresh because they live in the URL. */}
      <Panel className="mt-4">
        <form method="get" className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="client-q">
            Search clients
          </label>
          <input
            id="client-q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Client name or country"
            className="min-h-9 w-full max-w-xs rounded-sm border border-line-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted"
          />
          <button type="submit" className="btn min-h-9 px-3 text-[12px] font-medium">
            Search
          </button>
          {q ? (
            <Link
              href="/clients"
              className="self-center text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </Panel>

      {clients.length === 0 ? (
        <Panel className="mt-4">
          <p className="text-[13px] text-ink-2">
            {q ? `No client matches "${q}".` : "No clients yet."}
          </p>
          <p className="mt-1 text-[12px] text-muted">
            {q
              ? "Try part of the name, or the country."
              : "A client appears here the first time a contract is entered for them — including past work added from the History page."}
          </p>
        </Panel>
      ) : (
        <Panel className="mt-4">
          <ul>
            {clients.map((c) => (
            <li key={c.id} className="border-t border-line first:border-t-0">
              <div className="rowlink flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/clients/${c.id}`}
                    className="text-[13.5px] font-medium text-ink hover:underline"
                  >
                    {c.name}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted">
                    {c.country ?? "Country unknown"}
                    {c.niches.length ? (
                      <span>
                        · {c.niches.map((n) => NICHE_LABELS[n as Niche] ?? n).join(", ")}
                      </span>
                    ) : null}
                    <span>·</span>
                    {c.accounts.map((a) => (
                      <AccountBadge key={a} label={a} />
                    ))}
                  </p>
                </div>

                <div className="flex items-baseline gap-4">
                  <span className="text-[12px] text-muted">
                    {c.activeContracts > 0 ? (
                      <span className="font-medium text-ink-2">
                        {c.activeContracts} active
                      </span>
                    ) : (
                      "ended"
                    )}
                    {c.totalContracts > 1 ? ` of ${c.totalContracts}` : ""}
                  </span>
                  <span className="fig w-[76px] shrink-0 text-right text-[13px] text-ink-2">
                    {money(c.totalApproved)}
                  </span>
                </div>
              </div>
            </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Figure({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="num text-[24px] leading-none font-semibold text-ink">{n}</div>
      <div className="mt-1.5 text-[12px] text-muted">{label}</div>
    </div>
  );
}
