import "server-only";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { sendToChat } from "@/lib/notifications";
import { answerCallback, editMessage } from "@/lib/notifications/telegram";
import type { InlineButton } from "@/lib/notifications/transport";
import { redeemLinkCode } from "@/lib/notifications/linking";
import {
  appUrl,
  linkAlreadyUsed,
  linkConfirmed,
  linkExpired,
  linkUnknownCode,
} from "@/lib/notifications/templates";
import {
  addNoteFor,
  handOverFor,
  markActivityFor,
  postUpdateFor,
  saveBidCountFor,
  setMilestoneStatusFor,
  setNextActionFor,
  snoozeAlertFor,
  type OpsActor,
} from "@/lib/ops";
import { weekStartPkt } from "@/lib/queries/week";
import { formatPktDateTime } from "@/lib/time";
import { answeredCard, contractCard, helpText, snoozeDurations } from "./cards";
import { decode, encode, type CallbackAction } from "./callbacks";
import { buildBrief } from "./digest";
import { DUE_HELP, parseDue, splitDue } from "./due";
import { actorForChat } from "./identity";
import { openPrompt, takePrompt, type PromptKind } from "./prompts";
import {
  activeAccounts,
  assignableUsers,
  contractForMessage,
  loadContractCard,
  searchForBot,
} from "./queries";

/**
 * Everything the bot can be told, and what it does about it.
 *
 * Two rules run through the whole file.
 *
 * First, identity comes from `from.id` and never from the chat. In a private
 * chat those are the same number, but in a group they are not, and resolving a
 * presser by the chat id would make every button in the team group act as
 * whoever the group is — which is nobody. Message *context*, on the other
 * hand, is looked up by chat id, because that is what the delivery log is
 * keyed on.
 *
 * Second, nothing here decides what somebody may do. Callback data is typed by
 * whoever holds the phone and is worth exactly as much as a URL query string:
 * it names a record, it does not grant anything. Every write goes through
 * lib/ops, which asks lib/permissions the same questions the web forms ask.
 */

type TgChat = { id?: number | string; type?: string };
type TgMessage = {
  message_id?: number;
  chat?: TgChat;
  text?: string;
  reply_to_message?: { message_id?: number };
  from?: { id?: number | string };
};

export type TelegramUpdate = {
  message?: TgMessage;
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number | string };
    message?: TgMessage;
  };
};

const NOT_LINKED = [
  "I do not know who you are yet.",
  "",
  "Open Settings in the CRM, generate a code, and send it here as",
  "/start ABCD-2345",
].join("\n");

/* -------------------------------------------------------------- entry point */

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query);
  if (update.message) return handleMessage(update.message);
}

/* ---------------------------------------------------------------- messages */

async function handleMessage(message: TgMessage): Promise<void> {
  const chatId = message.chat?.id;
  const text = (message.text ?? "").trim();
  if (chatId === undefined || !text) return;

  const chat = String(chatId);
  const fromId = message.from?.id === undefined ? chat : String(message.from.id);

  // Linking runs before identity, because it is how identity is established.
  const start = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?/i);
  if (start) return handleStart(chat, start[1]);

  const actor = await actorForChat(fromId);
  if (!actor) {
    await sendToChat({ chatId: chat, template: "not_linked", body: NOT_LINKED });
    return;
  }

  // An answer to something the bot asked.
  const replyTo = message.reply_to_message?.message_id;
  if (replyTo !== undefined) {
    return handleReply(chat, actor, String(replyTo), text);
  }

  const command = text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]+))?$/);
  if (command) {
    return handleCommand(chat, actor, command[1].toLowerCase(), command[2] ?? "");
  }

  await sendToChat({
    chatId: chat,
    template: "help",
    body: helpText(appUrl()),
    userId: actor.id,
  });
}

async function handleStart(chat: string, code: string | undefined): Promise<void> {
  if (!code) {
    await sendToChat({
      chatId: chat,
      template: "link_help",
      body: [
        "To link your account, open Settings in the CRM and send the code",
        "shown there like this:",
        "",
        "/start ABCD-2345",
      ].join("\n"),
    });
    return;
  }

  const result = await redeemLinkCode(code, chat);
  const reply =
    result.outcome === "linked"
      ? linkConfirmed(result.name, ROLE_LABELS[result.role as Role] ?? result.role)
      : result.outcome === "expired"
        ? linkExpired()
        : result.outcome === "used"
          ? linkAlreadyUsed()
          : linkUnknownCode();

  await sendToChat({
    chatId: chat,
    template: reply.template,
    body: reply.body,
    userId: result.outcome === "linked" ? result.userId : null,
  });
}

