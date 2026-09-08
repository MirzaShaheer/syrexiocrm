/**
 * What a tapped button says when it comes back.
 *
 * Telegram gives 64 bytes of `callback_data` and nothing else — no session, no
 * hidden fields. A dashed uuid is 36 of those bytes, so ids travel with the
 * dashes stripped and are put back on arrival. Two ids never fit, which is why
 * anything needing a second value asks for it in a follow-up rather than
 * trying to pack it in here.
 *
 * Everything arriving through this file is attacker-supplied: a person can
 * craft any callback_data they like. Decoding proves the *shape* of a value
 * and nothing more — never that the sender may act on it. Every caller passes
 * the decoded id to lib/ops, which re-checks permissions from the database.
 */

export const CALLBACK_ACTIONS = [
  /** Log our reply on a contract. */
  "rep",
  /** Log an incoming client message. */
  "got",
  /** Start a snooze: asks for a reason next. */
  "snz",
  /** Ask for the next action. */
  "na",
  /** Ask for an update line. */
  "upd",
  /** Ask for an internal note. */
  "note",
  /** Show the list of people to hand a contract to. */
  "ho",
  /** Hand it to this person. */
  "hox",
  /** Claim an unowned contract. */
  "take",
  /** Mark a milestone submitted. */
  "msub",
  /** Ask for this account's bid count. */
  "bid",
  /** Reprint the contract card with its buttons. */
  "card",
  /** Acknowledged, nothing to do. */
  "nope",
] as const;

export type CallbackAction = (typeof CALLBACK_ACTIONS)[number];

export type Callback = {
  action: CallbackAction;
  /** The uuid the button refers to. Absent for actions that need none. */
  id?: string;
  /** A short literal, currently only a snooze duration key. */
  arg?: string;
};

const HEX32 = /^[0-9a-f]{32}$/i;

function strip(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

function restore(hex: string): string {
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Telegram's hard limit. Anything longer is rejected when the message sends. */
const MAX_BYTES = 64;

export function encode(action: CallbackAction, id?: string, arg?: string): string {
  const parts = [action, id ? strip(id) : "", arg ?? ""].filter(
    (p, i) => p !== "" || i === 0,
  );
  const data = parts.join(":");
  if (Buffer.byteLength(data) > MAX_BYTES) {
    // A silent truncation here would produce a button that looks fine and does
    // the wrong thing, so fail loudly at build-the-message time instead.
    throw new Error(`Callback data too long: ${action}`);
  }
  return data;
}

export function decode(raw: string): Callback | null {
  if (!raw || raw.length > MAX_BYTES) return null;
  const [action, hex, arg] = raw.split(":");

  if (!CALLBACK_ACTIONS.includes(action as CallbackAction)) return null;

  if (hex !== undefined && hex !== "") {
    if (!HEX32.test(hex)) return null;
    return {
      action: action as CallbackAction,
      id: restore(hex),
      arg: arg || undefined,
    };
  }

  return { action: action as CallbackAction, arg: arg || undefined };
}
