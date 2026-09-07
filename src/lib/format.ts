const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Whole dollars. Cents are noise at the scale this board reports. */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return usd0.format(value);
}

/** "$12.4k" for tiles, where the column is narrow and the trend is the point. */
export function moneyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) < 1000) return usd0.format(value);
  const k = value / 1000;
  const digits = Math.abs(k) < 10 ? 1 : 0;
  return `$${k.toFixed(digits)}k`;
}

export type Delta = { text: string; direction: "up" | "down" | "flat" };

/** Month over month, stated as a change rather than a percentage of nothing. */
export function delta(current: number, previous: number): Delta {
  if (previous === 0 && current === 0) return { text: "no change", direction: "flat" };
  if (previous === 0) return { text: "first month with any", direction: "up" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "level with last month", direction: "flat" };
  return {
    text: `${pct > 0 ? "+" : ""}${pct}% on last month`,
    direction: pct > 0 ? "up" : "down",
  };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
