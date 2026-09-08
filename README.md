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
Tailwind CSS v4 · session-cookie auth with seeded users · Vercel.

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

That server is a dev convenience only. Production is a hosted Postgres reached
from Vercel over a pooled connection string.

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
| `npm run check` | Every check below, in order |
| `npm run check:shift` | The 6pm-to-6am shift arithmetic. Pure functions, no database. |
| `npm run check:bot` | Drives the Telegram bot end to end against the local database — buttons, replies, permissions — with the console transport, so nobody is messaged. |
| `npm run check:cron` | Runs the cron route twice and asserts the second run repeats nothing. |

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

**A server action that a form on the screen invokes must not call
`revalidatePath` at all** — not for the current route, and not for any other
route either. Next attaches a re-render of the current tree to the action
response, the client never applies it, `useActionState` never settles, and the
button sits on "Saving…" for ever. The server is not the problem: it finishes
the work and answers 200 with a complete, valid payload in about 110ms.

Measured on a clean production build, posting an update on `/contracts/[id]`:

| `revalidatePath` in the action | Hung |
|---|---|
| `"/today"` and `"/"` | 10 / 10 |
| `"/today"` only | 10 / 10 |
| `"/"` only | 10 / 10 |
| none | 0 / 10 |

Only production is affected; `next dev` settles every time, which is what makes
this so easy to reintroduce.

So actions revalidate nothing and return their result, and the screen refreshes
itself with `useRefreshOnSuccess` (`src/components/use-refresh-on-success.ts`)
once that result lands. Every other screen is dynamic, so navigating to one
refetches it anyway. An action that ends in `redirect()` is the one exception —
the response is a redirect, so it may still revalidate.

**Still open:** the same failure affects the forms on `/today` (bulk assign),
and there it is *not* caused by `revalidatePath` — an action that returns
immediately, touching neither the database nor the cache, still hangs on that
screen. That one is unsolved and predates this fix.

## Interface

Light mode sits on a soft blue-grey, never white, with white panels floating
on it and a fixed backdrop of two colour blooms and a hairline grid. Both
themes are defined in `src/app/globals.css`; one radius scale drives every
corner in the product, so changing `--radius-*` there changes all of them.

Colour carries exactly three meanings and nothing else: red is late, gold is
approaching, green is finished. Four account hues identify the Upwork profiles
and are used nowhere else.

## The Telegram bot

The office shift is **6pm to 6am Pakistan time, Monday to Friday**, and two
different clocks follow from that. Both live in `src/lib/time.ts`.

- **The rule clock** (`isInShift`, `workingMsBetween`) counts Monday to Friday
  nights only. Alert thresholds measure against it, so a client who writes at
  9am on Saturday has not burned two working days by Monday evening — nobody
  was rostered to answer.
- **The delivery clock** (`isOffShiftPkt`) holds messages between 6am and 6pm
  *every* night, weekends included, because the team watches the work from home
  at the weekend. A message held on Saturday goes out at 6pm on Saturday, not
  on Monday.

The window crosses midnight, which is the one thing every helper in that file
has to respect. `npm run check:shift` pins the arithmetic down.

### What it can do

Alerts arrive as cards with buttons, so the answer happens in the chat rather
than needing a laptop: **✓ Replied**, **Post update**, **Set next action**,
**Snooze**, **Note**, **I'll take it**, **Hand to…**. A snooze asks how long
and then why — the reason is required here exactly as it is on the board.

| Command | Does |
|---|---|
| `/today` | Everything outstanding across the agency |
| `/mine` | The same, narrowed to you |
| `/find x` | Contracts and clients by name; tap one for its card |
| `/bids` | Enter this week's bid counts |
| `/help` | The list |

Replying to any message the bot sent about a contract, with no command, saves
that text as a note on it.

On a schedule: a **shift brief** at 6pm and a **sweep** at 5am, both per
person and both silent when there is nothing outstanding; the **bid prompt**
on Monday at 7pm; an **undelivered report** to Mir on Monday at 8pm listing
anyone the product tried and failed to reach.

An alert nobody answers is **re-sent every four hours to the whole team** until
it resolves or somebody snoozes it with a reason. Before this an alert was sent
once and then went quiet forever, which meant the product's one job stopped the
moment the first message was ignored.

### Two things to know before changing it

**Identity comes from `from.id`, never from the chat id.** In a private chat
they are the same number; in a group they are not, and resolving a button press
by the chat id would make every button in the team group act as whoever the
group is, which is nobody. Message *context* is the other way round — looked up
by chat id, because that is what the delivery log is keyed on.

**Callback data is not authority.** It is typed by whoever holds the phone and
is worth exactly as much as a URL query string: it names a record, it grants
nothing. Every write goes through `src/lib/ops`, which asks `lib/permissions`
the same questions the web forms ask. That shared layer is why the bot and the
screens cannot drift apart — `check:bot` asserts a sales executive is refused
an edit on a record they did not create, through the bot.

Telegram gives 64 bytes of callback data, so ids travel with their dashes
stripped and two of them do not fit. Where a button needs a second id, it is
recovered from the message the button is attached to.

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
| `TELEGRAM_GROUP_CHAT_ID` | no | The team group. Unowned alerts, the four-hourly nudges, contract and handover announcements and the shift-start summary post here. Group ids are **negative** — a value without the minus sign silently addresses a private chat that does not exist. Unset means none of it is sent. |

Migrations do not run on deploy. Point `DATABASE_URL` at the hosted database
once and run them yourself:

```bash
DATABASE_URL='postgresql://…' npm run db:migrate
DATABASE_URL='postgresql://…' npm run db:seed     # first deploy only
```

`npm warn allow-scripts` in a deploy log is noise, not a failure: npm now
declines to run install scripts by default, and nothing in the build needs
them. A clean `npm ci --ignore-scripts` builds fine.