/* ---------------------------------------------------------------- commands */

async function handleCommand(
  chat: string,
  actor: OpsActor,
  command: string,
  rest: string,
): Promise<void> {
  switch (command) {
    case "today":
    case "mine": {
      const brief = await buildBrief({
        personId: command === "mine" ? actor.id : null,
        heading:
          command === "mine"
            ? `${actor.name}, this is yours right now:`
            : "Everything outstanding right now:",
      });
      await sendToChat({
        chatId: chat,
        template: `command_${command}`,
        body: brief.body,
        userId: actor.id,
        keyboard: brief.keyboard,
      });
      return;
    }

    case "find": {
      const q = rest.trim();
      if (q.length < 2) {
        await sendToChat({
          chatId: chat,
          template: "find_help",
          body: "Send /find and part of a contract or client name.",
          userId: actor.id,
        });
        return;
      }

      const hits = await searchForBot(q);
      if (!hits.length) {
        await sendToChat({
          chatId: chat,
          template: "find_empty",
          body: `Nothing matching "${q}".`,
          userId: actor.id,
        });
        return;
      }

      await sendToChat({
        chatId: chat,
        template: "find_results",
        body: `${hits.length} match${hits.length === 1 ? "" : "es"} for "${q}":`,
        userId: actor.id,
        keyboard: hits.map((h) => [
          { text: `${h.title} — ${h.subtitle}`, data: encode("card", h.id) },
        ]),
      });
      return;
    }

    case "bids": {
      const accounts = await activeAccounts();
      if (!accounts.length) {
        await sendToChat({
          chatId: chat,
          template: "bids_none",
          body: "No active accounts to record bids for.",
          userId: actor.id,
        });
        return;
      }
      await sendToChat({
        chatId: chat,
        template: "bids_pick",
        body: `Bid counts for the week of ${formatPktDateTime(weekStartPkt())} PKT. Pick an account:`,
        userId: actor.id,
        keyboard: accounts.map((a) => [{ text: a.label, data: encode("bid", a.id) }]),
      });
      return;
    }

    default:
      await sendToChat({
        chatId: chat,
        template: "help",
        body: helpText(appUrl()),
        userId: actor.id,
      });
  }
}

/* ----------------------------------------------------------------- replies */

/**
 * A reply is either the answer to a question the bot asked, or — when it is a
 * reply to any other message the bot sent about a contract — a note on that
 * contract. The second case is the cheapest capture path in the product:
 * no command, nothing to remember, just type.
 */
async function handleReply(
  chat: string,
  actor: OpsActor,
  replyToId: string,
  text: string,
): Promise<void> {
  const prompt = await takePrompt(chat, replyToId);

  if (!prompt) {
    const context = await contractForMessage(chat, replyToId);
    if (!context) {
      await sendToChat({
        chatId: chat,
        template: "reply_stale",
        body: [
          "I am not sure what that is a reply to — it may have expired.",
          "",
          "Send /today to see what is outstanding.",
        ].join("\n"),
        userId: actor.id,
      });
      return;
    }

    const result = await addNoteFor(actor, context.contractId, text);
    await sendToChat({
      chatId: chat,
      template: "reply_note",
      body: result.ok ? "Saved as a note on that contract." : result.message,
      userId: actor.id,
      contractId: context.contractId,
    });
    return;
  }

  // The prompt belongs to whoever it was asked of.
  if (prompt.userId !== actor.id) return;

  await applyPromptAnswer(chat, actor, prompt.kind, prompt, text);
}

