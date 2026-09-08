import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const marketEnum = pgEnum("market", ["us", "pk"]);
export const nicheEnum = pgEnum("niche", [
  "web_development",
  "ebook_design",
  "graphic_design",
]);
/** OAuth health for an account. Drives the reconnect button on settings. */
export const connectionStateEnum = pgEnum("connection_state", [
  "disconnected",
  "connected",
  "needs_reconnect",
]);
export const roleEnum = pgEnum("role", [
  "owner",
  "manager",
  "sales_executive",
]);
export const contractTypeEnum = pgEnum("contract_type", ["fixed", "hourly"]);
export const contractStatusEnum = pgEnum("contract_status", [
  "active",
  "paused",
  "ended",
]);
export const milestoneStatusEnum = pgEnum("milestone_status", [
  "pending",
  "submitted",
  "approved",
  "cancelled",
]);
export const syncRunStatusEnum = pgEnum("sync_run_status", [
  "running",
  "success",
  "error",
]);
export const notificationStatusEnum = pgEnum("notification_status", [
  "queued",
  "sent",
  "failed",
  "skipped",
]);
export const notificationChannelEnum = pgEnum("notification_channel", [
  "telegram",
  "console",
]);
export const syncTriggerEnum = pgEnum("sync_trigger", [
  "cron",
  "webhook",
  "manual",
]);

const id = () => uuid("id").primaryKey().defaultRandom();
const now = () => timestamp({ withTimezone: true, mode: "date" });

/* --------------------------------------------------------------- accounts */

export const accounts = pgTable("accounts", {
  id: id(),
  label: text().notNull().unique(),
  market: marketEnum().notNull(),
  niche: nicheEnum().notNull(),
  upworkOrgRef: text(),

  accessToken: text(),
  refreshToken: text(),
  tokenExpiresAt: now(),

  connectionState: connectionStateEnum().notNull().default("disconnected"),
  lastSyncedAt: now(),
  lastSyncError: text(),

  active: boolean().notNull().default(true),
  createdAt: now().notNull().defaultNow(),
});

/* ------------------------------------------------------------------ users */

export const users = pgTable("users", {
  id: id(),
  name: text().notNull(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  role: roleEnum().notNull().default("sales_executive"),
  /**
   * Time-boxed elevated access. While this is in the future the user may edit
   * records they did not create. Only the owner can set or clear it, and both
   * actions are written to the audit log. Null means no elevated access.
   */
  adminUntil: now(),
  /**
   * Telegram chat id, set once the person links their account. A bot cannot
   * message someone who has never started a chat with it, so this stays null
   * until they send /start with a code.
   */
  telegramChatId: text(),
  telegramLinkedAt: now(),
  active: boolean().notNull().default(true),
  createdAt: now().notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** Hash of the opaque random token held in the cookie. */
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: now().notNull(),
    createdAt: now().notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ---------------------------------------------------------------- clients */

export const clients = pgTable(
  "clients",
  {
    id: id(),
    name: text().notNull(),
    country: text(),
    /** IANA zone, so a deadline can be shown in the client's own Wednesday. */
    timezone: text(),
    upworkClientRef: text(),
    firstSeenAt: now().notNull().defaultNow(),
    notes: text(),
    createdAt: now().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("clients_upwork_ref_idx").on(t.upworkClientRef)],
);

/* -------------------------------------------------------------- contracts */

export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    /** Reconciliation key for sync. Unique, so a re-run cannot duplicate. */
    upworkContractId: text().notNull(),

    title: text().notNull(),
    type: contractTypeEnum().notNull(),
    value: numeric({ precision: 12, scale: 2 }),
    currency: text().notNull().default("USD"),
    status: contractStatusEnum().notNull().default("active"),

    /** Null is a problem state, not a blank. Surfaces on Today. */
    ownerUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    /**
     * Who created this record. Edit rights key off this, not off the owner:
     * everyone can read every contract and append to it, but only the creator
     * (or the owner, or someone holding a live admin grant) may change fields
     * somebody else wrote. Null for contracts that arrived from Upwork sync.
     */
    createdByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    /** Key from PIPELINES, chosen by the account niche. Validated in code. */
    stage: text().notNull(),

    nextActionText: text(),
    nextActionDueAt: now(),

    startedAt: now(),
    endedAt: now(),

    lastClientMessageAt: now(),
    lastTeamMessageAt: now(),
    lastUpdateAt: now(),

    /**
     * Work that closed before this CRM existed, typed in afterwards so the
     * client history and the revenue record are complete. It is a real
     * contract row — the client page counts it, repeat business shows up —
     * but it is always `ended`, so Today, the alert engine and every live
     * figure skip it by the status filter they already apply.
     */
    isHistorical: boolean().notNull().default(false),
    /** First of the month it closed, 00:00 Pakistan time. The only date the
     *  team can actually remember about an old job. */
    wonMonth: now(),
    /** How it ended: completed, cancelled, or moved off Upwork. Free text,
     *  validated in code against HISTORY_OUTCOMES. */
    outcome: text(),

    archived: boolean().notNull().default(false),
    createdAt: now().notNull().defaultNow(),
    updatedAt: now().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contracts_upwork_id_idx").on(t.upworkContractId),
    index("contracts_account_idx").on(t.accountId),
    index("contracts_owner_idx").on(t.ownerUserId),
    index("contracts_status_idx").on(t.status),
    index("contracts_next_action_due_idx").on(t.nextActionDueAt),
    /** The History page reads only backfilled rows, always ordered by month. */
    index("contracts_history_idx").on(t.isHistorical, t.wonMonth),
  ],
);

/* ------------------------------------------------------------- milestones */

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    upworkMilestoneId: text().notNull(),
    title: text().notNull(),
    amount: numeric({ precision: 12, scale: 2 }),
    dueAt: now(),
    status: milestoneStatusEnum().notNull().default("pending"),
    submittedAt: now(),
    approvedAt: now(),
    createdAt: now().notNull().defaultNow(),
    updatedAt: now().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("milestones_upwork_id_idx").on(t.upworkMilestoneId),
    index("milestones_contract_idx").on(t.contractId),
    index("milestones_due_idx").on(t.dueAt, t.status),
  ],
);

