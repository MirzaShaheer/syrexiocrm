import { isOwner, type Actor } from "@/lib/permissions";

/**
 * What the product is, screen by screen, and who may open each one.
 *
 * This file is the single source of truth for three things that used to drift
 * apart: the navigation order, the access rules the pages enforce, and the
 * map on /map. Add a screen here and it appears in all three, or in none.
 *
 * The access split is deliberately small. The team shares one operational
 * picture — everybody reads everything — so "owner only" is reserved for the
 * two acts that are not about the work itself: handing out edit rights over
 * other people's records, and configuring the system that notifies everyone.
 */

export type Access = "everyone" | "owner";

export type MapSection = {
  key: string;
  name: string;
  href: string;
  /** One line, plain: what this screen is for. */
  blurb: string;
  access: Access;
  /** What you actually do here. */
  does: string[];
  /** Restrictions worth stating on the map, if any. */
  limits?: string[];
  /** Shown in the top navigation, in this order. */
  inNav: boolean;
  group: MapGroup;
};

export type MapGroup = "daily" | "record" | "agency" | "admin";

export const GROUPS: { key: MapGroup; title: string; note: string }[] = [
  {
    key: "daily",
    title: "Every day",
    note: "Where the work is chased. Open these first thing, and again after lunch.",
  },
  {
    key: "record",
    title: "The record",
    note: "Everything the agency has ever done, and where new work is entered.",
  },
  {
    key: "agency",
    title: "Running the agency",
    note: "Numbers about the team and the four accounts, rather than about one job.",
  },
  {
    key: "admin",
    title: "Owner only",
    note: "Handing out edit rights, and configuring what the system sends.",
  },
];

