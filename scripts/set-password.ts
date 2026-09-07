/**
 * Sets a real password for one person, or for everybody at once.
 *
 * The seed gives all six accounts the same password, and that password is
 * committed to the repository — fine for a local database full of invented
 * clients, not fine for a deployment anyone can reach. This is how a real one
 * gets set, and it works against the live database the same way the migration
 * does:
 *
 *   npm run set-password -- mir@agency.test            prompts, twice, hidden
 *   npm run set-password -- mir@agency.test --random   generates and prints one
 *   npm run set-password -- --all-random               a fresh one for each person
 *
 *   DATABASE_URL='postgresql://…' npm run set-password -- --all-random
 *
 * Changing a password signs that person out everywhere, because a password
 * you have changed should not leave an old session standing.
 */
import "dotenv/config";
import { randomInt } from "node:crypto";
import { createInterface } from "node:readline";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../src/db/index";
import { sessions, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/password";

const MIN_LENGTH = 12;

/**
 * No look-alike characters. These get read off a screen and typed into a phone
 * at least once, and 1/l/I and 0/O cost more support time than the entropy is
 * worth.
 */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generate(length = 20): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/**
 * Reads a line without echoing it. `_writeToOutput` is readline's own internal
 * hook and the only way to suppress the echo without pulling in a dependency;
 * it is stable, and this is a maintenance script rather than product code.
 */
function askHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (
      s: string,
    ) => {
      if (s.includes(query)) process.stdout.write(s);
    };
    rl.question(query, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function setFor(
  user: { id: string; name: string; email: string },
  password: string,
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, user.id));
  // Any session opened with the old password is no longer trustworthy.
  await db.delete(sessions).where(eq(sessions.userId, user.id));
}

async function main() {
  const args = process.argv.slice(2);
  const allRandom = args.includes("--all-random");
  const random = args.includes("--random");
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();

  if (!allRandom && !email) {
    console.error(
      "Which account? e.g. npm run set-password -- mir@agency.test\n" +
        "Or npm run set-password -- --all-random for everybody.",
    );
    process.exit(1);
  }

  if (allRandom) {
    const team = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name));

    if (!team.length) {
      console.error("No active users. Has the database been seeded?");
      process.exit(1);
    }

    const issued: { name: string; email: string; password: string }[] = [];
    for (const person of team) {
      const password = generate();
      await setFor(person, password);
      issued.push({ name: person.name, email: person.email, password });
    }

    console.log("\nNew passwords. Shown once — hand each person their own.\n");
    const width = Math.max(...issued.map((i) => i.email.length));
    for (const i of issued) {
      console.log(`  ${i.email.padEnd(width)}  ${i.password}   (${i.name})`);
    }
    console.log(
      `\n${issued.length} updated, and everyone has been signed out.\n` +
        "Nothing was written to a file. Copy them now.",
    );
    return;
  }

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.email, email!))
    .limit(1);

  if (!user) {
    const known = await db
      .select({ email: users.email })
      .from(users)
      .where(inArray(users.active, [true]))
      .orderBy(asc(users.email));
    console.error(
      `No account for ${email}.\nAccounts: ${known.map((k) => k.email).join(", ")}`,
    );
    process.exit(1);
  }

  let password: string;
  if (random) {
    password = generate();
  } else {
    password = await askHidden(`New password for ${user.name} (${user.email}): `);
    if (password.length < MIN_LENGTH) {
      console.error(`Too short — ${MIN_LENGTH} characters minimum.`);
      process.exit(1);
    }
    const again = await askHidden("Again: ");
    if (again !== password) {
      console.error("Those did not match. Nothing was changed.");
      process.exit(1);
    }
  }

  await setFor(user, password);

  if (random) {
    console.log(`\n${user.email}\n${password}\n\nShown once. Copy it now.`);
  } else {
    console.log(`\nPassword updated for ${user.name}.`);
  }
  console.log("Any existing session for them has been signed out.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
