/**
 * Drives the bot end to end against the real database, with the console
 * transport, so every path can be exercised without messaging a person.
 *
 * It links a chat to a real user, presses buttons, answers force-replies, and
 * then reads the database back to check the write actually happened. The
 * point is the round trip: a card that renders and a callback that decodes
 * prove nothing on their own if the contract never changed.
 *
 * Run with: npx tsx scripts/check-bot.ts
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { botPrompts, contracts, notifications, users } from "../src/db/schema";
import { encode } from "../src/lib/bot/callbacks";
import { handleUpdate } from "../src/lib/bot/handle";

const CHAT = "999000111";
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}\n          expected ${expected}\n          actual   ${actual}`);
  }
}

/**
 * The last thing the bot said, from the delivery log.
 *
 * Ordered by message id rather than by `created_at`: two rows written in the
 * same millisecond tie, and a tie here silently reads back the wrong message
 * and fails an assertion that has nothing wrong with it. The console
 * transport numbers its messages monotonically for exactly this reason.
 */
async function lastMessage(): Promise<{ body: string; messageId: string | null }> {
  const [row] = await db
    .select({ body: notifications.body, messageId: notifications.messageId })
    .from(notifications)
    .where(eq(notifications.chatId, CHAT))
    .orderBy(sql`message_id::bigint desc nulls last`)
    .limit(1);
  return row ?? { body: "", messageId: null };
}

async function message(text: string, replyTo?: string) {
  await handleUpdate({
    message: {
      message_id: Math.floor(Math.random() * 1_000_000),
      chat: { id: CHAT, type: "private" },
      from: { id: CHAT },
      text,
      ...(replyTo ? { reply_to_message: { message_id: Number(replyTo) } } : {}),
    },
  });
}

async function press(data: string, messageId = "1") {
  await handleUpdate({
    callback_query: {
      id: `cb-${Math.random()}`,
      data,
      from: { id: CHAT },
      message: {
        message_id: Number(messageId),
        chat: { id: CHAT, type: "private" },
        text: "an alert card",
      },
    },
  });
}