export const SECTIONS: MapSection[] = [
  /* ------------------------------------------------------------- daily */
  {
    key: "overview",
    name: "Overview",
    href: "/",
    blurb: "All four Upwork accounts on one screen, with the month's money.",
    access: "everyone",
    inNav: true,
    group: "daily",
    does: [
      "See each account's active contracts, how many are in alert, and work in progress",
      "Read the three agency figures: open alerts, milestones due this week, approved this month",
      "Click an account tile to drop into just that account",
    ],
  },
  {
    key: "today",
    name: "Today",
    href: "/today",
    blurb: "The problem list. Only contracts that need a person today.",
    access: "everyone",
    inNav: true,
    group: "daily",
    does: [
      "Work the queues: overdue actions, clients waiting on a reply, contracts with no owner, contracts with no next action",
      "Claim an unowned contract, or assign several at once",
      "Log a reply in one click, which clears a waiting-client row",
      "Snooze an alert with a reason when a client is genuinely away",
    ],
    limits: ["Anyone can claim an unowned contract. Moving somebody else's work needs edit rights on that record."],
  },

  /* ------------------------------------------------------------ record */
  {
    key: "contracts",
    name: "Contracts",
    href: "/contracts/new",
    blurb: "One live job: its stage, its money, its history, its next action.",
    access: "everyone",
    inNav: false,
    group: "record",
    does: [
      "Enter a new contract by hand — account, client, value, stage, owner, next action",
      "Move the stage along, set the next action and its due date, hand it to somebody else",
      "Add milestones and mark them submitted or approved",
      "Stamp 'client messaged' and 'we replied', which is what keeps the waiting-client alert honest",
      "Post an update, or leave an internal note for whoever picks it up next",
    ],
    limits: [
      "Everyone can append: updates and notes are additive and never destroy anyone's work.",
      "Changing a field somebody else wrote needs to be the record's creator, or hold a live access grant from Mir.",
    ],
  },
  {
    key: "clients",
    name: "Clients",
    href: "/clients",
    blurb: "Everyone the agency has ever worked with, across all four accounts.",
    access: "everyone",
    inNav: true,
    group: "record",
    does: [
      "Search by name or country",
      "See who came back — repeat business is invisible anywhere else, because one client can appear under several accounts",
      "Open a client to see every contract they have ever run with us and what they have paid",
    ],
  },
  {
    key: "history",
    name: "History",
    href: "/history",
    blurb: "Work that closed before the CRM existed. Entered by month.",
    access: "everyone",
    inNav: true,
    group: "record",
    does: [
      "Add a client the agency landed in the past: month, account, value, what the work was, how it ended",
      "Read the month-by-month record of what the agency has closed",
      "See per-account and per-year totals built from those entries",
    ],
    limits: [
      "Past entries never touch Today, the alert engine or any live figure — they are closed by definition.",
      "Deleting a past entry is Mir's alone. Anyone can add one.",
    ],
  },

  /* ------------------------------------------------------------ agency */
  {
    key: "week",
    name: "Week",
    href: "/week",
    blurb: "The funnel: bids out, chats opened, contracted, closed, per account.",
    access: "everyone",
    inNav: true,
    group: "agency",
    does: [
      "Type Monday's counts per account — bids, chats, contracted, closed, withdrawn, none of which Upwork will give us",
      "Compare the four profiles on the same measure",
      "Delete a row that was typed wrong — it waits 30 days in the trash before it is erased",
      "See what was won and what was delivered in the week",
    ],
  },
  {
    key: "people",
    name: "People",
    href: "/people",
    blurb: "The same numbers for everyone. A shared picture, not a private report.",
    access: "everyone",
    inNav: true,
    group: "agency",
    does: [
      "See each person's contracts, how many are in alert, who is waiting on a reply, updates posted this week",
      "Click a name to filter Today down to their work",
    ],
    limits: ["The Access column — granting and revoking edit rights — is visible to Mir only."],
  },
  {
    key: "map",
    name: "Map",
    href: "/map",
    blurb: "This page. What the CRM does, and who can open what.",
    access: "everyone",
    inNav: true,
    group: "agency",
    does: ["Read the whole product in one screen", "Check who can access which section"],
  },

  /* ------------------------------------------------------------- admin */
  {
    key: "access",
    name: "Access grants",
    href: "/people",
    blurb: "Time-boxed edit rights over records somebody else created.",
    access: "owner",
    inNav: false,
    group: "admin",
    does: [
      "Grant a person 1, 3, 7 or 30 days of edit access over any record",
      "Revoke a grant early",
      "Every grant and revocation is written to the audit log",
    ],
    limits: ["Only Mir grants. Nobody can grant it to themselves, including Mir."],
  },
  {
    key: "admin-settings",
    name: "Admin settings",
    href: "/settings",
    blurb: "Telegram for the whole team, the delivery log, and account setup.",
    access: "owner",
    inNav: false,
    group: "admin",
    does: [
      "See who on the team is linked to Telegram, and unlink somebody",
      "Read the notification delivery log — what fired, what failed, and why",
      "Manage the four Upwork account records",
    ],
    limits: ["Everyone can open Settings to link their own Telegram. Only Mir sees the three blocks above."],
  },
];

/**
 * The navigation bar, in the order the day is actually worked: where am I
 * (Overview), what is on fire (Today), how is the week going, then the record
 * — who we work with, what we have finished — then the team, then the map.
 */
const NAV_ORDER = ["overview", "today", "week", "clients", "history", "people", "map"];

export const NAV = NAV_ORDER.map(
  (key) => SECTIONS.find((s) => s.key === key && s.inNav)!,
).filter(Boolean);

export function sectionsFor(actor: Actor): MapSection[] {
  return SECTIONS.filter((s) => canOpen(actor, s));
}

export function canOpen(actor: Actor, section: MapSection): boolean {
  return section.access === "everyone" || isOwner(actor);
}

export function groupSections(sections: MapSection[]) {
  return GROUPS.map((g) => ({
    ...g,
    sections: sections.filter((s) => s.group === g.key),
  })).filter((g) => g.sections.length > 0);
}
