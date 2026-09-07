import Link from "next/link";
import type { Tone } from "@/lib/alert-rules";
import { accountColor } from "@/lib/account-colors";

/**
 * Row primitives for every list in the product.
 *
 * The hierarchy is fixed here so it cannot drift screen to screen: the
 * contract title is the only thing at full ink, the metadata line is 12px
 * muted, and the number on the right is the only coloured thing on the row.
 */

const toneClass: Record<Tone, string> = {
  plain: "text-muted",
  soon: "text-soon font-semibold",
  late: "text-late font-semibold",
};

/** Fixed width, so every title on every row starts at the same x. */
export const BADGE_W = "w-[58px]";

export function AccountBadge({ label }: { label: string }) {
  const c = accountColor(label);
  return (
    <span
      className={`${BADGE_W} inline-block shrink-0 truncate rounded-sm px-1 py-[2px] text-center text-[10.5px] leading-[14px] font-semibold`}
      style={{ backgroundColor: c.tint, color: c.ink }}
    >
      {label}
    </span>
  );
}

/**
 * The failure clock. Always a duration, never a status, and it takes its
 * colour from the same measure it prints — never from a different fact.
 */
export function Clock({ value, tone }: { value: string; tone: Tone }) {
  return (
    <span
      className={`num w-[46px] shrink-0 text-right text-[13px] ${toneClass[tone]}`}
    >
      {value}
    </span>
  );
}

/** Counts at the top of a list. Quieter than the rows they summarise. */
export function CountCard({
  label,
  count,
  href,
  tone = "plain",
}: {
  label: string;
  count: number;
  href: string;
  tone?: Tone;
}) {
  return (
    <Link
      href={href}
      className="tile flex flex-col gap-1 px-3.5 py-3"
    >
      <span
        className={`num text-[20px] leading-none font-semibold ${
          count === 0 ? "text-muted" : toneClass[tone]
        }`}
      >
        {count}
      </span>
      <span className="text-[12px] text-muted">{label}</span>
    </Link>
  );
}

/**
 * Section headings are a small uppercase label, deliberately quieter than the
 * contract titles beneath them. In the audit they were one weight step from
 * the rows, so the container and its contents read as the same kind of thing.
 */
export function Section({
  title,
  note,
  isEmpty,
  empty,
  children,
}: {
  title: string;
  note?: string;
  isEmpty: boolean;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <h2
        id={slug(title)}
        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] font-semibold tracking-[0.07em] text-muted uppercase"
      >
        {title}
        {note ? (
          <span className="text-[11.5px] font-normal tracking-normal normal-case">
            {note}
          </span>
        ) : null}
      </h2>
      <div className="mt-1.5">{isEmpty ? empty : <ul>{children}</ul>}</div>
    </section>
  );
}

export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Account chip, then title and client, then a quiet second line, then the
 * clock. On a narrow screen the title wraps but the chip stays pinned left
 * and the clock stays pinned right, so account and lateness never scroll away.
 */
export function Row({
  account,
  title,
  client,
  href,
  owner,
  reason,
  clock,
  action,
}: {
  account: string;
  title: string;
  client: string;
  href: string;
  owner: string;
  reason: string;
  clock: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li className="border-t border-line first:border-t-0">
      <div className="rowlink flex flex-wrap items-start gap-x-3 gap-y-2 py-2.5">
        <span className="pt-[3px]">
          <AccountBadge label={account} />
        </span>

        <div className="min-w-0 flex-1">
          <Link href={href} className="block hover:underline">
            <span className="text-[13.5px] font-medium text-ink">{title}</span>
            <span className="text-[13px] text-muted"> · {client}</span>
          </Link>
          <p className="mt-0.5 text-[12px] text-muted">
            <span className="font-medium text-ink-2">{owner}</span> · {reason}
          </p>
        </div>

        {/*
          On a phone the control drops to its own line, indented to the title,
          rather than squeezing the title into 40% of the row. On a wide screen
          `order-none` restores document order and it sits inline, just left of
          the clock, which stays hard right in both cases.
        */}
        {action ? (
          <div className="order-last w-full pl-[70px] sm:order-none sm:w-auto sm:shrink-0 sm:pl-0">
            {action}
          </div>
        ) : null}

        {clock}
      </div>
    </li>
  );
}

/**
 * Every list gets one of these rather than "Nothing here." It says what would
 * appear, and offers the thing that creates it.
 */
export function EmptyState({
  what,
  next,
  action,
}: {
  what: string;
  next: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-4">
      <p className="text-[13px] text-ink-2">{what}</p>
      <p className="mt-0.5 text-[12px] text-muted">{next}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Links are ink with an underline, never a colour. */
export function Quiet({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2 hover:decoration-ink-2"
    >
      {children}
    </Link>
  );
}
