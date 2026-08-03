// Per-record access gate for budget writes. Resolves the caller's `budget.<action>`
// scope from RBAC (lib/rbacSeed.ts defines it: ALL for super-admin + budget-admin,
// OWN for partner) and answers whether they may touch this specific budget.
//
// Grantee-org ownership lives here rather than in lib/rbac.ts's scope builders
// because "own" means something budget-specific: the creating User, or the
// GrantPartner org the budget was granted to.

import { buildRbacContext, getScopeRule, getTeamIds } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { getPartnerAccess, partnerCanAccessBudget } from "./partnerAccess";
import type { BudgetStatus, BudgetPartnerEditState } from "@/app/generated/prisma/client";

type SessionLike = { user?: { id?: string; role?: string; email?: string | null } } | null;

/** The minimal budget shape an access check needs. */
export type BudgetOwnership = { partnerId: string; grantPartnerId: string | null };

export type BudgetAction = "read" | "update" | "delete";

/**
 * Access is the union of two paths, so this pass can only widen who gets in:
 *   1. the creator (`partnerId`) — unchanged from the pre-RBAC behaviour, and
 *   2. whatever the caller's RBAC scope rule allows.
 *
 * Deliberately additive. Roles that never had a `budget.*` grant (member, admin —
 * `budget` sits in ADMIN_EXCLUDED) can still have created a budget in the past,
 * and revoking that here would lock them out of their own work. Tightening the
 * creator path is a policy decision, not part of wiring up RBAC.
 */
export async function canAccessBudget(
  session: SessionLike,
  budget: BudgetOwnership | null,
  action: BudgetAction,
): Promise<boolean> {
  if (!budget) return false;

  const ctx = await buildRbacContext(session);
  if (!ctx) return false;

  if (budget.partnerId === ctx.userId) return true;

  // ctx.surface is null here: server actions aren't routed through fetchJson, so
  // the X-Surface header never arrives. Restricting a budget.* grant to specific
  // surfaces in /settings/roles would therefore deny every write. Default seeds
  // set no surface restriction.
  const rule = await getScopeRule(ctx, "budget", action);
  if (!rule) return false;

  switch (rule.kind) {
    case "all":
      return true;
    case "team": {
      const teamIds = await getTeamIds(ctx.userId);
      return teamIds.includes(budget.partnerId);
    }
    case "own":
    case "self": {
      const access = await getPartnerAccess(session);
      return partnerCanAccessBudget(access, budget);
    }
    default:
      return false;
  }
}

/**
 * Throwing wrapper for server actions. Distinguishes the two failure modes so a
 * permission problem stops surfacing as a mystifying "Not found" 500 — the exact
 * symptom that made admin edits on a colleague's budget look like data loss.
 */
export async function requireBudgetAccess(
  session: SessionLike,
  budget: BudgetOwnership | null,
  action: BudgetAction,
): Promise<void> {
  if (!budget) throw new Error("Not found");
  if (!(await canAccessBudget(session, budget, action))) throw new Error("Forbidden");
}

/**
 * `manage` — an internal user administering the grant. Everything is permitted.
 * `propose` — the grantee editing a draft the lead shared with them. Line edits
 * only; no metadata, no finalise, no approve.
 */
export type BudgetLineCapability = "manage" | "propose";

export type BudgetLineWrite = {
  capability: BudgetLineCapability;
  budgetId: string;
  status: BudgetStatus;
  partnerEditState: BudgetPartnerEditState;
};

/**
 * The single gate every `prisma.budgetLine.*` write goes through. Resolves the
 * owning budget from a line id or a budget id and answers what the caller may do.
 *
 * Kept separate from `canAccessBudget` rather than added as another OR inside it:
 * that function's first branch admits the budget's creator for *any* action, so
 * folding the grantee path in there would widen every existing `budget.update`
 * call site — metadata edits, finalise, delete — not just the line writes.
 */
export async function withBudgetLineWrite(
  session: SessionLike,
  target: { lineId: string } | { budgetId: string },
): Promise<BudgetLineWrite> {
  const budget = "lineId" in target
    ? (await prisma.budgetLine.findUnique({
        where: { id: target.lineId },
        select: { budget: { select: LINE_WRITE_BUDGET_SELECT } },
      }))?.budget ?? null
    : await prisma.budget.findUnique({ where: { id: target.budgetId }, select: LINE_WRITE_BUDGET_SELECT });

  if (!budget) throw new Error("Not found");

  // Grantee logins take the propose path only — never the manage path, whose
  // creator branch would otherwise admit them if they ever created a budget.
  if (session?.user?.role !== "partner") {
    await requireBudgetAccess(session, budget, "update");
    return { capability: "manage", budgetId: budget.id, status: budget.status, partnerEditState: budget.partnerEditState };
  }

  const access = await getPartnerAccess(session);
  if (!partnerCanAccessBudget(access, budget)) throw new Error("Forbidden");
  if (budget.status !== "draft") throw new Error("This budget is no longer a draft.");
  if (budget.partnerEditState !== "open") {
    throw new Error(
      budget.partnerEditState === "submitted"
        ? "You've already submitted this budget — it is with the grant lead for review."
        : "This budget isn't open for your input."
    );
  }
  return { capability: "propose", budgetId: budget.id, status: budget.status, partnerEditState: budget.partnerEditState };
}

const LINE_WRITE_BUDGET_SELECT = {
  id: true, partnerId: true, grantPartnerId: true, status: true, partnerEditState: true,
} as const;