/* ---------------------------------------------------------------- updates */

/** The daily standup line. Immutable once posted: no edit, no delete. */
export const updates = pgTable(
  "updates",
  {
    id: id(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    authorUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text().notNull(),
    createdAt: now().notNull().defaultNow(),
  },
  (t) => [
    index("updates_contract_idx").on(t.contractId, t.createdAt),
    index("updates_author_idx").on(t.authorUserId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ notes */

/**
 * Internal notes. Deliberately a different table from `updates`, because they
 * are a different act: an update is "what happened today" and belongs to the
 * standup record; a note is "this client argues about every revision" and
 * belongs to whoever picks the contract up next.
 *
 * Visible to the whole team, never client facing, and — unlike an update —
 * editable and removable by the person who wrote it, because a note is
 * judgement rather than history.
 */
export const notes = pgTable(
  "notes",
  {
    id: id(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    authorUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text().notNull(),
    createdAt: now().notNull().defaultNow(),
    updatedAt: now().notNull().defaultNow(),
  },
  (t) => [index("notes_contract_idx").on(t.contractId, t.createdAt)],
);

/* ----------------------------------------------------------------- events */

/**
 * Append-only audit log. Every stage change, owner change, milestone status
 * change, message received and update posted writes a row. The contract
 * timeline is a read of this table.
 */
export const events = pgTable(
  "events",
  {
    id: id(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    type: text().notNull(),
    /** A user id, or the literal string "system". */
    actor: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: now().notNull().defaultNow(),
    /**
     * Stable key for facts that can arrive twice (webhook, then cron).
     * Null for events generated by a user action inside the app.
     */
    dedupeKey: text(),
  },
  (t) => [
    index("events_contract_idx").on(t.contractId, t.occurredAt),
    index("events_type_idx").on(t.type),
    uniqueIndex("events_dedupe_idx").on(t.dedupeKey),
  ],
);

/* ----------------------------------------------------------------- alerts */

/**
 * Alerts are records, not computed views, so we can report on how often each
 * rule fires and per person. At most one open alert per (contract, rule).
 */
export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    ruleKey: text().notNull(),
    openedAt: now().notNull().defaultNow(),
    resolvedAt: now(),
    /** Set once, on first notification. Null while held for the evening. */
    notifiedAt: now(),
    /**
     * The nag clock. An alert nobody answers is re-sent every four hours to
     * the whole team until it resolves or somebody snoozes it, so this moves
     * every time it goes out — unlike `notifiedAt`, which is stamped once and
     * is what stops the first message being sent twice.
     */
    lastNudgedAt: now(),
    nudgeCount: numeric({ precision: 4, scale: 0 }).notNull().default("0"),
    /**
     * Snooze. Real life has clients on holiday and jobs paused for a week.
     * A snoozed alert stays open but drops off the board until this passes.
     * A reason is required, and the snooze is written to the audit log.
     */
    snoozedUntil: now(),
    snoozeReason: text(),
    snoozedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    /** Who owned it when it opened, for per-person reporting. */
    ownerUserIdAtOpen: uuid().references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("alerts_open_unique_idx")
      .on(t.contractId, t.ruleKey)
      .where(sql`${t.resolvedAt} is null`),
    index("alerts_contract_idx").on(t.contractId),
    index("alerts_rule_idx").on(t.ruleKey, t.openedAt),
    index("alerts_unnotified_idx").on(t.notifiedAt),
    index("alerts_snoozed_idx").on(t.snoozedUntil),
    index("alerts_nudge_idx").on(t.lastNudgedAt),
  ],
);

/* ---------------------------------------------------- telegram link codes */

/**
 * A one-time code a person types into the bot as `/start <code>`, which is how
 * we learn their chat id. Telegram will not let a bot message anyone who has
 * not started a conversation with it first, so there is no way around this
 * step. Short-lived and single use.
 */
export const telegramLinkCodes = pgTable(
  "telegram_link_codes",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text().notNull(),
    expiresAt: now().notNull(),
    /** Set the moment it is redeemed. A used code is never accepted again. */
    usedAt: now(),
    createdAt: now().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("telegram_link_codes_code_idx").on(t.code),
    index("telegram_link_codes_user_idx").on(t.userId, t.createdAt),
  ],
);

/* ----------------------------------------------------------- bot cursors */

/**
 * How far the bot has got through something it reads in order.
 *
 * Currently one row: the last event announced in the team group. Without it
 * the cron would either re-announce the same handover every fifteen minutes or
 * guess from a time window, and a time window quietly loses anything written
 * during a slow run.
 */
export const botCursors = pgTable("bot_cursors", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: now().notNull().defaultNow(),
});

/* ------------------------------------------------------------ bot prompts */

/**
 * What the bot is waiting to hear back about.
 *
 * Telegram has no notion of a conversation state, so when the bot asks "what
 * is the next action?" it has to remember which contract it asked about. The
 * question is sent with a force-reply, and the answer arrives quoting that
 * message id — which is the only thing tying the two together.
 *
 * Short-lived on purpose. A reply to a question from three days ago is not an
 * answer, it is a stray message, and writing it to a contract would be worse
 * than ignoring it.
 */
export const botPrompts = pgTable(
  "bot_prompts",
  {
    id: id(),
    chatId: text().notNull(),
    /** The message id of the bot question this is an answer to. */
    messageId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** What the answer will be used for: next_action, update, note, bids. */
    kind: text().notNull(),
    contractId: uuid().references(() => contracts.id, { onDelete: "cascade" }),
    accountId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    alertId: uuid().references(() => alerts.id, { onDelete: "set null" }),
    /**
     * Anything else the answer needs that will not fit in a callback: the
     * snooze duration already chosen, the week a bid count belongs to.
     */
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: now().notNull(),
    answeredAt: now(),
    createdAt: now().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bot_prompts_message_idx").on(t.chatId, t.messageId),
    index("bot_prompts_expiry_idx").on(t.expiresAt),
  ],
);

/* ---------------------------------------------------------- notifications */

/**
 * Every send attempt, whatever the outcome. A notification that silently
 * failed is worse than one that never fired, because the board looks calm
 * while nobody has been told.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    contractId: uuid().references(() => contracts.id, { onDelete: "set null" }),
    alertId: uuid().references(() => alerts.id, { onDelete: "set null" }),

    channel: notificationChannelEnum().notNull(),
    /** Which template produced this, for reporting on what fires most. */
    template: text().notNull(),
    /** The exact text sent. Plain text, never markdown. */
    body: text().notNull(),
    /**
     * The buttons that went out under it. Stored because a message held
     * through the day is sent hours later by a different process, and an
     * alert that arrives without its buttons is back to being a thing you
     * can only act on from a laptop.
     */
    keyboard: jsonb().$type<{ text: string; data: string }[][]>(),
    /** Telegram chat id at send time, or null when the person is unlinked. */
    chatId: text(),
    /** Telegram's id for the sent message, so it can be edited afterwards. */
    messageId: text(),

    status: notificationStatusEnum().notNull().default("queued"),
    /** Held here while it waits out the 6am to 6pm hold window. */
    scheduledFor: now(),
    sentAt: now(),
    attempts: numeric({ precision: 4, scale: 0 }).notNull().default("0"),
    /** Redacted before storage — never contains the bot token. */
    error: text(),

    createdAt: now().notNull().defaultNow(),
  },
  (t) => [
    index("notifications_status_idx").on(t.status, t.scheduledFor),
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_alert_idx").on(t.alertId),
  ],
);

