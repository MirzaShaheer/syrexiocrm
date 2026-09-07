import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import type { Role } from "@/lib/permissions";

export const SESSION_COOKIE = "crm_session";
const SESSION_DAYS = 30;

/** The cookie holds the raw token; the table holds only its hash. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  // Opportunistic cleanup. At this scale it is cheaper than a cron entry.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** End of a live admin grant, or null. See lib/permissions.ts. */
  adminUntil: Date | null;
};

/** Deduplicated per request, so the shell and the page share one query. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      adminUntil: users.adminUntil,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())),
    )
    .limit(1);

  if (!row || !row.active) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    adminUntil: row.adminUntil,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Everyone reads everything, so there is no read-scoping helper any more.
 * What a user may *change* is decided in lib/permissions.ts, which takes a
 * CurrentUser directly — it satisfies the Actor shape.
 */
