// Per-record access gate for budget writes. Resolves the caller's `budget.<action>`
// scope from RBAC (lib/rbacSeed.ts defines it: ALL for super-admin + budget-admin,
// OWN for partner) and answers whether they may touch this specific budget.
//
// Grantee-org ownership lives here rather than in lib/rbac.ts's scope builders
// because "own" means something budget-specific: the creating User, or the
// GrantPartner org the budget was granted to.

import { buildRbacContext, getScopeRule, getTeamIds } from "@/lib/rbac";
import { getPartnerAccess, partnerCanAccessBudget } from "./partnerAccess";

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
