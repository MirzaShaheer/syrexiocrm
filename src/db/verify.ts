/**
 * Prints the four Today buckets straight from SQL, so the seed can be checked
 * before any UI exists. `npx tsx src/db/verify.ts`
 */
import "dotenv/config";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "./index";
import { accounts, alerts, clients, contracts, milestones, users } from "./schema";

const NOW = new Date();
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const hoursAgo = (h: number) => hoursFromNow(-h);

const activeContract = and(
  eq(contracts.status, "active"),
  eq(contracts.archived, false),
);

async function main() {
  const waiting = await db
    .select({
      account: accounts.label,
      title: contracts.title,
      client: clients.name,
      owner: users.name,
      waitedHours: sql<number>`round(extract(epoch from (now() - ${contracts.lastClientMessageAt})) / 3600)`,
    })
    .from(contracts)
    .innerJoin(accounts, eq(accounts.id, contracts.accountId))
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .leftJoin(users, eq(users.id, contracts.ownerUserId))
    .where(
      and(
        activeContract,
        sql`${contracts.lastClientMessageAt} is not null`,
        or(
          isNull(contracts.lastTeamMessageAt),
          sql`${contracts.lastClientMessageAt} > ${contracts.lastTeamMessageAt}`,
        ),
      ),
    )
    .orderBy(asc(contracts.lastClientMessageAt));

  const dueMilestones = await db
    .select({
      account: accounts.label,
      title: contracts.title,
      milestone: milestones.title,
      status: milestones.status,
      dueInHours: sql<number>`round(extract(epoch from (${milestones.dueAt} - now())) / 3600)`,
      nothingSubmitted: sql<boolean>`${milestones.status} = 'pending'`,
    })
    .from(milestones)
    .innerJoin(contracts, eq(contracts.id, milestones.contractId))
    .innerJoin(accounts, eq(accounts.id, contracts.accountId))
    .where(
      and(
        activeContract,
        sql`${milestones.status} in ('pending', 'submitted')`,
        gte(milestones.dueAt, NOW),
        lte(milestones.dueAt, hoursFromNow(48)),
      ),
    )
    .orderBy(asc(milestones.dueAt));

  const noUpdate = await db
    .select({
      account: accounts.label,
      title: contracts.title,
      owner: users.name,
      lastUpdateHours: sql<number>`round(extract(epoch from (now() - ${contracts.lastUpdateAt})) / 3600)`,
    })
    .from(contracts)
    .innerJoin(accounts, eq(accounts.id, contracts.accountId))
    .leftJoin(users, eq(users.id, contracts.ownerUserId))
    .where(
      and(
        activeContract,
        or(
          isNull(contracts.lastUpdateAt),
          lte(contracts.lastUpdateAt, hoursAgo(24)),
        ),
      ),
    )
    .orderBy(asc(contracts.lastUpdateAt));

  const unassigned = await db
    .select({
      account: accounts.label,
      title: contracts.title,
      client: clients.name,
      ageHours: sql<number>`round(extract(epoch from (now() - ${contracts.startedAt})) / 3600)`,
    })
    .from(contracts)
    .innerJoin(accounts, eq(accounts.id, contracts.accountId))
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .where(and(activeContract, isNull(contracts.ownerUserId)))
    .orderBy(asc(contracts.startedAt));

  const openAlerts = await db
    .select({
      rule: alerts.ruleKey,
      count: sql<number>`count(*)::int`,
    })
    .from(alerts)
    .where(isNull(alerts.resolvedAt))
    .groupBy(alerts.ruleKey)
    .orderBy(asc(alerts.ruleKey));

  console.log("\n1. Client waiting on a reply");
  console.table(waiting);
  console.log("\n2. Milestones due in 48 hours");
  console.table(dueMilestones);
  console.log("\n3. No update posted in 24 hours");
  console.table(noUpdate);
  console.log("\n4. New contract, no owner set");
  console.table(unassigned);
  console.log("\nOpen alerts by rule");
  console.table(openAlerts);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
