import { RULES, SNOOZE_DURATIONS, type RuleKey } from "@/lib/alert-rules";
import { contractLink } from "@/lib/notifications/templates";
import type { InlineButton } from "@/lib/notifications/transport";
import { agoLabel, formatClock, formatPktDateTime } from "@/lib/time";
import { encode } from "./callbacks";

/**
 * What an alert looks like on a phone, and what you can do about it there.
 *
 * The rule that shaped all of this: a notification you cannot act on is just
 * noise. Before these buttons existed an alert was a line of text and a link,
 * which meant every answer needed a laptop — so at 3am the honest options were
 * ignore it or get up. Each card now carries the one or two things that
 * actually resolve the rule that fired it, and nothing else.
 */

export type AlertCardInput = {
  alertId: string;
  ruleKey: RuleKey;
  contractId: string;
  contractTitle: string;
  clientName: string;
  accountLabel: string;
  ownerName: string | null;
  /** A rule-specific clock, already worded. */
  detail?: string | null;
};

/** The buttons that answer each rule. Order is by likelihood of being right. */
function buttonsForRule(input: AlertCardInput): InlineButton[][] {
  const { alertId, contractId, ruleKey } = input;

  const snooze: InlineButton = { text: "Snooze", data: encode("snz", alertId) };
  const note: InlineButton = { text: "Note", data: encode("note", contractId) };

  switch (ruleKey) {
    case "client_waiting":
      return [
        [{ text: "✓ Replied", data: encode("rep", contractId) }],
        [snooze, note],
      ];

    case "no_next_action":
      return [
        [{ text: "Set next action", data: encode("na", contractId) }],
        [snooze, note],
      ];

    case "stale_contract":
      return [
        [{ text: "Post update", data: encode("upd", contractId) }],
        [snooze, note],
      ];

    case "unassigned":
      return [
        [
          { text: "I'll take it", data: encode("take", contractId) },
          { text: "Hand to…", data: encode("ho", contractId) },
        ],
      ];

    case "milestone_due":
      return [
        [{ text: "Post update", data: encode("upd", contractId) }],
        [snooze, note],
      ];
  }
}

export function alertCard(input: AlertCardInput): {
  body: string;
  keyboard: InlineButton[][];
} {
  return {
    body: [
      `${RULES[input.ruleKey].label}: ${input.contractTitle}`,
      `${input.accountLabel} · ${input.clientName}`,
      `Owner: ${input.ownerName ?? "nobody yet"}`,
      ...(input.detail ? ["", input.detail] : []),
      "",
      contractLink(input.contractId),
    ].join("\n"),
    keyboard: buttonsForRule(input),
  };
}

/**
 * The same card, after somebody has answered it.
 *
 * Replacing the message rather than sending a new one is the point: the alert
 * stops being an offer to act and becomes a record of who acted, so nobody
 * else on the team wastes a second answering something already handled.
 */
export function answeredCard(
  original: string,
  outcome: string,
  byName: string,
  at = new Date(),
): string {
  return [
    original,
    "",
    `— ${outcome} by ${byName}, ${formatPktDateTime(at)} PKT`,
  ].join("\n");
}

/** The four-hourly repeat. Says plainly that it has been asked before. */
export function nudgeCard(
  input: AlertCardInput & { openedAt: Date; nudgeCount: number },
): { body: string; keyboard: InlineButton[][] } {
  const card = alertCard(input);
  const asked =
    input.nudgeCount === 1
      ? "Asked once already."
      : `Asked ${input.nudgeCount} times already.`;

  return {
    body: [
      `Still open after ${formatClock(Date.now() - input.openedAt.getTime())}.`,
      "",
      card.body,
      "",
      `${asked} Everyone on the team can see this one.`,
    ].join("\n"),
    keyboard: card.keyboard,
  };
}

/* ------------------------------------------------------------ snooze flow */

/** Step one of a snooze: how long. The reason is asked for after. */
export function snoozeDurations(alertId: string): InlineButton[][] {
  return [
    SNOOZE_DURATIONS.slice(0, 2).map((d) => ({
      text: d.label,
      data: encode("snz", alertId, d.key),
    })),
    SNOOZE_DURATIONS.slice(2).map((d) => ({
      text: d.label,
      data: encode("snz", alertId, d.key),
    })),
  ];
}

/* --------------------------------------------------------------- contract */

export type ContractCardInput = {
  contractId: string;
  title: string;
  clientName: string;
  accountLabel: string;
  ownerName: string | null;
  stageLabel: string;
  nextActionText: string | null;
  nextActionDueAt: Date | null;
  lastClientMessageAt: Date | null;
  lastTeamMessageAt: Date | null;
  lastUpdateAt: Date | null;
};

/** Everything about one contract that fits on a phone screen, plus the verbs. */
export function contractCard(c: ContractCardInput): {
  body: string;
  keyboard: InlineButton[][];
} {
  const waiting =
    c.lastClientMessageAt &&
    (!c.lastTeamMessageAt || c.lastClientMessageAt > c.lastTeamMessageAt);

  return {
    body: [
      c.title,
      `${c.accountLabel} · ${c.clientName}`,
      `Owner: ${c.ownerName ?? "nobody yet"} · ${c.stageLabel}`,
      "",
      c.nextActionText
        ? `Next: ${c.nextActionText}${
            c.nextActionDueAt
              ? ` (due ${formatPktDateTime(c.nextActionDueAt)} PKT)`
              : ""
          }`
        : "Next: nothing set",
      waiting
        ? `Client waiting ${agoLabel(Date.now() - c.lastClientMessageAt!.getTime())}`
        : c.lastTeamMessageAt
          ? `Last replied ${agoLabel(Date.now() - c.lastTeamMessageAt.getTime())}`
          : "No messages logged",
      c.lastUpdateAt
        ? `Last update ${agoLabel(Date.now() - c.lastUpdateAt.getTime())}`
        : "No update ever posted",
      "",
      contractLink(c.contractId),
    ].join("\n"),
    keyboard: [
      [
        { text: "✓ Replied", data: encode("rep", c.contractId) },
        { text: "Client wrote", data: encode("got", c.contractId) },
      ],
      [
        { text: "Update", data: encode("upd", c.contractId) },
        { text: "Next action", data: encode("na", c.contractId) },
      ],
      [
        { text: "Note", data: encode("note", c.contractId) },
        { text: "Hand to…", data: encode("ho", c.contractId) },
      ],
    ],
  };
}

/* ------------------------------------------------------------------- help */

export function helpText(appUrl: string): string {
  return [
    "What I can do:",
    "",
    "/today     everything that needs somebody tonight",
    "/mine      the same, only yours",
    "/find x    search contracts and clients by name",
    "/bids      enter this week's bid counts",
    "/help      this",
    "",
    "You can also reply to any alert with a line of text and I will save it",
    "as a note on that contract. No command needed.",
    "",
    appUrl,
  ].join("\n");
}