async function applyPromptAnswer(
  chat: string,
  actor: OpsActor,
  kind: PromptKind,
  prompt: {
    contractId: string | null;
    accountId: string | null;
    alertId: string | null;
    payload: Record<string, unknown>;
  },
  text: string,
): Promise<void> {
  const say = (body: string, template: string) =>
    sendToChat({
      chatId: chat,
      template,
      body,
      userId: actor.id,
      contractId: prompt.contractId,
      alertId: prompt.alertId,
    });

  switch (kind) {
    case "update": {
      if (!prompt.contractId) return;
      const result = await postUpdateFor(actor, prompt.contractId, text);
      await say(result.message, "answer_update");
      return;
    }

    case "note": {
      if (!prompt.contractId) return;
      const result = await addNoteFor(actor, prompt.contractId, text);
      await say(result.message, "answer_note");
      return;
    }

    case "next_action": {
      if (!prompt.contractId) return;
      const { text: action, phrase } = splitDue(text);
      const due = parseDue(phrase);
      if (!due) {
        await say(
          [`I did not understand "${phrase}".`, "", DUE_HELP].join("\n"),
          "answer_next_action_bad_date",
        );
        return;
      }
      const result = await setNextActionFor(actor, prompt.contractId, action, due.dueAt);
      await say(
        result.ok ? `Next action set for ${due.label}.` : result.message,
        "answer_next_action",
      );
      return;
    }

    case "snooze_reason": {
      if (!prompt.alertId) return;
      const duration = String(prompt.payload.duration ?? "");
      const result = await snoozeAlertFor(actor, prompt.alertId, duration, text);
      await say(result.message, "answer_snooze");
      return;
    }

    case "handover_reason": {
      if (!prompt.contractId) return;
      const toUserId = String(prompt.payload.toUserId ?? "");
      const result = await handOverFor(actor, prompt.contractId, toUserId, text);
      await say(result.message, "answer_handover");
      return;
    }

    case "bids": {
      if (!prompt.accountId) return;
      const digits = text.trim().match(/^\d{1,5}$/);
      if (!digits) {
        await say("Send just the number, like 24.", "answer_bids_bad");
        return;
      }
      const weekStart = prompt.payload.weekStart
        ? new Date(String(prompt.payload.weekStart))
        : weekStartPkt();
      const result = await saveBidCountFor(
        actor,
        prompt.accountId,
        weekStart,
        Number(digits[0]),
      );
      await say(result.message, "answer_bids");
      return;
    }
  }
}

/* --------------------------------------------------------------- callbacks */

async function handleCallback(query: {
  id?: string;
  data?: string;
  from?: { id?: number | string };
  message?: TgMessage;
}): Promise<void> {
  const callbackId = query.id;
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const fromId = query.from?.id;

  if (!callbackId || chatId === undefined || fromId === undefined) return;

  const chat = String(chatId);
  const parsed = query.data ? decode(query.data) : null;
  if (!parsed) {
    await answerCallback(callbackId, "That button is no longer valid.");
    return;
  }

  const actor = await actorForChat(String(fromId));
  if (!actor) {
    // Deliberately an alert box rather than a toast: pressing a button and
    // watching nothing happen is how people conclude the bot is broken.
    await answerCallback(callbackId, "Link your account in Settings first.", true);
    return;
  }

  const original = query.message?.text ?? "";
  const msgId = messageId === undefined ? null : String(messageId);

  /** Replaces the card with a record of what was done, and drops its buttons. */
  const settle = async (outcome: string) => {
    if (msgId) await editMessage(chat, msgId, answeredCard(original, outcome, actor.name));
  };

  await dispatchCallback({
    action: parsed.action,
    id: parsed.id,
    arg: parsed.arg,
    actor,
    chat,
    msgId,
    original,
    callbackId,
    settle,
  });
}

