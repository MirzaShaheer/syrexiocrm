/**
 * Seeds realistic fake data across all four Upwork accounts, engineered so
 * that every alert rule has at least one contract sitting in it, plus a
 * healthy set that triggers nothing.
 *
 * Deterministic: same input, same output. Safe to re-run — it truncates first.
 *
 *   npm run db:seed
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "./index";
import {
  accounts,
  alerts,
  clients,
  contracts,
  events,
  milestones,
  sessions,
  syncRuns,
  updates,
  users,
} from "./schema";
import { hashPassword } from "../lib/password";

const NOW = new Date();
/** Hours before now. Negative numbers read as "in the future". */
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
const inHours = (hours: number) => ago(-hours);
const days = (n: number) => n * 24;

const SEED_PASSWORD = "changeme123";

/* ------------------------------------------------------------------ people */

type UserSpec = {
  key: string;
  name: string;
  email: string;
  role: "owner" | "manager" | "sales_executive";
  /** Hours of live elevated access, for seeding one example grant. */
  adminForHours?: number;
  active?: boolean;
};

const USERS: UserSpec[] = [
  { key: "mir", name: "Mir", email: "mir@agency.test", role: "owner" },
  { key: "yasir", name: "Yasir", email: "yasir@agency.test", role: "manager" },
  { key: "taha", name: "Taha", email: "taha@agency.test", role: "manager" },
  // One live grant, so the elevated-access state has something to render.
  { key: "ahmed", name: "Ahmed", email: "ahmed@agency.test", role: "sales_executive", adminForHours: 44 },
  { key: "ali", name: "Ali", email: "ali@agency.test", role: "sales_executive" },
  { key: "saleem", name: "Saleem", email: "saleem@agency.test", role: "sales_executive" },
];

/* ---------------------------------------------------------------- accounts */

type AccountSpec = {
  key: "moid" | "ammar" | "yasir" | "sum";
  label: string;
  market: "us" | "pk";
  niche: "web_development" | "ebook_design" | "graphic_design";
  connectionState: "disconnected" | "connected" | "needs_reconnect";
  lastSyncedAgo: number | null;
  lastSyncError?: string;
};

const ACCOUNTS: AccountSpec[] = [
  {
    key: "moid",
    label: "Moid",
    market: "us",
    niche: "web_development",
    connectionState: "connected",
    lastSyncedAgo: 0.2,
  },
  {
    key: "ammar",
    label: "Ammar",
    market: "us",
    niche: "ebook_design",
    connectionState: "connected",
    lastSyncedAgo: 0.3,
  },
  {
    key: "yasir",
    label: "Yasir",
    market: "pk",
    niche: "web_development",
    connectionState: "connected",
    lastSyncedAgo: 0.25,
  },
  {
    // One account deliberately broken, so the settings page has something to show.
    key: "sum",
    label: "SUM",
    market: "us",
    niche: "graphic_design",
    connectionState: "needs_reconnect",
    lastSyncedAgo: 31,
    lastSyncError: "refresh_token rejected: invalid_grant",
  },
];

/* ----------------------------------------------------------------- clients */

type ClientSpec = { key: string; name: string; country: string; tz: string };

const CLIENTS: ClientSpec[] = [
  { key: "northbeam", name: "Northbeam Logistics", country: "United States", tz: "America/New_York" },
  { key: "harbor", name: "Harbor & Finch", country: "United States", tz: "America/New_York" },
  { key: "kestrel", name: "Kestrel Analytics", country: "United States", tz: "America/New_York" },
  { key: "wilder", name: "Wilder Press", country: "United States", tz: "America/New_York" },
  { key: "monroe", name: "Monroe Publishing House", country: "United States", tz: "America/New_York" },
  { key: "juniper", name: "Juniper Books", country: "Canada", tz: "America/Toronto" },
  { key: "sable", name: "Sable Creative", country: "United States", tz: "America/New_York" },
  { key: "orchard", name: "Orchard Dental Group", country: "United States", tz: "America/New_York" },
  { key: "lumen", name: "Lumen Fitness", country: "United Kingdom", tz: "Europe/London" },
  { key: "trellis", name: "Trellis Home Services", country: "United States", tz: "America/New_York" },
  { key: "arcadia", name: "Arcadia Textiles", country: "Pakistan", tz: "Asia/Karachi" },
  { key: "meridian", name: "Meridian Foods", country: "Pakistan", tz: "Asia/Karachi" },
  { key: "quill", name: "Quill Independent", country: "Australia", tz: "Australia/Sydney" },
  { key: "vantage", name: "Vantage Realty", country: "United States", tz: "America/New_York" },
  { key: "brightoak", name: "Brightoak Studio", country: "United States", tz: "America/New_York" },
  { key: "cobalt", name: "Cobalt Brewing", country: "United States", tz: "America/New_York" },
];

