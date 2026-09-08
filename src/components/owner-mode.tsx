"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Owner mode.
 *
 * The owner's account looks and behaves like everybody else's until a blank
 * square in the top right is clicked three times. Then the owner-only controls
 * appear: access grants, the team's Telegram links, the delivery log.
 *
 * Deliberately a *display* state and nothing more. The server still knows the
 * owner is the owner and still decides every access question in
 * lib/permissions.ts — this hides controls on one screen, it does not grant
 * or withhold anything. Anyone reading the page source of an owner's session
 * can see the panels this hides, and that is understood: the threat it answers
 * is somebody glancing at the screen, not somebody with the session.
 *
 * It lives only in React state, so a refresh puts it away — which is the
 * behaviour asked for, and also means there is no stored flag to get stuck on,
 * no cookie to go stale, and nothing to clear if it ever misbehaves.
 */

type OwnerModeValue = {
  /** True only while unlocked. False for everyone who cannot unlock it. */
  on: boolean;
  /** Whether this user is able to unlock at all. */
  canUnlock: boolean;
  toggle: () => void;
};

const OwnerModeContext = createContext<OwnerModeValue>({
  on: false,
  canUnlock: false,
  toggle: () => {},
});

export function useOwnerMode(): OwnerModeValue {
  return useContext(OwnerModeContext);
}

/** How long the confirmation stays on screen. */
const TOAST_MS = 1000;

export function OwnerModeProvider({
  canUnlock,
  children,
}: {
  canUnlock: boolean;
  children: React.ReactNode;
}) {
  const [on, setOn] = useState(false);
  /** Carries an id as well as text, so toggling twice quickly restarts the
   *  timer rather than letting the second message inherit the first's. */
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);

  // A ref mirrors the state so `toggle` can read the current value without
  // computing the message inside a state updater, which React is free to run
  // twice.
  const onRef = useRef(false);
  const toastId = useRef(0);

  const toggle = useCallback(() => {
    if (!canUnlock) return;
    const next = !onRef.current;
    onRef.current = next;
    setOn(next);
    toastId.current += 1;
    setToast({
      text: next ? "Owner mode on" : "Owner mode off",
      id: toastId.current,
    });
  }, [canUnlock]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  /*
    Server and client both start at `false`, so the first paint matches the
    markup exactly and there is no hydration warning. Nothing is read from
    storage, which is what keeps that true.
  */
  return (
    <OwnerModeContext.Provider value={{ on, canUnlock, toggle }}>
      {children}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          /*
            Bottom right, not beside the trigger. The header wraps to two and
            three rows as the window narrows, and a pill pinned to the top
            corner would sit on top of Sign out at exactly the widths nobody
            tests. The rail and the chip already confirm the change where the
            eye is; this is the words.
          */
          className="num pointer-events-none fixed right-4 bottom-4 z-50 rounded-full border border-brand/40 bg-raised px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-brand uppercase"
          style={{ boxShadow: "var(--shadow-md)" }}
        >
          {toast.text}
        </div>
      ) : null}
    </OwnerModeContext.Provider>
  );
}

/** Renders its children only while owner mode is unlocked. */
export function OwnerOnly({ children }: { children: React.ReactNode }) {
  const { on } = useOwnerMode();
  if (!on) return null;
  // A fragment, not a wrapper: this sits inside table rows and flex rows, and
  // an extra div would break both.
  return <>{children}</>;
}

/** The opposite. What everybody else sees, including the owner while locked. */
export function OwnerHidden({ children }: { children: React.ReactNode }) {
  const { on } = useOwnerMode();
  if (on) return null;
  return <>{children}</>;
}

/**
 * The rail along the very top of the window while owner mode is on.
 *
 * The one signal that is impossible to miss and impossible to mistake for
 * data: it sits above the header, spans the full width, and uses the brand
 * accent rather than the alert palette — red, amber and green each mean one
 * thing in this product and none of them is "you have more buttons than
 * usual".
 */
export function OwnerModeRail() {
  const { on } = useOwnerMode();
  if (!on) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[3px]"
      style={{
        background:
          "linear-gradient(90deg, transparent, var(--brand) 12%, var(--brand) 88%, transparent)",
        boxShadow: "0 0 12px 0 var(--brand)",
      }}
    />
  );
}

/**
 * The signed-in chip. Just a name normally; while owner mode is on it takes
 * the brand accent and says so in small mono caps, so the state is legible
 * from across a desk without reading anything.
 */
export function OwnerChip({
  name,
  roleLabel,
  elevated,
}: {
  name: string;
  roleLabel: string;
  elevated: boolean;
}) {
  const { on } = useOwnerMode();

  return (
    <span
      className={`hidden items-baseline gap-1.5 rounded-sm border px-2 py-1.5 leading-none transition-colors lg:flex ${
        on
          ? "border-brand/50 bg-brand/10 text-brand"
          : "border-line bg-raised text-muted"
      }`}
    >
      <span className={on ? "font-medium text-brand" : "font-medium text-ink-2"}>
        {name}
      </span>
      {on ? (
        <span className="num text-[10px] font-semibold tracking-[0.14em] text-brand uppercase">
          {roleLabel}
        </span>
      ) : null}
      {elevated ? (
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-2">
          elevated
        </span>
      ) : null}
    </span>
  );
}

/** How long a run of clicks stays a run. Comfortable, not fussy. */
const CLICK_WINDOW_MS = 1200;
const CLICKS_NEEDED = 3;

/**
 * The blank square. Invisible, unlabelled, and inert for anyone who cannot
 * unlock — a non-owner clicking it thirty times gets nothing, no error and no
 * hint that it did anything.
 *
 * Hidden from assistive technology on purpose: an unlabelled button that
 * screen readers announce is worse than one they skip.
 */
export function OwnerModeTrigger() {
  // `toggle` already refuses for anyone who cannot unlock, so the trigger
  // itself needs no idea who is clicking it.
  const { on, toggle } = useOwnerMode();
  const clicks = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending timer after unmount would set state on a dead component.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onClick() {
    if (timer.current) clearTimeout(timer.current);
    clicks.current += 1;

    if (clicks.current >= CLICKS_NEEDED) {
      clicks.current = 0;
      toggle();
      return;
    }

    // A run that stalls is not a run. Start again rather than letting three
    // clicks spread over a minute count.
    timer.current = setTimeout(() => {
      clicks.current = 0;
    }, CLICK_WINDOW_MS);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-hidden="true"
      tabIndex={-1}
      // Present for everyone, so its absence never reveals who the owner is.
      // `select-none` stops a triple click painting a selection across the
      // header, which is the one visible tell this would otherwise have.
      className="flex h-6 w-6 shrink-0 cursor-default items-center justify-center rounded-sm select-none"
    >
      {/* A single lit dot while unlocked. Invisible the rest of the time. */}
      <span
        className={`block size-[5px] rounded-full transition-opacity ${
          on ? "bg-brand opacity-100" : "opacity-0"
        }`}
      />
    </button>
  );
}