### Passwords

The seed gives all six accounts the same password and that password is in this
repository — fine for a local database of invented clients, not fine for a
deployment anyone can reach. Set real ones before sharing the URL:

```bash
# everybody at once, printed once, never written to a file
DATABASE_URL='postgresql://…' npm run set-password -- --all-random

# or one person, typed in and hidden
DATABASE_URL='postgresql://…' npm run set-password -- mir@agency.test
```

Changing a password signs that person out everywhere.

Day to day nobody needs this: **Settings → Your password** lets each person
change their own, which asks for the current one first — a session can be
borrowed, and the one thing a borrowed session must not be able to do is lock
the real owner out. The script is for the two cases a screen cannot cover:
seeding a new deployment, and getting somebody back in who is locked out.

### Telegram: one bot, one webhook

A Telegram bot can have exactly **one** webhook URL, so whichever server booted
last owns it. Starting a local server with `TELEGRAM_ENABLED=true` silently
repoints the bot away from production, and `/start <code>` then goes nowhere —
the code looks unrecognised when in fact the reply had no route home.

So `.env` keeps `TELEGRAM_ENABLED=false` locally: messages print to the console
and the webhook is left alone. Flip it to `true` only while deliberately
testing the bot against a tunnel, and redeploy production afterwards to take
the webhook back.

Check who owns it at any time:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

The deployment needs `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME` and an `APP_URL` pointing at
itself. Miss any one and Settings shows "Test mode" and no webhook is
registered. Leave `TELEGRAM_FORCE_IPV6` unset on a host — it exists for
networks that filter Telegram's IPv4 range.

#### On Vercel specifically

`src/instrumentation.ts` registers the webhook at server start, which on a
long-running server means once. Vercel has no such moment: `register()` runs on
each **cold start** of a serverless instance, so it does not run at deploy time
at all — it runs when the first request arrives, and again after every scale to
zero.

Two consequences.

**Scope the Telegram variables to Production.** Vercel applies environment
variables to Preview and Development too unless told otherwise, and every
preview deployment runs the same registration code. One request to a preview
URL would repoint the live bot at that preview and production would go quiet —
no error, nothing in the log, just a bot that stopped answering. `register()`
now refuses to touch the webhook whenever `VERCEL_ENV` is anything but
`production`, so forgetting is survivable, but scoping is the actual fix.

**Register it yourself after a deploy** rather than waiting for a cold start:

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'content-type: application/json' \
  -d '{"url":"https://syrexiocrm.vercel.app/api/telegram/webhook",
       "secret_token":"'"$TELEGRAM_WEBHOOK_SECRET"'",
       "allowed_updates":["message","callback_query"]}'
```

`allowed_updates` must list **`callback_query`**. Without it Telegram accepts
every button press and silently delivers none of them, which looks exactly like
buttons that do nothing. Check what is actually registered with `getWebhookInfo`.

`APP_URL` must be the stable production domain. Vercel's own `VERCEL_URL` is
per-deployment, so a deep link built from it rots the moment you redeploy.

### The alert engine needs a scheduler

`/api/cron/alerts` is the clock the product runs on: it recomputes every rule,
messages the owner of anything newly late, escalates deadlines inside their
final hour, and releases what was held overnight. Nothing in the app calls it.
Without a scheduler the board freezes at whatever it looked like on the last
page load, and Telegram never fires.

Vercel's Hobby plan allows a cron **one run per day**, which is useless for a
product whose job is telling you something is late, so the schedule lives in
GitHub Actions instead: `.github/workflows/alerts.yml`, every 15 minutes.

Two things must match:

| Where | Name | Value |
|---|---|---|
| Vercel → Environment Variables | `CRON_SECRET` | the shared secret |
| GitHub → Settings → Secrets and variables → Actions | `CRON_SECRET` | the same string |

Mismatch and every run fails with a 403, loudly, in the Actions tab — a cron
that fails silently is worse than none, because the board looks calm while
nothing is being recomputed.

**Run it silently the first time.** Actions → Alert engine → Run workflow, with
`silent` ticked. That opens alerts for everything already late without
messaging anyone, so nobody wakes up to a dozen notifications about problems
that are days old. Every run after that notifies normally.

Two GitHub caveats: scheduled runs are queued and can be a few minutes late
under load (harmless — the thresholds are hours), and GitHub disables schedules
on a repository with no activity for 60 days.

### Owner mode

The owner's account looks like everybody else's. No role on the header chip,
no Access column on People, no admin blocks on Settings — the same screens a
sales executive sees, word for word.

A blank 24px square sits at the end of the header row. Click it **three times
within about a second** and the owner-only controls appear; three more clicks,
or a page refresh, and they are gone again. It survives moving between screens,
because that is ordinary navigation rather than a reload.

It is a **display** state and nothing else. `lib/permissions.ts` still decides
every access question and still knows the owner is the owner — `OwnerOnly`
hides controls on a screen, it does not grant or withhold anything. The threat
it answers is somebody glancing at the screen in an open-plan office, not
somebody holding the session. Anyone who can read the page's data can see what
it hides.

While it is on the interface says so in three places at once: a brand rail
across the very top of the window, the header chip switching to the brand
accent and naming the role, and a ring around each panel that is only there
because of it. Toggling also flashes "Owner mode on" or "off" in the bottom
right for a second — bottom right rather than beside the trigger, because the
header wraps to two and three rows as the window narrows.

Kept in React state on purpose: nothing is written to storage, so there is no
flag that can get stuck on, no cookie to go stale, and a refresh is always the
way out. `OwnerModeTrigger` is inert for anyone who is not the owner, and the
square is rendered for everybody so its absence never says who the owner is.
