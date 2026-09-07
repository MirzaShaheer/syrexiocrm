# Syrexio CRM

Internal operations dashboard for a software house running four Upwork
accounts. Its single job is oversight: open it in the morning, see everything
that is slipping across all four accounts on one screen.

**The governing rule.** Every active contract must have an owner, a stage, and
a next action with a due date, at all times. If any of those is missing or
stale, the contract surfaces as a problem on the Today screen.

The product describes itself: **`/map`** lists every screen, what you do on it,
and who can open it. That page is generated from `src/lib/site-map.ts`, the
same file the navigation and the access checks read, so it cannot drift out of
date.

## Screens

| Screen | For | Who |
|---|---|---|
| Overview `/` | Four accounts on one page, plus the month's money | Everyone |
| Today `/today` | The problem list: overdue, waiting on us, no owner, no next action | Everyone |
| Week `/week` | The funnel — bids out, chats opened, contracts won, per account | Everyone |
| Clients `/clients` | Everyone the agency has ever worked with, and who came back | Everyone |
| History `/history` | Work that closed before the CRM existed, entered by month | Everyone |
| People `/people` | The same numbers for everyone, and time-boxed access grants | Everyone reads; grants are the owner's |
| Contract `/contracts/[id]` | One live job: stage, money, timeline, next action | Everyone reads and appends |
| Settings `/settings` | Your own Telegram link | Everyone |
| Settings — admin blocks | Team Telegram links, delivery log, account records | Owner only |

## Permissions

Three rules, all resolved in `src/lib/permissions.ts`. Never inline a role
comparison anywhere else.

- **Everyone reads everything.** A contract nobody can see is a contract
  nobody chases.
- **Everyone appends** — updates, notes, milestones, new contracts, past
  clients. Appending can never destroy somebody else's work.
- **Only the record's creator edits** a field somebody else wrote. Edit rights
  key off `contracts.created_by_user_id`, not the owner, because the creator
  and the person accountable are usually different people.

Elevated access is **time-boxed** (1, 3, 7 or 30 days), granted and revoked by
the owner alone, never self-granted, and both the grant and the revocation are
written to the audit log.

## History: work that predates the CRM

A past entry is a real row in `contracts` with `is_historical = true` and
`status = 'ended'`, carrying `won_month` and an `outcome`. That is the whole
trick: every live query in the product already filters on `status = 'active'`,
so history can never leak into Today, the alert engine or an account's work in
progress — while the Clients page, repeat-business counts and revenue totals
pick it up for free.

## Stack

Next.js 15 (App Router, server actions) · PostgreSQL + Drizzle ORM ·
Tailwind CSS v4 · session-cookie auth with seeded users · Railway.

No Redis, no queue, no job runner. A cron route plus webhooks is enough at
20–30 active contracts.

There is **no Upwork API integration** and none is planned: Upwork exposes no
proposal or Connects data, so everything is typed in by the team. That is why
message activity is two one-click stamps and bids are four numbers a week.

## Setup

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL at minimum
npm run db:migrate          # apply drizzle/*.sql
npm run db:seed             # realistic fake data, all four accounts
npm run dev
```

Sign in with any seeded email (`mir@agency.test` is the owner) and the
password printed by the seed script.

### Local Postgres without an install

The repo assumes a `DATABASE_URL`. If you have no Postgres on the machine and
no admin rights, `scripts/pg.sh` drives a portable server unpacked under
`~/pgportable` (no installer, no service, no elevation):

```bash
bash scripts/pg.sh start     # initdb on first run, then start on port 55432
bash scripts/pg.sh stop
bash scripts/pg.sh psql
```

That server is a dev convenience only. Production is Railway Postgres.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` | Production build. Deliberately **not** `--turbopack`: on 15.5.25 the Turbopack build breaks server actions submitted as a plain form post (no JS), with `Cannot read properties of undefined (reading 'bind')`. The webpack build handles them correctly. |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Truncate and reseed (deterministic) |
| `npm run db:reset` | Truncate every table, keep the schema |
| `npm run db:studio` | Drizzle Studio |

## Shape of the code

```
src/db/schema.ts        every table, one file
src/db/seed.ts          fake data engineered to hit every alert rule
src/lib/site-map.ts     every screen and who may open it — nav, access and /map read this
src/lib/permissions.ts  every access decision in the product
src/lib/pipelines.ts    stage pipelines, per niche, in code not in the database
src/lib/history.ts      outcomes for work that closed before the CRM existed
src/lib/password.ts     scrypt via node:crypto, no native dependency
src/components/shell.tsx  PageHead / Panel / PanelTitle — the furniture every screen is built from
src/app/globals.css     the whole palette, the radius scale and the page backdrop
drizzle/                generated migrations, committed
```

### One trap worth knowing

**Do not call `revalidatePath` from a server action that a form on the same
screen invokes.** Next re-renders the current route into the action response
and, in this app, that render never finishes: `useActionState` never settles
and the button sits on "Saving…" forever. Every form here refreshes from the
client with `router.refresh()` once its result lands. See
`src/lib/actions/history.ts` and `useRefreshOnSuccess` in
`src/components/contract-forms.tsx`.

## Interface

Light mode sits on a soft blue-grey, never white, with white panels floating
on it and a fixed backdrop of two colour blooms and a hairline grid. Both
themes are defined in `src/app/globals.css`; one radius scale drives every
corner in the product, so changing `--radius-*` there changes all of them.

Colour carries exactly three meanings and nothing else: red is late, gold is
approaching, green is finished. Four account hues identify the Upwork profiles
and are used nowhere else.

## Out of scope for v1

Time tracking, invoicing, proposal or bid management, a client-facing portal,
file storage, chat replies from inside the app, revenue forecasting, and AI
features. Upwork has no API for submitting proposals or spending Connects;
bidding stays manual in the Upwork UI.

## Deploying

The build never needs a database. `src/db/index.ts` builds its pool on the
first query rather than at import, so `next build` compiles with no
`DATABASE_URL` at all — a pool created at module scope makes the build itself
require a reachable database, which is exactly how the first Vercel deploy
failed.

What the running app needs:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | A **hosted** Postgres — Neon, Supabase, Railway, Vercel Postgres. The portable server in `scripts/pg.sh` listens on 127.0.0.1 and is not reachable from a deploy. On a serverless host use the provider's *pooled* connection string. |
| `APP_URL` | for Telegram | The deployment's public URL. Deep links in notifications use it. |
| `TELEGRAM_ENABLED` | no | Leave unset or `false` and messages go to the log instead of Telegram. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME` | only if enabled | Without all three the webhook is not registered and the app says so in the log. |
| `CRON_SECRET` | for the alert cron | Bearer token `/api/cron/alerts` checks. |

Migrations do not run on deploy. Point `DATABASE_URL` at the hosted database
once and run them yourself:

```bash
DATABASE_URL='postgresql://…' npm run db:migrate
DATABASE_URL='postgresql://…' npm run db:seed     # first deploy only
```

`npm warn allow-scripts` in a deploy log is noise, not a failure: npm now
declines to run install scripts by default, and nothing in the build needs
them. A clean `npm ci --ignore-scripts` builds fine.
