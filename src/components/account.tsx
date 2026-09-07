import Link from "next/link";
import type { AccountRollup, Health } from "@/lib/queries/overview";
import { NICHE_LABELS } from "@/lib/pipelines";
import { moneyCompact } from "@/lib/format";
import { accountColor } from "@/lib/account-colors";

/**
 * The account's own colour identifies it — the left rule and the label. Health
 * is told only in the lateness palette, on the alert count and the status
 * line, so identity and urgency never use the same colour on the same tile.
 */
const HEALTH: Record<Health, { word: string; tone: string }> = {
  clear: { word: "Clear", tone: "text-muted" },
  watch: { word: "Watch", tone: "text-soon" },
  problem: { word: "Needs attention", tone: "text-late" },
  broken: { word: "Sync failing", tone: "text-late" },
};

export function AccountTile({ a }: { a: AccountRollup }) {
  const c = accountColor(a.label);
  const h = HEALTH[a.health];
  const alertTone =
    a.alertContracts === 0
      ? "text-muted"
      : a.health === "watch"
        ? "text-soon"
        : "text-late";

  return (
    <Link
      href={`/accounts/${a.id}`}
      className="tile flex flex-col gap-3 border-l-[3px] p-4"
      style={{ borderLeftColor: c.ink }}
    >
      <span className="block">
        <span
          className="block truncate text-[16px] leading-tight font-semibold"
          style={{ color: c.ink }}
        >
          {a.label}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted">
          {NICHE_LABELS[a.niche]} · {a.market === "us" ? "US" : "Pakistan"}
        </span>
      </span>

      <span className="grid grid-cols-3 gap-2">
        <Stat n={a.activeContracts} label="active" />
        <Stat n={a.alertContracts} label="in alert" tone={alertTone} />
        <Stat
          text={moneyCompact(a.wipValue)}
          label="fixed"
          fig
          hint={a.hourlyContracts > 0 ? `+${a.hourlyContracts} hourly` : ""}
        />
      </span>

      <span className={`text-[11.5px] ${h.tone}`}>
        {a.health === "broken"
          ? "Reconnect needed"
          : a.unassigned > 0
            ? `${a.unassigned} with no owner`
            : h.word}
      </span>
    </Link>
  );
}

function Stat({
  n,
  text,
  label,
  tone = "text-ink",
  hint,
  fig,
}: {
  n?: number;
  text?: string;
  label: string;
  tone?: string;
  hint?: string;
  fig?: boolean;
}) {
  return (
    <span className="block min-w-0">
      <span className={`${fig ? "fig" : "num"} block text-[18px] leading-none font-semibold ${tone}`}>
        {text ?? n}
      </span>
      <span className="mt-1 block text-[10.5px] leading-tight text-muted">
        {label}
      </span>
      {/* Always present, so the status line sits at the same height on every
          tile whether or not the account has hourly work. */}
      <span className="mt-0.5 block min-h-[13px] text-[10.5px] leading-tight text-muted">
        {hint}
      </span>
    </span>
  );
}