/* --------------------------------------------------------------- contracts */

type MilestoneSpec = {
  title: string;
  amount: string;
  dueIn: number | null;
  status: "pending" | "submitted" | "approved" | "cancelled";
  submittedAgo?: number;
  approvedAgo?: number;
};

type UpdateSpec = { author: string; ago: number; body: string };

type ContractSpec = {
  key: string;
  account: AccountSpec["key"];
  client: string;
  title: string;
  type: "fixed" | "hourly";
  value: string;
  status: "active" | "paused" | "ended";
  owner: string | null;
  stage: string;
  nextAction: string | null;
  nextActionDueIn: number | null;
  clientMsgAgo: number | null;
  teamMsgAgo: number | null;
  startedDaysAgo: number;
  endedDaysAgo?: number;
  milestones?: MilestoneSpec[];
  updates?: UpdateSpec[];
  /** Rule keys currently true. Phase 4's engine should reproduce exactly this. */
  openAlerts: string[];
  /** Rules that fired earlier and have since been resolved. */
  pastAlerts?: { rule: string; openedAgo: number; resolvedAgo: number }[];
};

const CONTRACTS: ContractSpec[] = [
  /* ---- client_waiting, worst case: two days of silence, also stale ------ */
  {
    key: "C-1001",
    account: "moid",
    client: "northbeam",
    title: "Logistics dashboard rebuild",
    type: "hourly",
    value: "15.00",
    status: "active",
    owner: "ahmed",
    stage: "building",
    nextAction: "Send the revised routing screen for sign-off",
    nextActionDueIn: -6,
    clientMsgAgo: 41,
    teamMsgAgo: 63,
    startedDaysAgo: 34,
    updates: [
      { author: "ahmed", ago: 79, body: "Routing screen wired up, waiting on the API key from their side." },
      { author: "ahmed", ago: 151, body: "Started the map component." },
    ],
    openAlerts: ["client_waiting", "stale_contract", "no_next_action"],
    pastAlerts: [{ rule: "client_waiting", openedAgo: days(9), resolvedAgo: days(8) }],
  },
  /* ---- client_waiting, 19h ---------------------------------------------- */
  {
    key: "C-1002",
    account: "moid",
    client: "harbor",
    title: "Marketing site + CMS migration",
    type: "fixed",
    value: "4800.00",
    status: "active",
    owner: "ali",
    stage: "client_review",
    nextAction: "Chase feedback on staging build",
    nextActionDueIn: 4,
    clientMsgAgo: 19,
    teamMsgAgo: 27,
    startedDaysAgo: 21,
    milestones: [
      { title: "Design sign-off", amount: "1600.00", dueIn: null, status: "approved", submittedAgo: days(12), approvedAgo: days(11) },
      { title: "Build + migration", amount: "2400.00", dueIn: 20, status: "pending" },
      { title: "Launch", amount: "800.00", dueIn: days(11), status: "pending" },
    ],
    updates: [
      { author: "ali", ago: 5, body: "Staging is up, sent the link. Waiting on their content team." },
    ],
    openAlerts: ["client_waiting", "milestone_due"],
  },
  /* ---- client_waiting, 14h, just over the line -------------------------- */
  {
    key: "C-1003",
    account: "yasir",
    client: "arcadia",
    title: "Inventory portal phase 2",
    type: "fixed",
    value: "1750.00",
    status: "active",
    owner: "yasir",
    stage: "internal_review",
    nextAction: "QA the stock adjustment flow",
    nextActionDueIn: 9,
    clientMsgAgo: 14,
    teamMsgAgo: 20,
    startedDaysAgo: 12,
    milestones: [
      { title: "Phase 2 build", amount: "1750.00", dueIn: days(6), status: "pending" },
    ],
    updates: [{ author: "yasir", ago: 8, body: "Stock adjustment flow done, QA tomorrow morning." }],
    openAlerts: ["client_waiting"],
  },
  /* ---- client waiting 9h: on the Today list, amber, not yet an alert ---- */
  {
    key: "C-1004",
    account: "ammar",
    client: "wilder",
    title: "Memoir interior layout, 240pp",
    type: "fixed",
    value: "1200.00",
    status: "active",
    owner: "taha",
    stage: "proofing",
    nextAction: "Return second proof with corrections applied",
    nextActionDueIn: 22,
    clientMsgAgo: 9,
    teamMsgAgo: 15,
    startedDaysAgo: 17,
    milestones: [
      { title: "First proof", amount: "600.00", dueIn: null, status: "approved", submittedAgo: days(5), approvedAgo: days(4) },
      { title: "Final files", amount: "600.00", dueIn: days(5), status: "pending" },
    ],
    updates: [{ author: "taha", ago: 6, body: "Corrections from proof one are in, running a final pass." }],
    openAlerts: [],
  },
  /* ---- milestone_due, nothing submitted --------------------------------- */
  {
    key: "C-1005",
    account: "ammar",
    client: "monroe",
    title: "Cookbook layout and ebook conversion",
    type: "fixed",
    value: "2600.00",
    status: "active",
    owner: "taha",
    stage: "layout",
    nextAction: "Deliver chapters 6 to 12",
    nextActionDueIn: 8,
    clientMsgAgo: 30,
    teamMsgAgo: 27,
    startedDaysAgo: 26,
    milestones: [
      { title: "Chapters 1 to 5", amount: "900.00", dueIn: null, status: "approved", submittedAgo: days(9), approvedAgo: days(8) },
      { title: "Chapters 6 to 12", amount: "1100.00", dueIn: 9, status: "pending" },
      { title: "Epub conversion", amount: "600.00", dueIn: days(14), status: "pending" },
    ],
    updates: [{ author: "taha", ago: 4, body: "Chapters 6 to 10 laid out, 11 and 12 tonight." }],
    openAlerts: ["milestone_due"],
  },
  /* ---- milestone_due, work already submitted ---------------------------- */
  {
    key: "C-1006",
    account: "sum",
    client: "cobalt",
    title: "Can label series, six SKUs",
    type: "fixed",
    value: "1900.00",
    status: "active",
    owner: "saleem",
    stage: "client_review",
    nextAction: "Follow up on label approvals",
    nextActionDueIn: 16,
    clientMsgAgo: 33,
    teamMsgAgo: 20,
    startedDaysAgo: 19,
    milestones: [
      { title: "Concepts", amount: "700.00", dueIn: null, status: "approved", submittedAgo: days(10), approvedAgo: days(9) },
      { title: "Final artwork", amount: "1200.00", dueIn: 20, status: "submitted", submittedAgo: 5 },
    ],
    updates: [{ author: "saleem", ago: 5, body: "All six labels submitted for approval." }],
    openAlerts: ["milestone_due"],
  },
  /* ---- milestone inside 48h but outside 24h: Today list only ------------ */
  {
    key: "C-1007",
    account: "moid",
    client: "kestrel",
    title: "Analytics onboarding flow",
    type: "fixed",
    value: "3200.00",
    status: "active",
    owner: "ali",
    stage: "building",
    nextAction: "Wire the invite step to their auth service",
    nextActionDueIn: 30,
    clientMsgAgo: 26,
    teamMsgAgo: 22,
    startedDaysAgo: 15,
    milestones: [
      { title: "Onboarding v1", amount: "3200.00", dueIn: 40, status: "pending" },
    ],
    updates: [{ author: "ali", ago: 7, body: "Invite step half done, blocked on their sandbox creds." }],
    openAlerts: [],
  },
  /* ---- stale_contract: no update in five days --------------------------- */
  {
    key: "C-1008",
    account: "yasir",
    client: "meridian",
    title: "Distributor ordering site",
    type: "hourly",
    value: "15.00",
    status: "active",
    owner: "yasir",
    stage: "building",
    nextAction: "Finish the order history screen",
    nextActionDueIn: 12,
    clientMsgAgo: 50,
    teamMsgAgo: 46,
    startedDaysAgo: 40,
    updates: [{ author: "yasir", ago: days(5), body: "Cart and checkout done." }],
    openAlerts: ["stale_contract"],
  },
  /* ---- stale_contract: never updated at all ----------------------------- */
  {
    key: "C-1009",
    account: "sum",
    client: "orchard",
    title: "Clinic brand refresh",
    type: "fixed",
    value: "1400.00",
    status: "active",
    owner: "saleem",
    stage: "concepts",
    nextAction: "Present three directions",
    nextActionDueIn: 26,
    clientMsgAgo: days(4),
    teamMsgAgo: days(4) - 2,
    startedDaysAgo: 6,
    milestones: [
      { title: "Concepts", amount: "600.00", dueIn: days(3), status: "pending" },
      { title: "Final files", amount: "800.00", dueIn: days(12), status: "pending" },
    ],
    updates: [],
    openAlerts: ["stale_contract"],
  },
  /* ---- stale_contract + no_next_action (past due date) ------------------ */
  {
    key: "C-1010",
    account: "ammar",
    client: "juniper",
    title: "Series cover set, three titles",
    type: "fixed",
    value: "900.00",
    status: "active",
    owner: "taha",
    stage: "revisions",
    nextAction: "Send revision round two",
    nextActionDueIn: -30,
    clientMsgAgo: 88,
    teamMsgAgo: 80,
    startedDaysAgo: 23,
    updates: [{ author: "taha", ago: 96, body: "Round one revisions sent." }],
    openAlerts: ["stale_contract", "no_next_action"],
  },
  /* ---- no update in 24h, but not yet stale (72h) ------------------------ */
  {
    key: "C-1011",
    account: "moid",
    client: "vantage",
    title: "Listings search rebuild",
    type: "hourly",
    value: "15.00",
    status: "active",
    owner: "ahmed",
    stage: "building",
    nextAction: "Ship filter persistence",
    nextActionDueIn: 20,
    clientMsgAgo: 36,
    teamMsgAgo: 30,
    startedDaysAgo: 11,
    updates: [{ author: "ahmed", ago: 34, body: "Search index rebuilt, filters next." }],
    openAlerts: [],
  },
  {
    key: "C-1012",
    account: "yasir",
    client: "lumen",
    title: "Membership signup flow",
    type: "fixed",
    value: "1300.00",
    status: "active",
    owner: "yasir",
    stage: "scoping",
    nextAction: "Confirm payment provider with client",
    nextActionDueIn: 18,
    clientMsgAgo: 44,
    teamMsgAgo: 41,
    startedDaysAgo: 4,
    updates: [{ author: "yasir", ago: 28, body: "Scope call done, writing up the flow." }],
    openAlerts: [],
  },
  /* ---- unassigned, three days old --------------------------------------- */
  {
    key: "C-1013",
    account: "moid",
    client: "trellis",
    title: "Booking widget for home services",
    type: "fixed",
    value: "2200.00",
    status: "active",
    owner: null,
    stage: "scoping",
    nextAction: null,
    nextActionDueIn: null,
    clientMsgAgo: 20,
    teamMsgAgo: null,
    startedDaysAgo: 3,
    milestones: [{ title: "Discovery", amount: "500.00", dueIn: days(4), status: "pending" }],
    updates: [],
    openAlerts: ["unassigned", "no_next_action", "client_waiting", "stale_contract"],
  },
  /* ---- unassigned, landed this morning ---------------------------------- */
  {
    key: "C-1014",
    account: "sum",
    client: "brightoak",
    title: "Event poster and social kit",
    type: "fixed",
    value: "650.00",
    status: "active",
    owner: null,
    stage: "brief",
    nextAction: null,
    nextActionDueIn: null,
    clientMsgAgo: 5,
    teamMsgAgo: null,
    startedDaysAgo: 0.25,
    updates: [],
    openAlerts: ["unassigned", "no_next_action"],
  },
  /* ---- no_next_action: empty field, everything else healthy ------------- */
  {
    key: "C-1015",
    account: "ammar",
    client: "quill",
    title: "Poetry collection typesetting",
    type: "fixed",
    value: "750.00",
    status: "active",
    owner: "taha",
    stage: "manuscript_received",
    nextAction: null,
    nextActionDueIn: null,
    clientMsgAgo: 30,
    teamMsgAgo: 26,
    startedDaysAgo: 2,
    updates: [{ author: "taha", ago: 3, body: "Manuscript received, checking the character set." }],
    openAlerts: ["no_next_action"],
  },
  /* ---- no_next_action: due date is in the past -------------------------- */
  {
    key: "C-1016",
    account: "yasir",
    client: "arcadia",
    title: "Warehouse scanner integration",
    type: "hourly",
    value: "15.00",
    status: "active",
    owner: "ahmed",
    stage: "internal_review",
    nextAction: "Test scanner handoff on site",
    nextActionDueIn: -30,
    clientMsgAgo: 40,
    teamMsgAgo: 36,
    startedDaysAgo: 28,
    updates: [{ author: "ahmed", ago: 10, body: "Scanner handoff works on the emulator." }],
    openAlerts: ["no_next_action"],
  },
  /* ---- healthy ----------------------------------------------------------- */
  {
    key: "C-1017",
    account: "moid",
    client: "sable",
    title: "Portfolio site with case studies",
    type: "fixed",
    value: "2900.00",
    status: "active",
    owner: "ali",
    stage: "revisions",
    nextAction: "Apply typography feedback",
    nextActionDueIn: 21,
    clientMsgAgo: 12,
    teamMsgAgo: 3,
    startedDaysAgo: 30,
    milestones: [
      { title: "Build", amount: "2000.00", dueIn: null, status: "approved", submittedAgo: days(6), approvedAgo: days(5) },
      { title: "Revisions", amount: "900.00", dueIn: days(8), status: "pending" },
    ],
    updates: [{ author: "ali", ago: 3, body: "Typography feedback logged, starting on it now." }],
    openAlerts: [],
  },
  {
    key: "C-1018",
    account: "ammar",
    client: "monroe",
    title: "Workbook interior, second edition",
    type: "fixed",
    value: "1450.00",
    status: "active",
    owner: "taha",
    stage: "client_review",
    nextAction: "Collect edition two notes",
    nextActionDueIn: 27,
    clientMsgAgo: 16,
    teamMsgAgo: 6,
    startedDaysAgo: 13,
    milestones: [{ title: "Interior", amount: "1450.00", dueIn: days(9), status: "pending" }],
    updates: [{ author: "taha", ago: 6, body: "Second edition draft sent for review." }],
    openAlerts: [],
  },
  {
    key: "C-1019",
    account: "sum",
    client: "lumen",
    title: "Social template system",
    type: "fixed",
    value: "1100.00",
    status: "active",
    owner: "saleem",
    stage: "final_files",
    nextAction: "Package and hand over source files",
    nextActionDueIn: 30,
    clientMsgAgo: 28,
    teamMsgAgo: 7,
    startedDaysAgo: 22,
    milestones: [{ title: "Templates", amount: "1100.00", dueIn: days(3), status: "submitted", submittedAgo: 8 }],
    updates: [{ author: "saleem", ago: 7, body: "Templates submitted, packaging the sources." }],
    openAlerts: [],
  },
  {
    key: "C-1020",
    account: "yasir",
    client: "meridian",
    title: "Static brochure site",
    type: "fixed",
    value: "480.00",
    status: "active",
    owner: "yasir",
    stage: "delivered",
    nextAction: "Confirm client is happy before closing",
    nextActionDueIn: 44,
    clientMsgAgo: 18,
    teamMsgAgo: 9,
    startedDaysAgo: 9,
    updates: [{ author: "yasir", ago: 9, body: "Delivered and live on their domain." }],
    openAlerts: [],
  },
  {
    key: "C-1021",
    account: "moid",
    client: "kestrel",
    title: "Reporting API hardening",
    type: "hourly",
    value: "15.00",
    status: "active",
    owner: "ahmed",
    stage: "internal_review",
    nextAction: "Load test the export endpoint",
    nextActionDueIn: 14,
    clientMsgAgo: 22,
    teamMsgAgo: 4,
    startedDaysAgo: 18,
    updates: [{ author: "ahmed", ago: 4, body: "Rate limiting in place, load test next." }],
    openAlerts: [],
  },
  {
    key: "C-1022",
    account: "sum",
    client: "sable",
    title: "Pitch deck design, 28 slides",
    type: "fixed",
    value: "1250.00",
    status: "active",
    owner: "saleem",
    stage: "concepts",
    nextAction: "Share the two layout directions",
    nextActionDueIn: 10,
    clientMsgAgo: 21,
    teamMsgAgo: 2,
    startedDaysAgo: 5,
    updates: [{ author: "saleem", ago: 2, body: "Two directions drafted, sharing this afternoon." }],
    openAlerts: [],
  },
  /* ---- paused: should not raise alerts ---------------------------------- */
  {
    key: "C-1023",
    account: "ammar",
    client: "juniper",
    title: "Boxed set repackaging",
    type: "fixed",
    value: "1600.00",
    status: "paused",
    owner: "taha",
    stage: "layout",
    nextAction: "Resume when client confirms trim size",
    nextActionDueIn: null,
    clientMsgAgo: days(14),
    teamMsgAgo: days(13),
    startedDaysAgo: 60,
    updates: [{ author: "taha", ago: days(13), body: "Paused at client request pending trim size." }],
    openAlerts: [],
  },
  /* ---- ended: history only ---------------------------------------------- */
  {
    key: "C-1024",
    account: "moid",
    client: "northbeam",
    title: "Driver app landing page",
    type: "fixed",
    value: "800.00",
    status: "ended",
    owner: "ali",
    stage: "delivered",
    nextAction: null,
    nextActionDueIn: null,
    clientMsgAgo: days(30),
    teamMsgAgo: days(30) - 1,
    startedDaysAgo: 95,
    endedDaysAgo: 29,
    milestones: [
      { title: "Landing page", amount: "800.00", dueIn: null, status: "approved", submittedAgo: days(31), approvedAgo: days(30) },
    ],
    updates: [{ author: "ali", ago: days(30), body: "Delivered, client approved the milestone." }],
    openAlerts: [],
    pastAlerts: [
      { rule: "client_waiting", openedAgo: days(45), resolvedAgo: days(44) },
      { rule: "milestone_due", openedAgo: days(32), resolvedAgo: days(31) },
    ],
  },
];

