import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SearchHit = {
  kind: "contract" | "client" | "account";
  id: string;
  title: string;
  subtitle: string;
  account: string | null;
  href: string;
};

/**
 * One box that finds a contract by title, a client by name, or an account by
 * label. Deliberately a route rather than a server action so the dialog can
 * query as you type without a full round of React state.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ hits: [] }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const like = `%${q.toLowerCase()}%`;

  const { rows } = await db.execute<{
    kind: SearchHit["kind"];
    id: string;
    title: string;
    subtitle: string;
    account: string | null;
    rank: number;
  }>(sql`
    (
      select 'contract' as kind, c.id, c.title,
             cl.name as subtitle, a.label as account,
             case when lower(c.title) like ${q.toLowerCase() + "%"} then 0 else 1 end as rank
      from contracts c
      join clients cl on cl.id = c.client_id
      join accounts a on a.id = c.account_id
      where lower(c.title) like ${like} or lower(cl.name) like ${like}
      order by c.status = 'active' desc, rank, c.updated_at desc
      limit 8
    )
    union all
    (
      select 'client' as kind, cl.id, cl.name as title,
             coalesce(cl.country, 'Client') as subtitle, null as account,
             case when lower(cl.name) like ${q.toLowerCase() + "%"} then 0 else 1 end as rank
      from clients cl
      where lower(cl.name) like ${like}
      order by rank, cl.name
      limit 5
    )
    union all
    (
      select 'account' as kind, a.id, a.label as title,
             a.niche::text as subtitle, a.label as account, 0 as rank
      from accounts a
      where lower(a.label) like ${like} and a.active = true
      limit 4
    )
  `);

  const hits: SearchHit[] = rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    title: r.title,
    subtitle:
      r.kind === "account" ? r.subtitle.replace(/_/g, " ") : r.subtitle,
    account: r.account,
    href:
      r.kind === "contract"
        ? `/contracts/${r.id}`
        : r.kind === "client"
          ? `/clients/${r.id}`
          : `/accounts/${r.id}`,
  }));

  return NextResponse.json({ hits });
}