async function dispatchCallback(ctx: {
  action: CallbackAction;
  id?: string;
  arg?: string;
  actor: OpsActor;
  chat: string;
  msgId: string | null;
  original: string;
  callbackId: string;
  settle: (outcome: string) => Promise<void>;
}): Promise<void> {
  const { action, id, arg, actor, chat, msgId, callbackId, settle } = ctx;

  /** Opens the reply box and remembers what the answer is for. */
  const ask = async (
    kind: PromptKind,
    body: string,
    ids: {
      contractId?: string | null;
      accountId?: string | null;
      alertId?: string | null;
      payload?: Record<string, unknown>;
    },
  ) => {
    const sent = await sendToChat({
      chatId: chat,
      template: `ask_${kind}`,
      body,
      userId: actor.id,
      contractId: ids.contractId ?? null,
      alertId: ids.alertId ?? null,
      forceReply: true,
    });
    if (sent.ok && sent.messageId) {
      await openPrompt({
        chatId: chat,
        messageId: sent.messageId,
        userId: actor.id,
        kind,
        ...ids,
      });
    }
  };

  /**
   * The contract a button refers to when its own id had no room to travel.
   * Two uuids do not fit in Telegram's 64 bytes, so the second one is
   * recovered from the message the button is attached to.
   */
  const contractFromMessage = async (): Promise<string | null> => {
    if (!msgId) return null;
    const context = await contractForMessage(chat, msgId);
    return context?.contractId ?? null;
  };

  switch (action) {
    case "rep":
    case "got": {
      if (!id) return;
      const direction = action === "rep" ? "out" : "in";
      const result = await markActivityFor(actor, id, direction, "telegram");
      await answerCallback(callbackId, result.message);
      if (result.ok) await settle(action === "rep" ? "Replied" : "Client message logged");
      return;
    }

    case "upd":
      if (!id) return;
      await answerCallback(callbackId);
      await ask("update", "What is the update? Reply to this message.", {
        contractId: id,
      });
      return;

    case "note":
      if (!id) return;
      await answerCallback(callbackId);
      await ask("note", "What is the note? Reply to this message.", {
        contractId: id,
      });
      return;

    case "na":
      if (!id) return;
      await answerCallback(callbackId);
      await ask(
        "next_action",
        [
          "What is the next action? Reply to this message.",
          "",
          DUE_HELP,
        ].join("\n"),
        { contractId: id },
      );
      return;

    case "snz": {
      if (!id) return;
      // First press picks the length, second asks why.
      if (!arg) {
        await answerCallback(callbackId);
        if (msgId) {
          await editMessage(chat, msgId, `${ctx.original}\n\nSnooze for how long?`, {
            keyboard: snoozeDurations(id),
          });
        }
        return;
      }
      await answerCallback(callbackId);
      await ask("snooze_reason", "Why is it being snoozed? Reply to this message.", {
        alertId: id,
        payload: { duration: arg },
      });
      return;
    }

    case "take": {
      if (!id) return;
      // Claiming something nobody owns needs no reason — see lib/permissions.
      const result = await handOverFor(actor, id, actor.id, "");
      await answerCallback(callbackId, result.message);
      if (result.ok) await settle(`Taken on by ${actor.name}`);
      return;
    }

    case "ho": {
      if (!id || !msgId) return;
      const people = (await assignableUsers()).filter((p) => p.id !== actor.id);
      await answerCallback(callbackId);
      const rows: InlineButton[][] = [];
      for (let i = 0; i < people.length; i += 2) {
        rows.push(
          people.slice(i, i + 2).map((p) => ({
            text: p.name,
            data: encode("hox", p.id),
          })),
        );
      }
      await editMessage(chat, msgId, `${ctx.original}\n\nHand it to whom?`, {
        keyboard: rows,
      });
      return;
    }

    case "hox": {
      // `id` here is the person. The contract comes from the message.
      if (!id) return;
      const contractId = await contractFromMessage();
      if (!contractId) {
        await answerCallback(callbackId, "Lost track of which contract. Open it in the app.");
        return;
      }
      await answerCallback(callbackId);
      await ask("handover_reason", "Why is it moving? Reply to this message.", {
        contractId,
        payload: { toUserId: id },
      });
      return;
    }

    case "msub": {
      if (!id) return;
      const result = await setMilestoneStatusFor(actor, id, "submitted");
      await answerCallback(callbackId, result.message);
      if (result.ok) await settle("Submitted");
      return;
    }

    case "bid": {
      if (!id) return;
      await answerCallback(callbackId);
      const weekStart = weekStartPkt();
      await ask("bids", "How many bids went out? Reply with just the number.", {
        accountId: id,
        payload: { weekStart: weekStart.toISOString() },
      });
      return;
    }

    case "card": {
      if (!id) return;
      const card = await loadContractCard(id);
      await answerCallback(callbackId);
      if (!card) return;
      const rendered = contractCard(card);
      await sendToChat({
        chatId: chat,
        template: "contract_card",
        body: rendered.body,
        userId: actor.id,
        contractId: id,
        keyboard: rendered.keyboard,
      });
      return;
    }

    case "nope":
      await answerCallback(callbackId, "Nothing to do.");
      return;
  }
}