/* -------------------------------------------------------------------- run */

async function main() {
  const t0 = Date.now();

  await db.execute(sql`
    truncate table
      ${alerts}, ${events}, ${updates}, ${milestones}, ${contracts},
      ${clients}, ${sessions}, ${syncRuns}, ${accounts}, ${users}
    restart identity cascade
  `);

  const passwordHash = await hashPassword(SEED_PASSWORD);

  const userRows = await db
    .insert(users)
    .values(
      USERS.map((u) => ({
        name: u.name,
        email: u.email,
        passwordHash,
        role: u.role,
        adminUntil: u.adminForHours === undefined ? null : inHours(u.adminForHours),
        active: u.active ?? true,
      })),
    )
    .returning();
  const userId = new Map(USERS.map((u, i) => [u.key, userRows[i].id]));

  const accountRows = await db
    .insert(accounts)
    .values(
      ACCOUNTS.map((a) => ({
        label: a.label,
        market: a.market,
        niche: a.niche,
        upworkOrgRef: `~org${a.key}0001`,
        connectionState: a.connectionState,
        accessToken: a.connectionState === "connected" ? `mock-access-${a.key}` : null,
        refreshToken: a.connectionState === "disconnected" ? null : `mock-refresh-${a.key}`,
        tokenExpiresAt: a.connectionState === "connected" ? inHours(20) : ago(6),
        lastSyncedAt: a.lastSyncedAgo === null ? null : ago(a.lastSyncedAgo),
        lastSyncError: a.lastSyncError ?? null,
        active: true,
      })),
    )
    .returning();
  const accountId = new Map(ACCOUNTS.map((a, i) => [a.key, accountRows[i].id]));

  const clientRows = await db
    .insert(clients)
    .values(
      CLIENTS.map((c, i) => ({
        name: c.name,
        country: c.country,
        timezone: c.tz,
        upworkClientRef: `~client${String(i + 1).padStart(4, "0")}`,
        firstSeenAt: ago(days(30 + i * 4)),
      })),
    )
    .returning();
  const clientId = new Map(CLIENTS.map((c, i) => [c.key, clientRows[i].id]));

  const eventRows: (typeof events.$inferInsert)[] = [];
  const milestoneRows: (typeof milestones.$inferInsert)[] = [];
  const updateRows: (typeof updates.$inferInsert)[] = [];
  const alertRows: (typeof alerts.$inferInsert)[] = [];

  for (const c of CONTRACTS) {
    const startedAt = ago(days(c.startedDaysAgo));
    const contractUpdates = c.updates ?? [];
    const lastUpdateAt = contractUpdates.length
      ? ago(Math.min(...contractUpdates.map((u) => u.ago)))
      : null;
    const owner = c.owner ? userId.get(c.owner)! : null;

    const [row] = await db
      .insert(contracts)
      .values({
        accountId: accountId.get(c.account)!,
        clientId: clientId.get(c.client)!,
        upworkContractId: c.key,
        title: c.title,
        type: c.type,
        value: c.value,
        currency: "USD",
        status: c.status,
        ownerUserId: owner,
        // Unowned contracts arrived from Upwork sync and have no human author.
        createdByUserId: owner,
        stage: c.stage,
        nextActionText: c.nextAction,
        nextActionDueAt: c.nextActionDueIn === null ? null : inHours(c.nextActionDueIn),
        startedAt,
        endedAt: c.endedDaysAgo === undefined ? null : ago(days(c.endedDaysAgo)),
        lastClientMessageAt: c.clientMsgAgo === null ? null : ago(c.clientMsgAgo),
        lastTeamMessageAt: c.teamMsgAgo === null ? null : ago(c.teamMsgAgo),
        lastUpdateAt,
        archived: false,
        createdAt: startedAt,
        updatedAt: lastUpdateAt ?? startedAt,
      })
      .returning();

    eventRows.push({
      contractId: row.id,
      type: "contract_created",
      actor: "system",
      payload: { upworkContractId: c.key, title: c.title },
      occurredAt: startedAt,
      dedupeKey: `contract_created:${c.key}`,
    });

    if (owner) {
      eventRows.push({
        contractId: row.id,
        type: "owner_assigned",
        actor: userId.get("mir")!,
        payload: { toUserId: owner, toName: USERS.find((u) => u.key === c.owner)!.name },
        occurredAt: new Date(startedAt.getTime() + 3_600_000),
      });
    }

    // One synthetic stage change for anything past the first stage.
    if (c.stage !== "scoping" && c.stage !== "brief" && c.stage !== "manuscript_received") {
      eventRows.push({
        contractId: row.id,
        type: "stage_changed",
        actor: owner ?? "system",
        payload: { to: c.stage },
        occurredAt: new Date(startedAt.getTime() + days(2) * 3_600_000),
      });
    }

    for (const [i, m] of (c.milestones ?? []).entries()) {
      milestoneRows.push({
        contractId: row.id,
        upworkMilestoneId: `${c.key}-M${i + 1}`,
        title: m.title,
        amount: m.amount,
        dueAt: m.dueIn === null ? null : inHours(m.dueIn),
        status: m.status,
        submittedAt: m.submittedAgo === undefined ? null : ago(m.submittedAgo),
        approvedAt: m.approvedAgo === undefined ? null : ago(m.approvedAgo),
      });
      if (m.submittedAgo !== undefined) {
        eventRows.push({
          contractId: row.id,
          type: "milestone_submitted",
          actor: "system",
          payload: { title: m.title, amount: m.amount },
          occurredAt: ago(m.submittedAgo),
          dedupeKey: `milestone_submitted:${c.key}-M${i + 1}`,
        });
      }
      if (m.approvedAgo !== undefined) {
        eventRows.push({
          contractId: row.id,
          type: "milestone_approved",
          actor: "system",
          payload: { title: m.title, amount: m.amount },
          occurredAt: ago(m.approvedAgo),
          dedupeKey: `milestone_approved:${c.key}-M${i + 1}`,
        });
      }
    }

    for (const u of contractUpdates) {
      const author = userId.get(u.author)!;
      const at = ago(u.ago);
      updateRows.push({ contractId: row.id, authorUserId: author, body: u.body, createdAt: at });
      eventRows.push({
        contractId: row.id,
        type: "update_posted",
        actor: author,
        payload: { excerpt: u.body.slice(0, 120) },
        occurredAt: at,
      });
    }

    if (c.clientMsgAgo !== null) {
      eventRows.push({
        contractId: row.id,
        type: "message_received",
        actor: "system",
        payload: { direction: "in", from: CLIENTS.find((x) => x.key === c.client)!.name },
        occurredAt: ago(c.clientMsgAgo),
        dedupeKey: `message_in:${c.key}:${ago(c.clientMsgAgo).toISOString()}`,
      });
    }
    if (c.teamMsgAgo !== null) {
      eventRows.push({
        contractId: row.id,
        type: "message_sent",
        actor: "system",
        payload: { direction: "out" },
        occurredAt: ago(c.teamMsgAgo),
        dedupeKey: `message_out:${c.key}:${ago(c.teamMsgAgo).toISOString()}`,
      });
    }

    for (const rule of c.openAlerts) {
      alertRows.push({
        contractId: row.id,
        ruleKey: rule,
        openedAt: ago(THRESHOLD_HOURS[rule] ?? 6),
        resolvedAt: null,
        notifiedAt: ago((THRESHOLD_HOURS[rule] ?? 6) - 0.5),
        ownerUserIdAtOpen: owner,
      });
    }
    for (const p of c.pastAlerts ?? []) {
      alertRows.push({
        contractId: row.id,
        ruleKey: p.rule,
        openedAt: ago(p.openedAgo),
        resolvedAt: ago(p.resolvedAgo),
        notifiedAt: ago(p.openedAgo - 0.25),
        ownerUserIdAtOpen: owner,
      });
    }
  }

  if (milestoneRows.length) await db.insert(milestones).values(milestoneRows);
  if (updateRows.length) await db.insert(updates).values(updateRows);
  if (eventRows.length) await db.insert(events).values(eventRows);
  if (alertRows.length) await db.insert(alerts).values(alertRows);

  // A little sync history, including one failure, so settings is not empty.
  await db.insert(syncRuns).values(
    ACCOUNTS.flatMap((a) => [
      {
        accountId: accountId.get(a.key)!,
        trigger: "cron" as const,
        status: (a.connectionState === "needs_reconnect" ? "error" : "success") as
          | "error"
          | "success",
        startedAt: ago(a.lastSyncedAgo ?? 1),
        finishedAt: ago((a.lastSyncedAgo ?? 1) - 0.02),
        contractsSeen: "6",
        contractsCreated: "0",
        contractsUpdated: "2",
        contractsClosed: "0",
        requestLog: [
          { op: "contracts.list", ms: 412, status: 200, retries: 0 },
          { op: "milestones.list", ms: 268, status: 200, retries: 0 },
        ],
        error: a.lastSyncError ?? null,
      },
    ]),
  );

  const counts = {
    users: userRows.length,
    accounts: accountRows.length,
    clients: clientRows.length,
    contracts: CONTRACTS.length,
    milestones: milestoneRows.length,
    updates: updateRows.length,
    events: eventRows.length,
    alerts: alertRows.length,
  };
  console.log("Seeded in", Date.now() - t0, "ms");
  console.table(counts);
  console.log(`\nSign in with any seeded email and the password: ${SEED_PASSWORD}`);
  console.log("Owner account: mir@agency.test\n");
}

/** Only used to backdate seeded alerts so their age looks plausible. */
const THRESHOLD_HOURS: Record<string, number> = {
  client_waiting: 12,
  milestone_due: 24,
  stale_contract: 72,
  unassigned: 2,
  no_next_action: 4,
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
