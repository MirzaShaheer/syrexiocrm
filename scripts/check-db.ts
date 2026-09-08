/**
 * Says plainly whether a database has the schema this code expects.
 *
 * `drizzle-kit migrate` writes its result over the spinner line, and any
 * warning printed at the wrong moment — the pg SSL deprecation notice, for
 * one — swallows it. That leaves you unable to tell a successful run from a
 * failed one by reading the output, which is a bad position to be in when the
 * database is production.
 *
 * This connects, looks, and reports. It writes nothing.
 *
 *   $env:DATABASE_URL = '<url>'
 *   npx tsx scripts/check-db.ts
 *   Remove-Item Env:\DATABASE_URL
 */
import "dotenv/config";
import { Client } from "pg";

/** Tables and columns each migration was supposed to add. */
const EXPECTED: { migration: string; tables: string[]; columns: [string, string][] }[] = [
  {
    migration: "0007_funnel_counts",
    tables: [],
    columns: [
      ["bid_weeks", "chats_opened"],
      ["bid_weeks", "contracted"],
      ["bid_weeks", "closed"],
      ["bid_weeks", "withdrawn"],
    ],
  },
  {
    migration: "0008_bot_two_way",
    tables: ["bot_prompts", "bot_cursors"],
    columns: [
      ["alerts", "last_nudged_at"],
      ["alerts", "nudge_count"],
      ["notifications", "keyboard"],
      ["notifications", "message_id"],
    ],
  },
  {
    migration: "0009_bid_week_trash",
    tables: ["bid_week_trash"],
    columns: [],
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  // The host, never the credentials — so you can see at a glance whether you
  // are looking at production or the portable server on 127.0.0.1.
  let host = "unknown";
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep going; the connection will fail informatively enough */
  }
  console.log(`\nconnected to: ${host}\n`);

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const { rows: tableRows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = new Set(tableRows.map((r) => r.table_name));

    const { rows: columnRows } = await client.query<{
      table_name: string;
      column_name: string;
    }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public'`,
    );
    const columns = new Set(
      columnRows.map((r) => `${r.table_name}.${r.column_name}`),
    );

    let missing = 0;

    for (const group of EXPECTED) {
      const gaps: string[] = [];
      for (const t of group.tables) if (!tables.has(t)) gaps.push(`table ${t}`);
      for (const [t, c] of group.columns) {
        if (!columns.has(`${t}.${c}`)) gaps.push(`${t}.${c}`);
      }

      if (gaps.length) {
        missing += gaps.length;
        console.log(`  MISSING  ${group.migration}`);
        for (const g of gaps) console.log(`             ${g}`);
      } else {
        console.log(`  applied  ${group.migration}`);
      }
    }

    // Drizzle's own ledger, as a cross-check on the inspection above.
    try {
      const { rows } = await client.query<{ n: string }>(
        `select count(*) as n from drizzle.__drizzle_migrations`,
      );
      console.log(`\ndrizzle has recorded ${rows[0].n} migrations`);
    } catch {
      console.log("\nno drizzle.__drizzle_migrations table — nothing has been migrated here");
    }

    console.log(
      missing
        ? `\n${missing} thing(s) missing — run: npm run db:migrate\n`
        : "\nschema is up to date\n",
    );
    process.exitCode = missing ? 1 : 0;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}\n`);
  process.exit(1);
});
