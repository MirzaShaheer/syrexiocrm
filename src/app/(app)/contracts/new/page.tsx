import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAssignableUsers } from "@/lib/queries/today";
import { NewContractForm } from "@/components/create-forms";
import { PageHead, Panel } from "@/components/shell";

export const metadata = { title: "New contract" };
export const dynamic = "force-dynamic";

/** yyyy-MM-dd in Pakistan time. */
function pktToday(): string {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function NewContractPage() {
  await requireUser();

  const [accountRows, clientRows, people] = await Promise.all([
    db
      .select({ id: accounts.id, label: accounts.label, niche: accounts.niche })
      .from(accounts)
      .where(eq(accounts.active, true))
      .orderBy(asc(accounts.label)),
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .orderBy(asc(clients.name)),
    getAssignableUsers(),
  ]);

  return (
    <>
      <PageHead
        title="New contract"
        note="A live job, entered by hand. For work that has already closed, use History instead."
        action={
          <Link
            href="/today"
            className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
          >
            Cancel
          </Link>
        }
      />

      <Panel className="mt-4 max-w-3xl">
        <NewContractForm
          accounts={accountRows}
          clients={clientRows}
          people={people}
          today={pktToday()}
        />
      </Panel>
    </>
  );
}