/* ------------------------------------------------------------ bid counts */

/**
 * Upwork exposes no proposal or Connects data through any API, so the funnel
 * cannot be read — only typed. Deliberately one row per account per week
 * rather than one row per bid: a handful of numbers on a Monday is a habit
 * people keep, and a per-bid log is one nobody sustains past a fortnight.
 *
 * Every count except bids is nullable, so "nobody entered it" stays
 * distinguishable from "it was genuinely zero".
 */
export const bidWeeks = pgTable(
  "bid_weeks",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Monday of the week, at 00:00 Pakistan time. */
    weekStart: now().notNull(),
    bids: numeric({ precision: 5, scale: 0 }).notNull().default("0"),
    /** Proposals that got a reply. */
    chatsOpened: numeric({ precision: 5, scale: 0 }),
    /** Chats that turned into a signed contract. */
    contracted: numeric({ precision: 5, scale: 0 }),
    /** Contracts finished and closed out this week. */
    closed: numeric({ precision: 5, scale: 0 }),
    /** Proposals pulled back, by either side, before a contract existed. */
    withdrawn: numeric({ precision: 5, scale: 0 }),
    connectsSpent: numeric({ precision: 6, scale: 0 }),
    enteredByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: now().notNull().defaultNow(),
    updatedAt: now().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bid_weeks_account_week_idx").on(t.accountId, t.weekStart),
    index("bid_weeks_week_idx").on(t.weekStart),
  ],
);

