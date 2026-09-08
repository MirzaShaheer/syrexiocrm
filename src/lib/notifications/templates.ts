/**
 * Every message the product can send, in one file.
 *
 * Rules for anything added here:
 *   - Plain text only. No markdown, no HTML. Telegram's markdown requires
 *     escaping _*[]()~`>#+-=|{}.! and one missed character rejects the whole
 *     message, so we simply do not use it.
 *   - Every message ends with a link back into the app, because a notification
 *     you cannot act on is just noise.
 *   - Say the account name. A contract title alone is meaningless when four
 *     Upwork profiles are running.
 */

/** Exported because the bot writes messages of its own, in lib/bot. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function contractLink(contractId: string): string {
  return `${appUrl()}/contracts/${contractId}`;
}

export type TemplateKey =
  | "link_confirmed"
  | "link_already_used"
  | "link_unknown_code"
  | "link_expired"
  | "test_message"
  | "alert_opened";

/* ------------------------------------------------------------------ linking */

export const linkConfirmed = (name: string, role: string) => ({
  template: "link_confirmed" as const,
  body: [
    `Linked. You are signed in as ${name} (${role}).`,
    "",
    "You will get a message here when something on your contracts needs you,",
    "during the 6pm to 6am shift. Anything raised while you are asleep is",
    "held and delivered at 6pm, except a deadline inside the hour.",
    "",
    "Send /help to see what you can do from here.",
    "",
    appUrl(),
  ].join("\n"),
});

export const linkUnknownCode = () => ({
  template: "link_unknown_code" as const,
  body: [
    "That code was not recognised.",
    "",
    "Open Settings in the app and use the code shown there. Codes look like",
    "ABCD-1234 and last fifteen minutes.",
    "",
    `${appUrl()}/settings`,
  ].join("\n"),
});

export const linkExpired = () => ({
  template: "link_expired" as const,
  body: [
    "That code has expired. They last fifteen minutes.",
    "",
    "Open Settings and press Generate a new code, then send /start again with",
    "the new one.",
    "",
    `${appUrl()}/settings`,
  ].join("\n"),
});

export const linkAlreadyUsed = () => ({
  template: "link_already_used" as const,
  body: [
    "That code has already been used.",
    "",
    "Each code works once. Generate a fresh one in Settings if you need to",
    "link again.",
    "",
    `${appUrl()}/settings`,
  ].join("\n"),
});

/* --------------------------------------------------------------- test send */

export const testMessage = (name: string) => ({
  template: "test_message" as const,
  body: [
    `Test message for ${name}. Notifications are working.`,
    "",
    appUrl(),
  ].join("\n"),
});

/* ------------------------------------------------------------------ alerts */

/**
 * Used by the alert engine in the next phase. Kept here so every template
 * lives together and the wording can be reviewed in one place.
 */
export const alertOpened = (input: {
  ruleLabel: string;
  contractTitle: string;
  clientName: string;
  accountLabel: string;
  ownerName: string | null;
  contractId: string;
  detail?: string;
}) => ({
  template: "alert_opened" as const,
  body: [
    `${input.ruleLabel}: ${input.contractTitle}`,
    `${input.accountLabel} · ${input.clientName}`,
    `Owner: ${input.ownerName ?? "nobody yet"}`,
    ...(input.detail ? ["", input.detail] : []),
    "",
    contractLink(input.contractId),
  ].join("\n"),
});

/**
 * The final hour. Deliberately blunt and short — this one is allowed to
 * arrive at 2am, so it has to justify itself in the first line.
 */
export const finalHour = (input: {
  milestoneTitle: string;
  contractTitle: string;
  accountLabel: string;
  clientName: string;
  minutesLeft: number;
  contractId: string;
}) => ({
  template: "final_hour" as const,
  body: [
    `Due in ${input.minutesLeft} minutes and nothing submitted.`,
    "",
    `${input.milestoneTitle} — ${input.contractTitle}`,
    `${input.accountLabel} · ${input.clientName}`,
    "",
    contractLink(input.contractId),
  ].join("\n"),
});

/* ---------------------------------------------------------- admin grants */

export const adminGranted = (durationLabel: string, _until: Date) => ({
  template: "admin_granted" as const,
  body: [
    `Mir has given you edit access for ${durationLabel.toLowerCase()}.`,
    "",
    "You can now change contracts other people created. It ends automatically —",
    "nothing to hand back.",
    "",
    appUrl(),
  ].join("\n"),
});

export const adminRevoked = () => ({
  template: "admin_revoked" as const,
  body: [
    "Your edit access has ended.",
    "",
    "You can still read everything and add updates and notes, as always. Only",
    "changing somebody else's records needs the extra access.",
    "",
    appUrl(),
  ].join("\n"),
});
