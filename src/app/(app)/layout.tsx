import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/lib/actions/session";
import { getAccountRefs } from "@/lib/queries/account";
import { AccountSwitcher } from "@/components/account-switcher";
import { Nav } from "@/components/nav";
import { Search } from "@/components/search";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  OwnerModeProvider,
  OwnerModeTrigger,
  OwnerOnly,
} from "@/components/owner-mode";
import { ROLE_LABELS, hasLiveAdminGrant, isOwner } from "@/lib/permissions";

/**
 * Two rows on purpose. The top row is where you are in the product; the
 * second is which account you are looking at, and it is present on every
 * screen — a contract row means nothing until you know which of the four
 * accounts it came from.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const accounts = await getAccountRefs();
  const elevated = hasLiveAdminGrant(user);

  return (
    <OwnerModeProvider canUnlock={isOwner(user)}>
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-raised/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-2.5 sm:px-6">
          <Link
            href="/"
            className="mr-1 flex items-baseline gap-1.5 rounded-sm px-1 py-1"
          >
            <span className="text-[15px] leading-none font-semibold tracking-[-0.01em] text-ink">
              Syrexio
            </span>
            <span className="text-[10.5px] leading-none font-semibold tracking-[0.12em] text-muted uppercase">
              CRM
            </span>
          </Link>

          <Nav />

          <div className="ml-auto flex items-center gap-2 text-[12px] text-muted">
            <Suspense
              fallback={
                <span className="inline-block h-8 w-[92px] rounded-sm border border-line bg-raised" />
              }
            >
              <Search />
            </Suspense>

            <Link
              href="/contracts/new"
              className="btn-primary min-h-8 px-3 py-1.5 text-[12px] font-medium"
            >
              New contract
            </Link>

            <ThemeToggle />

            <Link
              href="/settings"
              className="rounded-sm px-2 py-1.5 leading-none hover:bg-surface hover:text-ink-2"
            >
              Settings
            </Link>

            {/*
              Just the name. No role for anyone, so no screen advertises whose
              account can do more than anyone else's — the role is still on the
              People page, where it is a fact about the team rather than a
              label on the person holding the laptop.
            */}
            <span className="hidden items-baseline gap-1.5 rounded-sm border border-line bg-raised px-2 py-1.5 leading-none lg:flex">
              <span className="font-medium text-ink-2">{user.name}</span>
              <OwnerOnly>
                <span className="text-muted">{ROLE_LABELS[user.role]}</span>
              </OwnerOnly>
              {elevated ? (
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-2">
                  elevated
                </span>
              ) : null}
            </span>

            <form action={signOut}>
              <button
                type="submit"
                className="rounded-sm px-2 py-1.5 leading-none hover:bg-surface hover:text-ink-2"
              >
                Sign out
              </button>
            </form>

            {/* The blank square. Last thing on the row, so it is genuinely the
                top right corner and never overlaps a real control. */}
            <OwnerModeTrigger />
          </div>
        </div>

        <div className="mx-auto max-w-[1240px] px-2 pb-2 sm:px-4">
          <AccountSwitcher accounts={accounts} />
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">{children}</main>
    </div>
    </OwnerModeProvider>
  );
}
