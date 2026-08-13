/**
 * RBAC-backed nav-item gates for the Setup-mode sidebar.
 *
 * Each entry maps a sidebar href to a `{resource, action}` permission that the
 * user must hold. Items that should only appear for managers (i.e. anyone with
 * at least one direct report — Leader/PM/ZL/admin) carry `requiresReports: true`.
 *
 * The layout (server component) resolves this list into a `Set<string>` of
 * allowed hrefs via `computeAllowedNavHrefs()` and passes it to `AppNav`.
 * `AppNav` keeps the single source of truth for icons/labels/ordering and
 * just filters by membership in that set.
 *
 * The Operations-mode nav (`/home`, `/activities`, `/threads`,
 * `/notifications`) is universal for every authenticated user and is NOT
 * routed through this catalog.
 */

import { can, getScopeRule, type RbacContext } from "@/lib/rbac";

type NavGate = {
  /** Resource key in the RBAC catalog (e.g. "goal"). `null` = universal. */
  resource: string | null;
  /** Resource action (e.g. "list"). Ignored when `resource` is null. */
  action: string;
  /**
   * Additionally require the user to have at least one direct report (or be
   * admin/super-admin). Used for manager-only items like /people, /needs,
   * /effects, /programmes.
   */
  requiresReports?: boolean;
  /** Only super-admins see this item (bypasses RBAC catalog). */
  superAdminOnly?: boolean;
};

/** Source of truth for which RBAC permission each setup-nav href maps to. */
export const NAV_GATES: Record<string, NavGate> = {
  "/dashboard":  { resource: "goal",             action: "list" },
  "/needs":      { resource: "needs_assessment", action: "list", requiresReports: true },
  "/command":    { resource: "command_center",   action: "list", requiresReports: true },
  "/effects":    { resource: "effects_indicator", action: "list", requiresReports: true },
  "/programmes": { resource: "programme",        action: "list", requiresReports: true },
  "/map":        { resource: "map_data",         action: "list" },
  "/route":      { resource: "pitstop",          action: "list" },
  "/gantt":      { resource: "goal",             action: "list" },
  "/planner":    { resource: "plan_item",        action: "list" },
  "/quarters":   { resource: "quarter",          action: "list" },
  "/people":     { resource: "user",             action: "list", requiresReports: true },
  "/recruitment": { resource: "recruitment",     action: "list" },
  "/standup":    { resource: "standup",          action: "list" },
  "/models":     { resource: "operating_model",  action: "list" },
  // Universal items — appear for every authenticated user.
  "/wiki":       { resource: null,               action: "" },
  "/pitstops-training.html": { resource: null,   action: "" }, // static — public hub of training modules
  "/settings":   { resource: null,               action: "" },
  "/settings/language": { resource: null,        action: "" }, // viewer-only settings entry
  "/help":       { resource: null,               action: "" },
};

/**
 * Computes the set of nav hrefs the given user is allowed to see. Used by
 * `app/(app)/layout.tsx` to feed `AppNav`.
 *
 * - `null` ctx → empty set (treat as logged-out).
 * - Universal items (`resource: null`) always pass.
 * - Items with `requiresReports` additionally need `hasReports || isAdmin`.
 * - For permission-gated items we use `can()` (boolean — has the perm at any
 *   scope). The scope itself isn't checked here because the destination page
 *   applies its own scope at fetch time; we only decide whether the link
 *   appears in the nav at all.
 *
 *   Exception: `requiresReports` provides the practical "would this page
 *   show me anything?" signal for manager-only items, since e.g. `user.list`
 *   technically resolves to `[self]` for RP — that's a valid permission but
 *   the People page would show only their own row, so we hide the link.
 */
export async function computeAllowedNavHrefs(
  ctx: RbacContext | null,
  opts: { hasReports: boolean; isAdmin: boolean; isSuperAdmin?: boolean },
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ctx) return out;

  const checks = await Promise.all(
    Object.entries(NAV_GATES).map(async ([href, gate]) => {
      if (gate.superAdminOnly && !opts.isSuperAdmin) return null;
      if (gate.requiresReports && !opts.hasReports && !opts.isAdmin) return null;
      if (gate.resource === null) return href;
      const ok = await can(ctx, gate.resource, gate.action);
      return ok ? href : null;
    }),
  );
  for (const href of checks) if (href) out.add(href);
  return out;
}

// Re-export getScopeRule so future gates can do scope-level checks without
// pulling another import.
export { getScopeRule };
