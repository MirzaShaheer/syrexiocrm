import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, getCurrentUser } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";

export const metadata = { title: "Sign in" };

async function signIn(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // One message for every failure. Do not confirm which emails exist.
  const failed = "?error=1";
  if (!user || !user.active) redirect(`/login${failed}&email=${encodeURIComponent(email)}`);
  if (!(await verifyPassword(password, user.passwordHash))) {
    redirect(`/login${failed}&email=${encodeURIComponent(email)}`);
  }

  await createSession(user.id);
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { error, email } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-[380px] flex-col justify-center px-6">
      <div className="panel">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[17px] leading-none font-semibold tracking-[-0.01em] text-ink">
            Syrexio
          </span>
          <span className="text-[10.5px] leading-none font-semibold tracking-[0.12em] text-muted uppercase">
            CRM
          </span>
        </div>
        <p className="mt-2 text-[12.5px] text-muted">
          Internal use. Accounts are created by the owner.
        </p>

        <form action={signIn} className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            autoFocus
            defaultValue={email ?? ""}
            className="rounded-sm border border-line-strong bg-raised px-2.5 py-2 text-ink"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-muted">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded-sm border border-line-strong bg-raised px-2.5 py-2 text-ink"
          />
        </label>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-line border-l-[3px] border-l-late bg-surface px-3 py-2 font-medium text-ink"
          >
            That email and password do not match. Check both and try again.
          </p>
        ) : null}

          <button
            type="submit"
            className="btn-primary mt-1 px-3 py-2 font-medium"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
