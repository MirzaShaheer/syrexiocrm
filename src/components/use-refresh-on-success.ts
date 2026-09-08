"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/contracts";

/**
 * Refreshes the current screen once a server action has succeeded.
 *
 * This is how every form in the product stays fresh, and it exists because the
 * server-side alternative does not work: a server action dispatched from a form
 * calls revalidatePath and the client then never applies the response, so
 * useActionState never settles and the button sits on "Saving…" for ever. That
 * holds even when the revalidated route is a different one from the screen the
 * form is on. Measured on a clean production build: 10 hangs out of 10 with a
 * revalidatePath call, 0 out of 10 without.
 *
 * So actions return their result and revalidate nothing; the screen refreshes
 * here instead. Other screens are dynamic, so navigating to one refetches it.
 */
export function useRefreshOnSuccess(
  state: ActionResult | null,
  formRef?: React.RefObject<HTMLFormElement | null>,
) {
  const router = useRouter();
  useEffect(() => {
    if (!state?.ok) return;
    formRef?.current?.reset();
    router.refresh();
  }, [state, router, formRef]);
}