/**
 * Deleted count rows, kept whole for thirty days.
 *
 * A separate table rather than a deleted_at flag on bid_weeks: the live table
 * is unique on (account, week), so a soft-deleted row would block the next
 * person typing that same slot. Moving the row out leaves the slot free and
 * makes the purge a delete from one table that cannot touch live data.
 */
export const bidWeekTrash = pgTable(
  "bid_week_trash",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    weekStart: now().notNull(),
    /* The counts exactly as they stood, so a restore is a straight put-back. */
    bids: numeric({ precision: 5, scale: 0 }).notNull().default("0"),
    chatsOpened: numeric({ precision: 5, scale: 0 }),
    contracted: numeric({ precision: 5, scale: 0 }),
    closed: numeric({ precision: 5, scale: 0 }),
    withdrawn: numeric({ precision: 5, scale: 0 }),
    /** Whoever typed the numbers originally, kept through the round trip. */
    enteredByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    deletedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    deletedAt: now().notNull().defaultNow(),
  },
  (t) => [
    index("bid_week_trash_deleted_idx").on(t.deletedAt),
    index("bid_week_trash_slot_idx").on(t.accountId, t.weekStart),
  ],
);

/* -------------------------------------------------------------- sync_runs */

/** Full request logging, so sync failures are visible instead of silent. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    accountId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    trigger: syncTriggerEnum().notNull(),
    status: syncRunStatusEnum().notNull().default("running"),
    startedAt: now().notNull().defaultNow(),
    finishedAt: now(),
    contractsSeen: numeric({ precision: 6, scale: 0 }).notNull().default("0"),
    contractsCreated: numeric({ precision: 6, scale: 0 }).notNull().default("0"),
    contractsUpdated: numeric({ precision: 6, scale: 0 }).notNull().default("0"),
    contractsClosed: numeric({ precision: 6, scale: 0 }).notNull().default("0"),
    /** One entry per Upwork call: operation, ms, status, retries, error. */
    requestLog: jsonb().$type<unknown[]>().notNull().default([]),
    error: text(),
  },
  (t) => [index("sync_runs_account_idx").on(t.accountId, t.startedAt)],
);

/* ------------------------------------------------------------------ types */

export type Account = typeof accounts.$inferSelect;
export type User = typeof users.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Update = typeof updates.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type BidWeek = typeof bidWeeks.$inferSelect;
export type BidWeekTrash = typeof bidWeekTrash.$inferSelect;
export type TelegramLinkCode = typeof telegramLinkCodes.$inferSelect;
