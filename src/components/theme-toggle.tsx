"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Reads the choice the inline boot script already applied, so the button
 * never disagrees with the page. Writes to localStorage and stamps
 * `data-theme` on <html>; the CSS does the rest.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("crm-theme", next);
    } catch {
      // Private browsing, or site data blocked. The choice just will not stick.
    }
  }

  // Render the frame immediately so the header does not shift when it hydrates.
  const label = theme === "dark" ? "Light" : "Dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${label.toLowerCase()} mode`}
      className="inline-flex min-h-8 min-w-[52px] items-center justify-center rounded-sm border border-line bg-raised px-2 text-[12px] text-muted hover:border-line-strong hover:text-ink-2"
    >
      {theme === null ? "" : label}
    </button>
  );
}

/**
 * Runs before first paint, so a dark-mode user never sees a white flash.
 * Kept as a string because it has to be inline in <head>.
 */
export const themeBootScript = `
(function () {
  try {
    var stored = localStorage.getItem('crm-theme');
    var theme = stored === 'dark' || stored === 'light'
      ? stored
      : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;
