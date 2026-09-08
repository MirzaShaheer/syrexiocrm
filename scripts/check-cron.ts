/**
 * Runs the cron route in process, twice, against the real database.
 *
 * The second run is the point. Everything the cron does has to be safe to
 * repeat — it fires every fifteen minutes — so the interesting number is what
 * the second run does *not* do: no alert notified twice, no nudge inside its
 * four hours, no digest sent again inside its window.
 *
 * Run with: npx tsx --conditions=react-server scripts/check-cron.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { POST } from "../src/app/api/cron/alerts/route";
import { runScheduled } from "../src/lib/bot/schedule";

process.env.CRON_SECRET ??= "local-check-secret";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}\n          expected ${expected}\n          actual   ${actual}`);
  }
}

async function run(query = ""): Promise<Record<string, number | boolean>> {
  const res = await POST(
    new Request(`http://localhost/api/cron/alerts${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }),
  );
  return (await res.json()) as Record<string, number | boolean>;
}

async function main() {
  console.log("\nauthorisation");
  const denied = await POST(
    new Request("http://localhost/api/cron/alerts", { method: "POST" }),
  );
  check("no secret is refused", denied.status, 403);

  const wrong = await POST(
    new Request("http://localhost/api/cron/alerts", {
      method: "POST",
      headers: { authorization: "Bearer definitely-not-the-secret" },
    }),
  );
  check("the wrong secret is refused", wrong.status, 403);

  console.log("\nfirst run");
  const first = await run();
  check("it completes", first.ok, true);
  console.log(`          ${JSON.stringify(first)}`);

  console.log("\nsecond run, immediately after");
  const second = await run();
  check("it completes", second.ok, true);
  check("no alert is notified twice", second.notified, 0);
  check("no nudge fires inside its four hours", second.nudged, 0);
  check("no brief is repeated", second.briefs, 0);
  check("no bid prompt is repeated", second.bidPrompts, 0);
  console.log(`          ${JSON.stringify(second)}`);

  console.log("\nnudge eligibility");
  // Age one open alert past the four-hour mark and confirm it comes back round.
  const { rows: aged } = await db.execute<{ id: string }>(sql`
    update alerts
    set notified_at = now() - interval '5 hours',
        last_nudged_at = null
    where id = (
      select id from alerts
      where resolved_at is null and notified_at is not null
      limit 1
    )
    returning id
  `);

  if (aged.length) {
    const third = await run();
    check("an alert aged past four hours is re-sent", Number(third.nudged) > 0, true);

    const fourth = await run();
    check("and not again on the very next run", fourth.nudged, 0);

    const { rows: counted } = await db.execute<{ n: string }>(
      sql`select nudge_count as n from alerts where id = ${aged[0].id}`,
    );
    check("the nudge is counted", Number(counted[0].n) >= 1, true);
  } else {
    console.log("  skip  no open notified alert to age");
  }

  /* ------------------------------------------------------ the timed jobs */

  console.log("\nthe timed jobs");

  // Nothing scheduled reaches anybody unless somebody is linked, so borrow a
  // user for the duration and hand them back afterwards.
  const [someone] = await db.execute<{ id: string; chat: string | null }>(
    sql`select id, telegram_chat_id as chat from users where active = true limit 1`,
  ).then((r) => r.rows);

  if (someone) {
    await db.execute(
      sql`update users set telegram_chat_id = '999000222' where id = ${someone.id}`,
    );
    await db.execute(
      sql`delete from notifications where template in ('brief_shift_start', 'bids_prompt')
          and created_at > now() - interval '6 hours'`,
    );

    try {
      // 2026-09-14 is a Monday. 6pm PKT is the top of the week's first shift.
      const monday6pm = new Date("2026-09-14T18:30:00+05:00");
      const first = await runScheduled(monday6pm);
      check("the shift brief goes out at 6pm", first.briefs >= 1, true);

      const repeat = await runScheduled(monday6pm);
      check("and not twice in the same window", repeat.briefs, 0);

      const saturday = await runScheduled(new Date("2026-09-12T18:30:00+05:00"));
      check("no brief on a Saturday evening", saturday.briefs, 0);

      const midday = await runScheduled(new Date("2026-09-14T12:30:00+05:00"));
      check("no brief in the middle of the day", midday.briefs, 0);
    } finally {
      await db.execute(
        sql`update users set telegram_chat_id = ${someone.chat} where id = ${someone.id}`,
      );
      await db.execute(sql`delete from notifications where chat_id = '999000222'`);
    }
  } else {
    console.log("  skip  no active user to send a brief to");
  }

  console.log(failures ? `\n${failures} failed\n` : "\nall good\n");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
