import type { BudgetPartnerEditState } from "@/app/generated/prisma/client";

/**
 * A draft that is out with the grantee has lines still moving under it.
 * Finalising or approving in that state would freeze report slots against
 * figures the partner is mid-way through changing, so both refuse until the
 * lead has taken the draft back (`reclaimBudgetDraft` → `closed`).
 */
export function assertPartnerEditClosed(state: BudgetPartnerEditState, verb: string) {
  if (state === "closed") return;
  throw new Error(
    state === "open"
      ? `This draft is open for the grantee to edit — take it back before it can be ${verb}.`
      : `The grantee has submitted this draft and it is awaiting your review — close the review before it can be ${verb}.`
  );
}
