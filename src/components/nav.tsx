"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/site-map";

/**
 * The main navigation, in the order the day is worked. It reads its items from
 * lib/site-map.ts, so a screen cannot exist without appearing on the map, and
 * cannot appear on the map without being reachable.
 *
 * The current screen is a filled pill rather than a coloured word: colour in
 * this product means late, soon or finished, and "you are here" is none of
 * those.
 */
export function Nav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-wrap items-center gap-0.5">
      {NAV.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-sm px-2.5 py-1.5 text-[13px] leading-none ${
              active
                ? "bg-surface-2 font-medium text-ink"
                : "text-muted hover:bg-surface hover:text-ink-2"
            }`}
          >
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
