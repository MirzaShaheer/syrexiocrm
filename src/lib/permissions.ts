/**
 * Every access decision in the product resolves here.
 *
 * The shape of it:
 *   - Everybody reads everything. This is a shared operational picture; a
 *     contract you cannot see is a contract nobody chases.
 *   - Everybody appends. Updates and notes are additive and immutable, so
 *     adding detail to someone else's contract can never destroy their work.
 *   - Editing a field somebody else wrote is the restricted act. You may edit
 *     what you created. Anyone else needs the owner's permission.
 *   - Elevated access is time-boxed and only the owner grants or revokes it.
 */

export type Role = "owner" | "manager" | "sales_executive";

export type Actor = {
  id: string;
  role: Role;
  /** End of a live admin grant, or null. */
  adminUntil: Date | null;
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  sales_executive: "Sales executive",
};

/** A grant that has not yet expired. */
export function hasLiveAdminGrant(actor: Actor, now = new Date()): boolean {
  return actor.adminUntil !== null && actor.adminUntil > now;
}

export function isOwner(actor: Actor): boolean {
  return actor.role === "owner";
}

/** The owner always; anyone else only while their grant is live. */
export function canEditAnything(actor: Actor, now = new Date()): boolean {
  return isOwner(actor) || hasLiveAdminGrant(actor, now);
}

/* ------------------------------------------------------------------ reads */

/** Nobody is scoped out of reading. Kept as a function so it stays one rule. */
export function canReadAllRecords(): boolean {
  return true;
}

/* --------------------------------------------------------------- contracts */

/** Managers and sales executives both run contracts end to end. */
export function canCreateContract(): boolean {
  return true;
}

/**
 * Changing fields on an existing contract: title, value, stage, next action,
 * client, and reassigning the owner.
 */
export function canEditContract(
  actor: Actor,
  contract: { createdByUserId: string | null },
  now = new Date(),
): boolean {
  if (canEditAnything(actor, now)) return true;
  return contract.createdByUserId === actor.id;
}

/**
 * Appending to a contract — posting an update, adding an internal note.
 * Deliberately open: this is how somebody else's work gets added to without
 * being changed.
 */
export function canAppendToContract(): boolean {
  return true;
}

/**
 * Taking an unowned contract, or handing one over. Claiming something nobody
 * owns is always allowed, because an unowned contract is the failure state
 * the whole product exists to remove. Moving somebody else's work needs
 * edit rights on that record.
 */
export function canAssignOwner(
  actor: Actor,
  contract: { createdByUserId: string | null; ownerUserId: string | null },
  now = new Date(),
): boolean {
  if (contract.ownerUserId === null) return true;
  if (contract.ownerUserId === actor.id) return true;
  return canEditContract(actor, contract, now);
}

/* ------------------------------------------------------------ admin grants */

/** Only the owner, and never on themselves. */
export function canGrantAdmin(actor: Actor, target: { id: string }): boolean {
  return isOwner(actor) && target.id !== actor.id;
}

/** How long a grant may run. The owner picks from these. */
export const GRANT_DURATIONS = [
  { key: "1d", label: "1 day", hours: 24 },
  { key: "3d", label: "3 days", hours: 72 },
  { key: "7d", label: "7 days", hours: 168 },
  { key: "30d", label: "30 days", hours: 720 },
] as const;

export type GrantDurationKey = (typeof GRANT_DURATIONS)[number]["key"];

export function grantExpiry(key: GrantDurationKey, from = new Date()): Date {
  const found = GRANT_DURATIONS.find((d) => d.key === key);
  if (!found) throw new Error(`Unknown grant duration: ${key}`);
  return new Date(from.getTime() + found.hours * 3_600_000);
}

/* -------------------------------------------------------------- settings */

/** Connecting and reconnecting Upwork accounts is the owner's alone. */
export function canManageAccounts(actor: Actor): boolean {
  return isOwner(actor);
}

/**
 * The owner-only half of Settings: who on the team is linked to Telegram,
 * unlinking somebody, and the notification delivery log. Everyone still opens
 * Settings — that is where a person links their own Telegram — they just do
 * not see the team's wiring.
 */
export function canViewAdminSettings(actor: Actor): boolean {
  return isOwner(actor);
}

/** Unlinking somebody else's Telegram. Your own is always yours to unlink. */
export function canManageTeamLinks(actor: Actor): boolean {
  return isOwner(actor);
}

/* ------------------------------------------------------------- past work */

/**
 * Recording work that closed before the CRM existed. Open to everyone: it is
 * the same act as entering a live contract, and history nobody can type is
 * history that never gets typed.
 */
export function canAddPastWork(): boolean {
  return true;
}

/**
 * Removing a past entry rewrites the revenue record, so unlike everything
 * else in the product it is destructive rather than additive. The owner
 * always; anyone else only for a record they entered themselves, so a typo
 * can be undone without asking.
 */
export function canDeletePastWork(
  actor: Actor,
  record: { createdByUserId: string | null },
  now = new Date(),
): boolean {
  if (canEditAnything(actor, now)) return true;
  return record.createdByUserId === actor.id;
}