async function main() {
  /* ------------------------------------------------------------- set up */

  /*
   * The acting user is the contract's *creator*, deliberately.
   *
   * An earlier version of this script took whichever user came back first and
   * the run flip-flopped between passing and failing, because half the time
   * that user could not edit a record somebody else had created. That was the
   * permission model working correctly through the bot — which is worth
   * pinning down rather than papering over, so both sides are checked below.
   */
  const [contract] = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      createdByUserId: contracts.createdByUserId,
    })
    .from(contracts)
    .where(
      sql`${contracts.status} = 'active' and ${contracts.createdByUserId} is not null`,
    )
    .orderBy(contracts.id)
    .limit(1);
  if (!contract?.createdByUserId) {
    throw new Error("No active contract with a creator — run npm run db:seed first.");
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, contract.createdByUserId))
    .limit(1);
  if (!user) throw new Error("No users in the database — run npm run db:seed first.");

  const previousChat = user.telegramChatId;
  await db.update(users).set({ telegramChatId: CHAT }).where(eq(users.id, user.id));
  console.log(`\nActing as ${user.name} on contract "${contract.title}"\n`);

  try {
    /* ------------------------------------------------------- identity */
    console.log("unlinked chat");
    await db.update(users).set({ telegramChatId: null }).where(eq(users.id, user.id));
    await message("/today");
    check(
      "an unknown chat is told to link",
      (await lastMessage()).body.startsWith("I do not know who you are"),
      true,
    );
    await db.update(users).set({ telegramChatId: CHAT }).where(eq(users.id, user.id));

    /* ------------------------------------------------------- commands */
    console.log("\ncommands");
    await message("/help");
    check("/help lists the commands", (await lastMessage()).body.includes("/today"), true);

    await message("/today");
    check("/today answers", (await lastMessage()).body.length > 0, true);

    await message("/find zzzznothingmatches");
    check(
      "/find says when nothing matches",
      (await lastMessage()).body.includes("Nothing matching"),
      true,
    );

    /* ------------------------------------------------- one-tap replied */
    console.log("\nbuttons that write");
    await db
      .update(contracts)
      .set({ lastTeamMessageAt: null })
      .where(eq(contracts.id, contract.id));

    await press(encode("rep", contract.id));
    const [afterReply] = await db
      .select({ at: contracts.lastTeamMessageAt })
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    check("Replied stamps the contract", afterReply.at !== null, true);

    /* ---------------------------------------------- force-reply round trip */
    console.log("\nask, then answer");
    await press(encode("upd", contract.id));
    const asked = await lastMessage();
    check("the bot asks for the update", asked.body.includes("What is the update?"), true);

    const [prompt] = await db
      .select({ id: botPrompts.id, kind: botPrompts.kind })
      .from(botPrompts)
      .where(eq(botPrompts.chatId, CHAT))
      .orderBy(sql`created_at desc`)
      .limit(1);
    check("a prompt is recorded", prompt?.kind, "update");

    await message("Checked in with the client, all fine.", asked.messageId ?? "0");
    check("the answer is confirmed", (await lastMessage()).body, "Update posted.");

    const { rows: updateCount } = await db.execute<{ count: string }>(sql`
      select count(*) as count from updates
      where contract_id = ${contract.id}
        and body = 'Checked in with the client, all fine.'
    `);
    check("the update reached the database", Number(updateCount[0].count) > 0, true);

    /* ------------------------------------------ a stale reply is refused */
    console.log("\nreplies with no question");
    await message("a reply to nothing at all", "88888888");
    check(
      "an unknown reply is not written anywhere",
      (await lastMessage()).body.includes("not sure what that is a reply to"),
      true,
    );

    /* --------------------------------------- next action, with a due date */
    console.log("\nnext action and its due date");
    await press(encode("na", contract.id));
    const naAsk = await lastMessage();
    await message("Send the revised quote | 2d", naAsk.messageId ?? "0");
    check(
      "a next action with | 2d is accepted",
      (await lastMessage()).body.startsWith("Next action set for in 2 days"),
      true,
    );

    // `db.execute` hands back whatever the driver parsed, which for a
    // timestamptz here is a string, not a Date.
    const { rows: dueRows } = await db.execute<{ text: string; due: string }>(sql`
      select next_action_text as text, next_action_due_at as due
      from contracts where id = ${contract.id}
    `);
    check("the next action reached the database", dueRows[0].text, "Send the revised quote");
    check(
      "its due date is two days out",
      Math.round((new Date(dueRows[0].due).getTime() - Date.now()) / 3_600_000),
      48,
    );

    await press(encode("na", contract.id));
    const naAsk2 = await lastMessage();
    await message("Something | next thursday-ish", naAsk2.messageId ?? "0");
    check(
      "an unparseable date is refused rather than guessed",
      (await lastMessage()).body.startsWith("I did not understand"),
      true,
    );

    /* ------------------------------------------- permissions, through the bot */
    console.log("\npermissions");

    // Somebody who did not create this record and holds no grant. The bot must
    // refuse exactly as the contract screen would; a button is not authority.
    const [stranger] = await db
      .select({ id: users.id, name: users.name, chatId: users.telegramChatId })
      .from(users)
      .where(
        sql`${users.id} <> ${user.id} and ${users.role} = 'sales_executive'
            and ${users.active} = true and ${users.adminUntil} is null`,
      )
      .orderBy(users.id)
      .limit(1);

    if (stranger) {
      const strangerPrevious = stranger.chatId;
      await db
        .update(users)
        .set({ telegramChatId: CHAT })
        .where(eq(users.id, stranger.id));
      await db.update(users).set({ telegramChatId: null }).where(eq(users.id, user.id));

      await press(encode("na", contract.id));
      const strangerAsk = await lastMessage();
      await message("Trying to edit someone else's record", strangerAsk.messageId ?? "0");
      check(
        `${stranger.name} cannot set a next action on a record they did not create`,
        (await lastMessage()).body.startsWith("This record was created by someone else"),
        true,
      );

      // Appending is open to everyone, and must still work for them.
      await press(encode("upd", contract.id));
      const strangerUpd = await lastMessage();
      await message("But an update is always allowed.", strangerUpd.messageId ?? "0");
      check(
        `${stranger.name} can still post an update`,
        (await lastMessage()).body,
        "Update posted.",
      );

      await db
        .update(users)
        .set({ telegramChatId: strangerPrevious })
        .where(eq(users.id, stranger.id));
      await db.update(users).set({ telegramChatId: CHAT }).where(eq(users.id, user.id));
    } else {
      console.log("  skip  no second sales executive to test refusal with");
    }

    /* --------------------------------------------------- rubbish input */
    console.log("\nmalformed callbacks");
    await press("rep:not-a-uuid");
    await press("nonsense");
    await press(encode("rep", "00000000-0000-0000-0000-000000000000"));
    check("nothing above threw", true, true);
  } finally {
    await db
      .update(users)
      .set({ telegramChatId: previousChat })
      .where(eq(users.id, user.id));
    await db.delete(botPrompts).where(eq(botPrompts.chatId, CHAT));
    await db.delete(notifications).where(eq(notifications.chatId, CHAT));
  }

  console.log(failures ? `\n${failures} failed\n` : "\nall good\n");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
