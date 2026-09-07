"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AccountRef } from "@/lib/queries/account";

/**
 * Persistent in the header on every screen. Moving between accounts is one
 * click from anywhere and never requires going back to the root, and the
 * current context is always named.
 */
export function AccountSwitcher({ accounts }: { accounts: AccountRef[] }) {
  const pathname = usePathname();
  const match = pathname.match(/^\/accounts\/([^/]+)/);
  const currentId = match?.[1];

  return (
    <nav
      aria-label="Account"
      className="flex items-center gap-1 overflow-x-auto py-0.5"
    >
      <Tab href="/" active={!currentId}>
        All accounts
      </Tab>
      {accounts.map((a) => (
        <Tab key={a.id} href={`/accounts/${a.id}`} active={a.id === currentId}>
          {a.label}
        </Tab>
      ))}
    </nav>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[12px] whitespace-nowrap ${
        active
          ? "border-line-strong bg-raised font-medium text-ink shadow-[var(--shadow-sm)]"
          : "border-transparent text-muted hover:border-line hover:bg-raised hover:text-ink-2"
      }`}
    >
      {children}
    </Link>
  );
}
