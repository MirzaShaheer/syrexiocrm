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

export function OwnerModeProvider({
  canUnlock,
  children,
}: {
  canUnlock: boolean;
  children: React.ReactNode;
}) {
  const [on, setOn] = useState(false);

  const toggle = useCallback(() => {
    if (!canUnlock) return;
    setOn((v) => !v);
  }, [canUnlock]);

  /*
    Server and client both start at `false`, so the first paint matches the
    markup exactly and there is no hydration warning. Nothing is read from
    storage, which is what keeps that true.
  */
  return (
    <OwnerModeContext.Provider value={{ on, canUnlock, toggle }}>
      {children}
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
      className={`h-6 w-6 shrink-0 cursor-default rounded-sm select-none ${
        on ? "bg-brand/25" : "bg-transparent"
      }`}
    />
  );
}
