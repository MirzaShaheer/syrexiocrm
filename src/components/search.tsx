"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchHit } from "@/app/api/search/route";
import { accountColor } from "@/lib/account-colors";

/**
 * One box, reachable from anywhere with Ctrl+K (Cmd+K on a Mac) or "/".
 * Arrow keys move, Enter opens, Escape closes — so it can be driven without
 * ever touching the mouse.
 */
export function Search() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /* ---------------------------------------------------- global shortcuts */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      // "/" is the other muscle memory, but not while somebody is typing.
      if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      // Focus after paint, or the dialog steals the keystroke that opened it.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQ("");
      setHits([]);
      setCursor(0);
    }
  }, [open]);

  /* -------------------------------------------------------------- query */
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    // Debounced, so a fast typist does not fire eight queries.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const json = (await res.json()) as { hits: SearchHit[] };
        setHits(json.hits ?? []);
        setCursor(0);
      } catch {
        // An aborted request is the normal case while typing.
      } finally {
        setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      router.push(hit.href);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    }
    if (e.key === "Enter" && hits[cursor]) {
      e.preventDefault();
      go(hits[cursor]);
    }
  }

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-8 items-center gap-2 rounded-sm border border-line bg-raised px-2.5 text-[12px] text-muted hover:border-line-strong hover:text-ink-2"
      >
        <span>Search</span>
        <kbd className="num hidden rounded-[3px] border border-line px-1 text-[10px] sm:inline">
          Ctrl K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh] backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="card w-full max-w-lg overflow-hidden rounded-xl"
            style={{ boxShadow: "var(--shadow-lg)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Contract, client or account"
              aria-label="Search contracts, clients and accounts"
              className="w-full border-b border-line bg-transparent px-3.5 py-3 text-[14px] text-ink placeholder:text-muted focus:outline-none"
            />

            <div className="max-h-[52vh] overflow-y-auto">
              {q.trim().length < 2 ? (
                <p className="px-3.5 py-4 text-[12px] text-muted">
                  Type at least two characters. Arrow keys to move, Enter to
                  open, Escape to close.
                </p>
              ) : loading && hits.length === 0 ? (
                <p className="px-3.5 py-4 text-[12px] text-muted">Searching…</p>
              ) : hits.length === 0 ? (
                <p className="px-3.5 py-4 text-[12px] text-muted">
                  Nothing matches “{q}”. Try part of a contract title, a client
                  name, or an account like Moid.
                </p>
              ) : (
                <ul ref={listRef}>
                  {hits.map((h, i) => {
                    const c = h.account ? accountColor(h.account) : null;
                    return (
                      <li key={`${h.kind}-${h.id}`} data-index={i}>
                        <button
                          type="button"
                          onMouseEnter={() => setCursor(i)}
                          onClick={() => go(h)}
                          className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left ${
                            i === cursor ? "bg-surface" : ""
                          }`}
                        >
                          {c && h.kind !== "account" ? (
                            <span
                              className="inline-block w-[54px] shrink-0 truncate rounded-sm px-1 py-[2px] text-center text-[10px] font-semibold"
                              style={{ backgroundColor: c.tint, color: c.ink }}
                            >
                              {h.account}
                            </span>
                          ) : (
                            <span className="w-[54px] shrink-0 text-[10px] font-semibold tracking-[0.06em] text-muted uppercase">
                              {h.kind}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-ink">
                              {h.title}
                            </span>
                            <span className="block truncate text-[11.5px] text-muted">
                              {h.subtitle}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
