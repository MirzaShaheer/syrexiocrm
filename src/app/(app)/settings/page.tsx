import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  ROLE_LABELS,
  canManageTeamLinks,
  canViewAdminSettings,
  type Role,
} from "@/lib/permissions";
import { getLiveCode } from "@/lib/notifications/linking";
import { telegramEnabled } from "@/lib/notifications";
import { agoLabel, formatPktDateTime } from "@/lib/time";
import { MyTelegramLink, UnlinkPerson } from "@/components/telegram-settings";
import { ChangePassword } from "@/components/change-password";
import { OwnerHidden, OwnerOnly } from "@/components/owner-mode";
import { PageHead, Panel, PanelTitle } from "@/components/shell";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Two halves, and the line between them is the product's whole access model.
 *
 * Everyone opens this page, because this is where a person links their own
 * Telegram and nobody else can do that for them. Everything below it — who
 * else is linked, what the system has actually sent, the account records — is
 * the owner's, because it is about the wiring rather than about the work.
 */
export default async function SettingsPage() {
  const actor = await requireUser();
  const admin = canViewAdminSettings(actor);

  const [team, myCode, recent] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        telegramChatId: users.telegramChatId,
        telegramLinkedAt: users.telegramLinkedAt,
      })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name)),
    getLiveCode(actor.id),
    // Only the owner ever renders this, so only the owner ever queries it.
    admin
      ? db
          .select({
            id: notifications.id,
            template: notifications.template,
            status: notifications.status,
            error: notifications.error,
            createdAt: notifications.createdAt,
            userName: users.name,
          })
          .from(notifications)
          .leftJoin(users, eq(users.id, notifications.userId))
          .orderBy(desc(notifications.createdAt))
          .limit(10)
      : Promise.resolve([]),
  ]);

  const me = team.find((t) => t.id === actor.id);
  const linkedCount = team.filter((t) => t.telegramChatId).length;
  const enabled = telegramEnabled();
  const now = new Date();

  return (
    <>
      <PageHead
        title="Settings"
        note={`Signed in as ${actor.name}`}
        action={
          <Link
            href="/map"
            className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2"
          >
            What can I access?
          </Link>
        }
      />

      {/* -------------------------------------------------------- my password */}
      <Panel className="mt-4">
        <PanelTitle note="The only account setting you own">
          Your password
        </PanelTitle>
        <div className="mt-3">
          <ChangePassword />
        </div>
      </Panel>

      {/* ------------------------------------------------------- my linking */}
      <Panel className="mt-4">
        <PanelTitle note="Yours alone — nobody can link it for you">
          Your Telegram
        </PanelTitle>
        <div className="mt-3">
          <MyTelegramLink
            code={myCode?.code ?? null}
            expiresLabel={myCode ? formatPktDateTime(myCode.expiresAt) : null}
            botName={process.env.TELEGRAM_BOT_USERNAME ?? null}
            linked={Boolean(me?.telegramChatId)}
          />
        </div>
        <p className="mt-3 border-t border-line pt-3 text-[12px] text-muted">
          {enabled ? (
            <>Telegram is on. Alerts go to linked accounts.</>
          ) : (
            <>
              <span className="font-medium text-ink">Test mode.</span> Messages
              are written to the server console instead of being delivered. Set{" "}
              <span className="num">TELEGRAM_ENABLED=true</span> to send for
              real.
            </>
          )}{" "}
          The shift is 6pm to 6am Pakistan time, and that is when messages go
          out — every night, including the weekend. Between 6am and 6pm only
          deadline alerts arrive: a milestone running out of time, or one
          inside its final hour. Everything else is held until 6pm rather than
          being dropped. An alert nobody answers is re-sent every four hours,
          to the whole team, until it is resolved or snoozed with a reason.
        </p>
      </Panel>

      {/* ------------------------------------------------------------ admin */}
      {admin ? (
        <OwnerOnly>
          <Panel className="mt-4 ring-1 ring-brand/25">
            <PanelTitle note={`${linkedCount} of ${team.length} linked`}>
              Who is linked · owner only
            </PanelTitle>
            <ul className="mt-2">
              {team.map((t) => {
                const linked = Boolean(t.telegramChatId);
                return (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line py-2.5 first:border-t-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="text-[13.5px] font-medium text-ink">
                        {t.name}
                      </span>
                      <span className="ml-2 text-[12px] text-muted">
                        {ROLE_LABELS[t.role as Role] ?? t.role}
                      </span>
                    </span>

                    <span
                      className={`text-[12px] ${linked ? "text-done" : "text-muted"}`}
                    >
                      {linked
                        ? t.telegramLinkedAt
                          ? `linked ${agoLabel(now.getTime() - t.telegramLinkedAt.getTime())}`
                          : "linked"
                        : "not linked"}
                    </span>

                    {linked && canManageTeamLinks(actor) && t.id !== actor.id ? (
                      <UnlinkPerson userId={t.id} name={t.name} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {linkedCount < team.length ? (
              <p className="mt-3 border-t border-line pt-3 text-[12px] text-muted">
                Anyone not linked gets no messages at all. They link themselves
                from this page — a bot cannot start the conversation.
              </p>
            ) : null}
          </Panel>

          <Panel className="mt-4 ring-1 ring-brand/25">
            <PanelTitle note="What fired, what failed, and why">
              Recent notifications · owner only
            </PanelTitle>
            {recent.length === 0 ? (
              <div className="mt-2">
                <p className="text-[13px] text-ink-2">
                  Nothing has been sent yet.
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  Link your Telegram above and send a test message to see it
                  appear here.
                </p>
              </div>
            ) : (
              <ul className="mt-2">
                {recent.map((n) => (
                  <li
                    key={n.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line py-2 first:border-t-0"
                  >
                    <span className="min-w-0 flex-1 text-[13px] text-ink">
                      {n.template.replace(/_/g, " ")}
                      <span className="ml-2 text-[12px] text-muted">
                        {n.userName ?? "unknown"}
                      </span>
                    </span>
                    {n.error ? (
                      <span className="text-[12px] text-late">{n.error}</span>
                    ) : null}
                    <span
                      className={`text-[12px] ${
                        n.status === "sent"
                          ? "text-done"
                          : n.status === "failed"
                            ? "text-late"
                            : "text-muted"
                      }`}
                    >
                      {n.status}
                    </span>
                    <span className="text-[12px] text-muted">
                      {agoLabel(now.getTime() - n.createdAt.getTime())}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel className="mt-4 ring-1 ring-brand/25">
            <PanelTitle>Upwork accounts · owner only</PanelTitle>
            <p className="mt-2 text-[13px] text-ink-2">
              Contracts are entered by hand — there is no Upwork API connection,
              and none is planned.
            </p>
            <p className="mt-1 text-[12px] text-muted">
              The account tiles show a sync warning only because the seeded demo
              data includes one. It disappears once real data replaces it.
            </p>
          </Panel>
        </OwnerOnly>
      ) : null}

      {/*
        What everyone else sees — and what the owner sees while locked, word
        for word. Saying "yours" here would be the one line on the screen that
        gave the account away.
      */}
      <OwnerHidden>
        <Panel className="mt-4">
          <PanelTitle>The rest of Settings</PanelTitle>
          <p className="mt-2 max-w-2xl text-[13px] text-ink-2">
            Who else is linked to Telegram, the delivery log, and the Upwork
            account records are Mir&rsquo;s. Nothing on those screens is about
            the work itself — it is about what the system sends and who may
            change other people&rsquo;s records.
          </p>
          <p className="mt-2 text-[12px] text-muted">
            Everything you can open is listed on the{" "}
            <Link
              href="/map"
              className="text-ink-2 underline decoration-line-strong underline-offset-2"
            >
              map
            </Link>
            .
          </p>
        </Panel>
      </OwnerHidden>
    </>
  );
}
