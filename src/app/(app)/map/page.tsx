import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  GROUPS,
  SECTIONS,
  canOpen,
  type MapSection,
} from "@/lib/site-map";
import { GRANT_DURATIONS } from "@/lib/permissions";
import { PageHead, Panel, PanelTitle } from "@/components/shell";
import { OwnerHidden, OwnerOnly } from "@/components/owner-mode";

export const metadata = { title: "Map" };
export const dynamic = "force-dynamic";

/**
 * The whole product on one screen.
 *
 * It exists because a CRM that nobody can describe is a CRM nobody uses past
 * the first fortnight. Everything here is read from lib/site-map.ts, which is
 * the same file the navigation and the access checks use — so this page cannot
 * quietly drift out of date the way a written handover always does.
 */
export default async function MapPage() {
  const actor = await requireUser();

  return (
    <>
      <PageHead
        title="What this CRM does"
        note="Every screen, what you do on it, and who can open it. This page is generated from the same rules the product enforces, so it is never out of date."
      />

      {/* ------------------------------------------------------ the rhythm */}
      <Panel className="mt-4">
        <PanelTitle>The daily rhythm</PanelTitle>
        <p className="mt-2 max-w-3xl text-[13px] text-ink-2">
          The one rule the whole product is built around:{" "}
          <span className="font-medium text-ink">
            every active contract has an owner, a stage, and a next action with
            a due date.
          </span>{" "}
          Anything missing or stale surfaces on Today. Nothing else is the job.
        </p>

        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Step
            n={1}
            when="Every morning"
            what="Open Today"
            detail="Clear the four queues: overdue, waiting on us, no owner, no next action."
            href="/today"
          />
          <Step
            n={2}
            when="As it happens"
            what="Stamp the contract"
            detail="Client messaged, we replied, stage moved, milestone approved. One click each."
          />
          <Step
            n={3}
            when="Every Monday"
            what="Type each account's counts"
            detail="Bids, chats, contracted, closed, withdrawn — the numbers Upwork will not give us. They turn the Week page into a funnel."
            href="/week"
          />
          <Step
            n={4}
            when="Whenever you remember one"
            what="Add a past client"
            detail="Old work, by month. It backfills the client record and the revenue picture."
            href="/history"
          />
        </ol>
      </Panel>

      {/* ------------------------------------------------------- your access */}
      <Panel className="mt-4">
        <PanelTitle note={actor.name}>
          What you can open
        </PanelTitle>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface p-3.5">
            <h3 className="text-[12.5px] font-semibold text-ink">
              Everyone on the team
            </h3>
            <p className="mt-1 text-[12px] text-muted">
              Mir, Yasir, Taha, Ahmed, Ali and Saleem — same screens, same
              numbers.
            </p>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {SECTIONS.filter((s) => s.access === "everyone").map((s) => (
                <AccessRow key={s.key} section={s} open />
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-line bg-surface p-3.5">
            <h3 className="text-[12.5px] font-semibold text-ink">Mir only</h3>
            <p className="mt-1 text-[12px] text-muted">
              Not about the work — about who may change other people&rsquo;s
              records, and what the system sends.
            </p>
            {/*
              Two lists, one shown at a time. The locked owner reads the same
              page a sales executive reads, down to the closing line — a row
              lit up as reachable would be the tell.
            */}
            <OwnerOnly>
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {SECTIONS.filter((s) => s.access === "owner").map((s) => (
                  <AccessRow key={s.key} section={s} open />
                ))}
              </ul>
            </OwnerOnly>
            <OwnerHidden>
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {SECTIONS.filter((s) => s.access === "owner").map((s) => (
                  <AccessRow key={s.key} section={s} open={false} />
                ))}
              </ul>
              <p className="mt-3 text-[11.5px] text-muted">
                You do not see these. Ask Mir if you need something from them.
              </p>
            </OwnerHidden>
          </div>
        </div>
      </Panel>

      {/* --------------------------------------------------- edit permissions */}
      <Panel className="mt-4">
        <PanelTitle>Who can change what</PanelTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Rule
            title="Everyone reads everything"
            body="There is no contract you cannot see. A contract nobody can see is a contract nobody chases, so the whole team shares one picture."
          />
          <Rule
            title="Everyone can add"
            body="Updates, notes, milestones, new contracts, past clients. Adding is always allowed, because appending to someone else's contract can never destroy their work."
          />
          <Rule
            title="Only the creator edits"
            body="Changing a field somebody else wrote — the title, the value, the stage, the owner — needs to be the person who created that record, or to hold a live access grant."
          />
        </div>

        <div className="mt-4 rounded-lg border border-line bg-surface p-3.5">
          <h3 className="text-[12.5px] font-semibold text-ink">
            Temporary edit access
          </h3>
          <p className="mt-1 max-w-3xl text-[12px] text-ink-2">
            Mir can give anyone edit rights over every record for a fixed
            stretch — cover during leave, a clean-up week — and take it back at
            any point. It expires on its own, nobody can grant it to themselves,
            and every grant and revocation is written to the audit log.
          </p>
          <p className="mt-2 text-[12px] text-muted">
            Lengths on offer:{" "}
            {GRANT_DURATIONS.map((d) => d.label).join(" · ")}. Granted from{" "}
            <Link
              href="/people"
              className="text-ink-2 underline decoration-line-strong underline-offset-2"
            >
              People
            </Link>
            .
          </p>
        </div>
      </Panel>

      {/* ---------------------------------------------------------- screens */}
      {GROUPS.map((g) => {
        const sections = SECTIONS.filter((s) => s.group === g.key);
        if (!sections.length) return null;
        return (
          <Panel key={g.key} className="mt-4">
            <PanelTitle note={g.note}>{g.title}</PanelTitle>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {sections.map((s) => (
                <ScreenCard key={s.key} section={s} open={canOpen(actor, s)} />
              ))}
            </div>
          </Panel>
        );
      })}

      {/* -------------------------------------------------------- the edges */}
      <Panel className="mt-4">
        <PanelTitle>What it deliberately does not do</PanelTitle>
        <p className="mt-2 max-w-3xl text-[12.5px] text-ink-2">
          Each of these is a decision, not a gap. They are the failure modes
          that kill internal tools: the fields nobody fills in, and the features
          that turn an oversight board into a second job.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {[
            "No Upwork sync — there is no API for proposals or Connects",
            "No per-bid logging — four numbers a week instead",
            "No time tracking",
            "No invoicing",
            "No client portal",
            "No file storage",
            "No in-app chat replies",
            "No forecasting",
          ].map((x) => (
            <li
              key={x}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] text-muted"
            >
              {x}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function Step({
  n,
  when,
  what,
  detail,
  href,
}: {
  n: number;
  when: string;
  what: string;
  detail: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="num text-[11px] font-semibold text-brand">
        {String(n).padStart(2, "0")}
      </span>
      <span className="mt-1 block text-[11px] tracking-[0.06em] text-muted uppercase">
        {when}
      </span>
      <span className="mt-1 block text-[13.5px] font-semibold text-ink">
        {what}
      </span>
      <span className="mt-1 block text-[12px] text-muted">{detail}</span>
    </>
  );

  return (
    <li>
      {href ? (
        <Link href={href} className="tile block h-full p-3.5">
          {body}
        </Link>
      ) : (
        <div className="tile h-full p-3.5">{body}</div>
      )}
    </li>
  );
}

function Rule({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3.5">
      <h3 className="text-[12.5px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-[12px] text-ink-2">{body}</p>
    </div>
  );
}

function AccessRow({ section, open }: { section: MapSection; open: boolean }) {
  return (
    <li className="flex items-baseline gap-2 text-[12.5px]">
      <span
        aria-hidden
        className={`mt-[1px] inline-block size-1.5 shrink-0 rounded-full ${
          open ? "bg-done" : "bg-line-strong"
        }`}
      />
      {open ? (
        <Link
          href={section.href}
          className="font-medium text-ink-2 hover:underline"
        >
          {section.name}
        </Link>
      ) : (
        <span className="font-medium text-muted">{section.name}</span>
      )}
      <span className="min-w-0 text-[12px] text-muted">{section.blurb}</span>
    </li>
  );
}

function ScreenCard({
  section,
  open,
}: {
  section: MapSection;
  open: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {open ? (
          <Link
            href={section.href}
            className="text-[14px] font-semibold text-ink hover:underline"
          >
            {section.name}
          </Link>
        ) : (
          <span className="text-[14px] font-semibold text-muted">
            {section.name}
          </span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.04em] uppercase ${
            section.access === "owner"
              ? "bg-surface-2 text-ink-2"
              : "bg-surface-2 text-muted"
          }`}
        >
          {section.access === "owner" ? "Mir only" : "Everyone"}
        </span>
      </div>

      <p className="mt-1 text-[12.5px] text-ink-2">{section.blurb}</p>

      <ul className="mt-2.5 flex flex-col gap-1">
        {section.does.map((d) => (
          <li key={d} className="flex gap-2 text-[12px] text-muted">
            <span aria-hidden className="text-line-strong">
              —
            </span>
            <span>{d}</span>
          </li>
        ))}
      </ul>

      {section.limits?.length ? (
        <ul className="mt-2.5 flex flex-col gap-1 border-t border-line pt-2.5">
          {section.limits.map((l) => (
            <li key={l} className="text-[11.5px] text-muted italic">
              {l}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
