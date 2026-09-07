"use server";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients, contracts, events, notes } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { canDeletePastWork } from "@/lib/permissions";
import { isValidOutcome } from "@/lib/history";
import { PIPELINES } from "@/lib/pipelines";
import { formatPktMonth, pktMonthEnd, pktMonthStart } from "@/lib/time";
import type { ActionResult } from "@/lib/actions/contracts";

/**
 * Entering work that closed before the CRM existed.
 *
 * Four required answers — account, client, month, what the work was — and
 * everything else optional. A form with eight required fields is a form that
 * gets filled in twice and then abandoned, and a half-empty history is worse
 * than none because it makes every total a lie.
 */

function pastRef(): string {
  return `HIST-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function addPastWork(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();

  const accountId = String(formData.get("accountId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const newClientName = String(formData.get("newClientName") ?? "").trim();
  const newClientCountry = String(formData.get("newClientCountry") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const monthRaw = String(formData.get("wonMonth") ?? "");
  const rawValue = String(formData.get("value") ?? "").trim();
  const type = String(formData.get("type") ?? "fixed") === "hourly" ? "hourly" : "fixed";
  const outcomeRaw = String(formData.get("outcome") ?? "completed");
  const landedBy = String(formData.get("landedByUserId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!accountId) {
    return { ok: false, message: "Choose which Upwork account this came through." };
  }
  if (!clientId && !newClientName) {
    return { ok: false, message: "Pick the client, or type their name." };
  }
  if (!title) {
    return { ok: false, message: "Say what the work was, even roughly." };
  }

  const month = pktMonthStart(monthRaw);
  if (!month) {
    return { ok: false, message: "Pick the month it closed." };
  }
  if (month.getTime() > Date.now()) {
    return {
      ok: false,
      message: "That month has not happened yet. Past work only — live jobs go in as contracts.",
    };
  }

  const outcome = isValidOutcome(outcomeRaw) ? outcomeRaw : "completed";

  const [account] = await db
    .select({ id: accounts.id, niche: accounts.niche })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) return { ok: false, message: "That account no longer exists." };

  let value: string | null = null;
  if (rawValue) {
    const n = Number(rawValue.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: "That value could not be read. Use digits only." };
    }
    value = n.toFixed(2);
  }

  // A new name creates the client; an existing id reuses them, which is what
  // makes repeat business visible on the Clients page.
  let resolvedClientId = clientId;
  let clientName = "";
  if (resolvedClientId) {
    const [c] = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(eq(clients.id, resolvedClientId))
      .limit(1);
    if (!c) return { ok: false, message: "That client no longer exists." };
    clientName = c.name;
  } else {
    const [c] = await db
      .insert(clients)
      .values({
        name: newClientName,
        country: newClientCountry || null,
        // They were with us then, not now.
        firstSeenAt: month,
      })
      .returning({ id: clients.id, name: clients.name });
    resolvedClientId = c.id;
    clientName = c.name;
  }

  // Closed work sits on the last stage of its pipeline. Nothing reads this for
  // a historical row, but a blank stage would break the contract screen.
  const pipeline = PIPELINES[account.niche];
  const stage = pipeline[pipeline.length - 1].key;

  const [created] = await db
    .insert(contracts)
    .values({
      accountId,
      clientId: resolvedClientId,
      upworkContractId: pastRef(),
      title,
      type,
      value,
      // Always ended. This is the single line that keeps history out of every
      // live query in the product.
      status: "ended",
      isHistorical: true,
      wonMonth: month,
      outcome,
      ownerUserId: landedBy || null,
      createdByUserId: actor.id,
      stage,
      startedAt: month,
      endedAt: pktMonthEnd(month),
    })
    .returning({ id: contracts.id });

  await db.insert(events).values({
    contractId: created.id,
    type: "past_work_added",
    actor: actor.id,
    payload: {
      title,
      clientName,
      month: formatPktMonth(month),
      value,
      outcome,
      byName: actor.name,
    },
    occurredAt: new Date(),
  });

  if (note) {
    await db.insert(notes).values({
      contractId: created.id,
      authorUserId: actor.id,
      body: note,
    });
  }

  /*
    No revalidatePath here, deliberately.

    A revalidate call inside an action makes Next re-render the route the
    action was invoked from and stream it back inside the action response —
    and in this app that render never finishes, so the promise behind
    useActionState never settles and the button sits on "Saving…" forever.
    It is the same trap the contract forms already work around.

    The form calls router.refresh() once the result lands, which reloads this
    page properly. Every other screen is force-dynamic, so it is rebuilt on the
    next navigation anyway and cannot show a stale total.
  */
  return {
    ok: true,
    message: `Recorded ${clientName} — ${formatPktMonth(month)}.`,
  };
}

/**
 * Removing a past entry. Unlike everything else in the product this genuinely
 * destroys a row, so it is the owner's, or the entry's own author fixing a
 * typo they just made.
 */
export async function deletePastWork(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const id = String(formData.get("contractId") ?? "");

  const [row] = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      clientId: contracts.clientId,
      createdByUserId: contracts.createdByUserId,
      isHistorical: contracts.isHistorical,
    })
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);

  if (!row) return { ok: false, message: "That entry has already gone." };
  if (!row.isHistorical) {
    return {
      ok: false,
      message: "That is a live contract, not a past entry. End it on its own screen instead.",
    };
  }
  if (!canDeletePastWork(actor, row)) {
    return {
      ok: false,
      message: "Somebody else entered this one. Ask Mir to remove it.",
    };
  }

  await db.delete(contracts).where(eq(contracts.id, id));

  // Same rule as above — the page refreshes from the client, not from here.
  return { ok: true, message: `Removed ${row.title}.` };
}
