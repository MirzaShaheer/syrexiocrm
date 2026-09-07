/** Drops every row without dropping the schema. `npm run db:reset` */
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

async function main() {
  await db.execute(sql`
    truncate table
      ${alerts}, ${events}, ${updates}, ${milestones}, ${contracts},
      ${clients}, ${sessions}, ${syncRuns}, ${accounts}, ${users}
    restart identity cascade
  `);
  console.log("All tables truncated.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
