/**
 * Page furniture.
 *
 * Every screen is built from the same three pieces — a head, one or more
 * panels, and section titles inside them — so that moving between Today,
 * Clients and History feels like moving around one product rather than
 * between three pages that happen to share a header.
 */

export function PageHead({
  title,
  note,
  action,
}: {
  title: string;
  /** One line explaining what the screen is for. Not a tagline. */
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-[19px] leading-tight font-semibold text-ink">
          {title}
        </h1>
        {note ? (
          <p className="mt-1 max-w-2xl text-[12.5px] text-muted">{note}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** A white slab on the tinted page. The unit every screen is assembled from. */
export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`panel ${className}`}>{children}</div>;
}

/**
 * A heading inside a panel. Small, uppercase and quiet, so it never competes
 * with the contract titles underneath it.
 */
export function PanelTitle({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <h2 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
      {children}
      {note ? (
        <span className="text-[11.5px] font-normal tracking-normal normal-case">
          {note}
        </span>
      ) : null}
    </h2>
  );
}
