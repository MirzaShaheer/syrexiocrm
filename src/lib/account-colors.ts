/**
 * The one place in the product where colour is decorative rather than
 * semantic. It earns that because account identity is otherwise invisible —
 * a contract row means nothing until you know which of the four it came from.
 *
 * Four hues roughly 90 degrees apart, so they separate at a glance, and each
 * at a different lightness, so they also separate for anyone with colour
 * blindness. Never used for anything but an account.
 *
 * The actual values live in globals.css as `--acc-N-ink` / `--acc-N-tint`,
 * once for light and once for dark. This module only decides which slot an
 * account gets, so a badge rendered inline still follows the theme.
 */

export type AccountColor = {
  /** Label text, and the tile rule. */
  ink: string;
  /** Chip background. */
  tint: string;
};

/** Slot 1 blue, 2 teal, 3 magenta, 4 orange. */
const SLOTS: Record<string, number> = {
  Moid: 1,
  Yasir: 2,
  Ammar: 3,
  SUM: 4,
};

function slotVars(slot: number): AccountColor {
  return {
    ink: `var(--acc-${slot}-ink)`,
    tint: `var(--acc-${slot}-tint)`,
  };
}

export function accountColor(label: string): AccountColor {
  const known = SLOTS[label];
  if (known) return slotVars(known);

  // Stable per label, so an account added before somebody picks its colour
  // keeps one rather than changing on every render.
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return slotVars((Math.abs(hash) % 4) + 1);
}
