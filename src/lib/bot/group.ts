import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { botCursors } from "@/db/schema";
import { sendToGroup } from "@/lib/notifications";
import { contractLink } from "@/lib/notifications/templates";
import { groupChatId } from "./identity";

/**
 * The team group feed.
 *
 * Some things are nobody's private business: a contract started, an owner
 * changed, a job reaching its last stage. Before this they were visible only
 * to whoever opened the app, so the answer to "what happened last night" was
 * to ask somebody. Now the group is told as it happens.
 *
 * Driven off the events table rather than hooked into the writes, which keeps
 * every op free of any knowledge that a group chat exists — and means an
 * event written by the web, the bot or the cron is announced identically.
 */

const CURSOR_KEY = "group_events";

/** Only the ones worth interrupting six people for. */
const ANNOUNCED = [
  "contract_created",
  "owner_assigned",
  "owner_handover",
  "stage_changed",
];

type EventRow = {
  id: string;
  type: string;
  contract_id: string;
  contract_title: string;
  client_name: string;
  account_label: string;
  payload: Record<string, unknown>;
};

async function readCursor(): Promise<string | null> {
  const [row] = await db
    .select({ value: botCursors.value })
    .from(botCursors)
    .where(sql`${botCursors.key} = ${CURSOR_KEY}`)
    .limit(1);
  return row?.value ?? null;
}

async function writeCursor(value: string): Promise<void> {
  await db
    .insert(botCursors)
    .values({ key: CURSOR_KEY, value })
    .onConflictDoUpdate({
      target: botCursors.key,
      set: { value, updatedAt: new Date() },
    });
}

function line(e: EventRow): string | null {
  const where = `${e.account_label} · ${e.client_name}`;
  const by = typeof e.payload.byName === "string" ? e.payload.byName : null;

  switch (e.type) {
    case "contract_created":
      return [`New contract: ${e.contract_title}`, where].join("\n");

    case "owner_assigned":
      return [
        `${e.payload.toName ?? "Somebody"} took on ${e.contract_title}`,
        where,
      ].join("\n");

    case "owner_handover":
      return [
        `${e.contract_title} moved to ${e.payload.toName ?? "somebody else"}${
          by ? `, by ${by}` : ""
        }`,
        where,
        ...(e.payload.reason ? [`Reason: ${e.payload.reason}`] : []),
      ].join("\n");

    case "stage_changed":
      return [
        `${e.contract_title} → ${e.payload.toLabel ?? e.payload.to}`,
        where,
      ].join("\n");

    default:
      return null;
  }
}

/**
 * Posts anything that happened since the last run.
 *
 * The very first run only moves the cursor to the newest event. Otherwise
 * turning the group on would replay the entire history of the CRM into it,
 * which is the sort of thing that gets a bot muted on day one.
 */
export async function announceToGroup(): Promise<{ posted: number }> {
  if (!groupChatId()) return { posted: 0 };

  const cursor = await readCursor();

  /*
   * The cursor is "<when>|<id>", and the comparison is on the pair.
   *
   * Ordering on the id alone would be wrong in a way that is easy to miss:
   * event ids are random uuids, not sequential, so "id greater than the last
   * one" selects an arbitrary half of history. The timestamp orders correctly
   * but is not unique — two events written in the same statement share it — so
   * the id breaks the tie and stops a run losing or repeating one of a pair.
   */
  if (!cursor) {
    // First ever run: start from now rather than replaying the whole history
    // into a group that has never seen any of it.
    const { rows } = await db.execute<{ occurred_at: string; id: string }>(
      sql`select occurred_at, id from events order by occurred_at desc, id desc limit 1`,
    );
    if (rows[0]) await writeCursor(`${rows[0].occurred_at}|${rows[0].id}`);
    return { posted: 0 };
  }

  const split = cursor.lastIndexOf("|");
  const since = cursor.slice(0, split);
  const sinceId = cursor.slice(split + 1);

  const { rows } = await db.execute<EventRow & { occurred_at: string }>(sql`
    select e.id, e.type, e.contract_id, e.payload, e.occurred_at,
           c.title as contract_title, cl.name as client_name,
           a.label as account_label
    from events e
    join contracts c on c.id = e.contract_id
    join clients cl on cl.id = c.client_id
    join accounts a on a.id = c.account_id
    where e.type in ${ANNOUNCED}
      and (e.occurred_at, e.id) > (${since}::timestamptz, ${sinceId}::uuid)
    order by e.occurred_at asc, e.id asc
    limit 20
  `);

  let posted = 0;
  for (const e of rows) {
    const body = line(e);
    if (!body) continue;
    const result = await sendToGroup({
      template: `group_${e.type}`,
      body: [body, "", contractLink(e.contract_id)].join("\n"),
      contractId: e.contract_id,
    });
    if (result.ok) posted++;
  }

  const last = rows[rows.length - 1];
  if (last) await writeCursor(`${last.occurred_at}|${last.id}`);
  return { posted };
}
