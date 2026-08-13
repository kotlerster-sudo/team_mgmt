/**
 * RBAC seed configuration. The catalog of permissions and the per-role
 * scope grants live here so they can be reused by:
 *   - `scripts/seed-rbac.ts` (CLI bootstrap)
 *   - `/api/admin/rbac/roles/[id]/reset` (admin UI "reset to defaults" button)
 *
 * Single source of truth — when the catalog (docs/rbac-catalog.md) changes,
 * update this file and re-run the seed (or click reset in the admin UI).
 */

import prisma from "./prisma";

// ── Scope rule kinds (the closed set surfaced in the admin UI) ───────────────

/**
 * Optional `surfaces` allowlist (set in the admin UI) restricts the grant to
 * requests originating from those UI surfaces (see lib/rbacSurfaces.ts). Omit
 * / leave empty for "any surface" (the default, backwards-compatible behavior).
 */
type WithSurfaces<T> = T & { surfaces?: string[] };

export type ScopeRule =
  | WithSurfaces<{ kind: "all" }>
  | WithSurfaces<{ kind: "self" }>
  | WithSurfaces<{ kind: "own" }>
  | WithSurfaces<{ kind: "team" }>
  | WithSurfaces<{ kind: "city" }>
  | WithSurfaces<{ kind: "team_and_city" }>
  | WithSurfaces<{ kind: "own_or_followed" }>
  | WithSurfaces<{ kind: "team_or_subscribed" }>
  | WithSurfaces<{ kind: "own_or_subscribed" }>;

export const SCOPE_KINDS = [
  "all",
  "self",
  "own",
  "team",
  "city",
  "team_and_city",
  "own_or_followed",
  "team_or_subscribed",
  "own_or_subscribed",
] as const;

export type ScopeKind = typeof SCOPE_KINDS[number];

export const SCOPE_LABELS: Record<ScopeKind, string> = {
  all:                 "All records (no filter)",
  self:                "Only the user themselves",
  own:                 "Owned/created by me",
  team:                "My team (self + reports, recursive)",
  city:                "My assigned city",
  team_and_city:       "My team AND my city",
  own_or_followed:     "Owned by me OR I'm a follower",
  team_or_subscribed:  "My team OR I'm subscribed",
  own_or_subscribed:   "Owned by me OR I'm subscribed",
};

const ALL: ScopeRule = { kind: "all" };
const SELF: ScopeRule = { kind: "self" };
const OWN: ScopeRule = { kind: "own" };
const TEAM: ScopeRule = { kind: "team" };
const CITY: ScopeRule = { kind: "city" };
const TEAM_AND_CITY: ScopeRule = { kind: "team_and_city" };
const OWN_OR_FOLLOWED: ScopeRule = { kind: "own_or_followed" };
const TEAM_OR_SUBSCRIBED: ScopeRule = { kind: "team_or_subscribed" };

// ── Resources × Actions catalog ──────────────────────────────────────────────

const STANDARD_ACTIONS = ["list", "read", "create", "update", "delete"] as const;

export const RESOURCE_ACTIONS: Record<string, readonly string[]> = {
  user: [...STANDARD_ACTIONS, "reset_password", "change_own_password"],
  goal: [...STANDARD_ACTIONS, "change_owner"],
  pitstop: [...STANDARD_ACTIONS, "generate_partner_briefing"],
  pitstop_event: [...STANDARD_ACTIONS, "respond", "cancel", "reschedule", "arrive"],
  // Visit-driven ops (live centres). `catalog` = admin-authored domain catalogs;
  // `catalog_item` = ad-hoc items RPs add (create=OWN) pending supervisor approval (approve=TEAM);
  // supervisors deploy shelf items onto a reportee's centre (deploy=TEAM);
  // `visit` = the RP's per-visit lifecycle (start/arrive/tick/close), all OWN.
  catalog: [...STANDARD_ACTIONS],
  catalog_item: ["create", "approve", "deploy"],
  visit: ["create", "arrive", "tick", "close"],
  decision: [...STANDARD_ACTIONS],
  risk: [...STANDARD_ACTIONS],
  settlement: [...STANDARD_ACTIONS, "sync_civic_data"],
  cluster: [...STANDARD_ACTIONS],
  zone: [...STANDARD_ACTIONS],
  city: [...STANDARD_ACTIONS],
  programme: [...STANDARD_ACTIONS],
  programme_journey: [...STANDARD_ACTIONS, "apply_pack"],
  plan_item: [...STANDARD_ACTIONS],
  checklist_item: [...STANDARD_ACTIONS],
  // ActionPoint — follow-ups that emerge during a visit (rooted in
  // Goal → Pitstop → PitstopEvent), and ad-hoc tasks that sit outside that
  // hierarchy. Owner = whoever carries it; ZL/PM/Leader may close on the RP's
  // behalf via TEAM scope. `assign` = raise a task owned by someone else; TEAM
  // resolves to self for an RP, so one grant covers self-assignment too.
  action_point: [...STANDARD_ACTIONS, "assign"],
  thread: [...STANDARD_ACTIONS, "post_message", "subscribe"],
  notification: ["list", "read", "mark_read"],
  map_note: [...STANDARD_ACTIONS],
  map_partner: [...STANDARD_ACTIONS],
  layer_feature: [...STANDARD_ACTIONS],
  map_data: ["list", "read", "register_settlement", "retag_schools"],
  needs_scheme: [...STANDARD_ACTIONS],
  needs_formula: [...STANDARD_ACTIONS],
  needs_assessment: [...STANDARD_ACTIONS],
  needs_actual: [...STANDARD_ACTIONS],
  template: [...STANDARD_ACTIONS],
  facility_indicator: [...STANDARD_ACTIONS],
  facility_layer: [...STANDARD_ACTIONS],
  journey_outcome_pack: [...STANDARD_ACTIONS],
  mis_provider: [...STANDARD_ACTIONS],
  app_setting: [...STANDARD_ACTIONS],
  invite_code: ["read", "rotate"],
  audit_log: ["list", "read"],
  // RBAC self-management. Only super-admin should edit the role catalog itself
  // (gated via ADMIN_EXCLUDED below). `list` powers the /settings/roles link.
  role: ["list", "read", "update"],
  // Wiki staff designation (curator/steward). Admin can manage; member just lists.
  wiki_staff: ["list", "manage"],
  review_portal: ["access"],
  // `propose` = a grantee editing a draft the lead shared with them. It gates
  // nav and useHasGrant visibility only; the write gate is withBudgetLineWrite
  // in lib/budget/budgetAccess.ts, which also checks the budget's edit state.
  budget: [...STANDARD_ACTIONS, "propose"],
  // Catalog refresh 2026-05-22 — new resources.
  team_metrics: ["list", "read"],
  effects_indicator: [...STANDARD_ACTIONS],
  quarter: [...STANDARD_ACTIONS],
  theme: [...STANDARD_ACTIONS],
  standup: [...STANDARD_ACTIONS],
  retrospective: [...STANDARD_ACTIONS],
  calendar: ["read", "subscribe"],
  attachment: ["read", "create", "delete"],
  search: ["execute"],
  system: ["agent_use", "seed_run", "geo_sync_civic"],
  // Operating Models (/models) — instances are the play surface; templates are the author layer.
  operating_model:          [...STANDARD_ACTIONS, "promote_to_budget"],
  operating_model_template: [...STANDARD_ACTIONS],
  // Command center (/command) — leader operational drill-down (zone→cluster→settlement).
  // Read-only surface; geographic scope is resolved server-side per designation
  // (resolveCommandScope in lib/operations/command.ts), the grant gates entry.
  command_center: ["list", "read"],
  // Caregiver practices — gates the admin TAXONOMY editor + phase-2 reads.
  // On-visit CAPTURE reuses pitstop_event.update (it's a visit action).
  caregiver_practice: [...STANDARD_ACTIONS],
  // Recruitment (/recruitment) — scouting-desk docs generated from CVs.
  // Candidate PII, so seed defaults to super-admin only (excluded from admin,
  // viewer, member, partner, budget-admin). Grant to other roles from the
  // /settings/roles UI when needed. `list` = index page + generate dropdown,
  // `read` = view a doc + read/write its shared team-scoring state, `create` =
  // upload a CV + generate a new doc, `delete` = remove a doc (no route yet).
  recruitment: ["list", "read", "create", "delete"],
  // Field-ops unified backend (/field/backend) — configure domains, step
  // templates, forms, interventions, facilities, geography & RP assignment.
  // Super-admin/admin get it by default (below); grant to a programme lead's
  // role from /settings/roles to delegate field-backend access without making
  // them a super-admin. Checked by requireFieldAdmin (lib/field/access.ts).
  field: ["manage"],
};

export type RoleGrant = Record<string, ScopeRule>; // "resource.action" → rule

// ── Per-role grants ──────────────────────────────────────────────────────────

const SUPER_ADMIN_GRANTS: RoleGrant = (() => {
  const out: RoleGrant = {};
  for (const [resource, actions] of Object.entries(RESOURCE_ACTIONS)) {
    for (const action of actions) out[`${resource}.${action}`] = ALL;
  }
  return out;
})();

const ADMIN_EXCLUDED = new Set<string>([
  "invite_code.rotate",
  // Role catalog is super-admin-only — admins can't grant themselves more rights.
  "role.list", "role.read", "role.update",
  // Catalog refresh 2026-05-22 — admin still gets these via city/team scope at the
  // role row; keeping admin = ALL for new resources unless we add exclusions later.
  // Recruitment holds candidate PII — super-admin only by default. Admins can be
  // granted individual actions from the /settings/roles UI when needed.
  "recruitment.list", "recruitment.read", "recruitment.create", "recruitment.delete",
]);

const ADMIN_GRANTS: RoleGrant = (() => {
  const out: RoleGrant = {};
  for (const [resource, actions] of Object.entries(RESOURCE_ACTIONS)) {
    for (const action of actions) {
      const key = `${resource}.${action}`;
      if (ADMIN_EXCLUDED.has(key)) continue;
      out[key] = ALL;
    }
  }
  return out;
})();

const MEMBER_GRANTS: RoleGrant = {
  // user.list/read = TEAM so Leader/PM/ZL see their team directory (the
  // dashboard Team tab, /people, workload panels). RP/Other collapse to [self]
  // via the recursive team CTE. Mutation stays self-only.
  // (Catalog row 1 updated 2026-05-29 — was SELF, but live UIs already showed
  // team data via hardcoded `isScoped + teamIds`; locking the rule here.)
  "user.list":                TEAM,
  "user.read":                TEAM,
  "user.update":              SELF,
  "user.change_own_password": SELF,

  "goal.list":         TEAM_AND_CITY,
  "goal.read":         OWN_OR_FOLLOWED,
  "goal.create":       OWN,
  "goal.update":       OWN,
  "goal.change_owner": OWN,

  "pitstop.list":   TEAM,
  // Readable in context (a goal, a pitstop, the side panel) but not from the
  // activities list, where the link would just be an accidental click away.
  "pitstop.read":   { kind: "team", surfaces: ["goal.detail", "pitstop.detail", "pitstop.panel"] },
  "pitstop.create": OWN,
  "pitstop.update": OWN,

  "pitstop_event.list":       TEAM,
  "pitstop_event.read":       TEAM,
  "pitstop_event.create":     OWN,
  // Completion happens from the day-to-day surfaces only; the same grant is not
  // meant to authorise edits from anywhere else that happens to call the action.
  "pitstop_event.update":     { kind: "own", surfaces: [
    "home.today", "home.follow_ups", "home.past_load",
    "activities.list", "activities.add_modal", "activities.complete_modal",
    "activities.feed_panel", "activities.filter_sheet", "activities.reschedule_sheet",
    "operations.theme_portal", "operations.visit", "operations.today",
  ] },
  "pitstop_event.respond":    SELF,
  "pitstop_event.cancel":     OWN,
  "pitstop_event.reschedule": OWN,
  "pitstop_event.arrive":     OWN,

  // Visit-driven ops. A centre is visited by whoever is there that day, so the
  // lifecycle is not owner-scoped — an own-scoped visit.close strands a visit
  // someone else opened. Catalog approval is likewise open: RPs have no team,
  // so a TEAM rule left their own additions unapprovable.
  "visit.create": ALL,
  "visit.arrive": ALL,
  "visit.tick":   ALL,
  "visit.close":  ALL,
  "catalog.list":   ALL,
  "catalog.read":   ALL,
  "catalog.update": ALL,
  "catalog_item.create":  ALL,
  "catalog_item.approve": ALL,
  "catalog_item.deploy":  TEAM,

  "decision.list":   OWN,
  "decision.read":   OWN,
  "decision.create": OWN,
  "decision.update": OWN,
  "decision.delete": OWN,
  "risk.list":       OWN,
  "risk.read":       OWN,
  "risk.create":     OWN,
  "risk.update":     OWN,
  "risk.delete":     OWN,

  "settlement.list": ALL,
  "settlement.read": ALL,
  "cluster.list":    ALL,
  "cluster.read":    ALL,
  "zone.list":       ALL,
  "zone.read":       ALL,
  "city.list":       ALL,
  "city.read":       ALL,

  "programme.list":   OWN,
  "programme.read":   OWN,
  "programme.create": OWN,
  "programme.update": OWN,
  "programme.delete": OWN,

  // Catalog refresh 2026-05-22 — member reads on programme_journey are all-authenticated;
  // UI applies city filtering. Mutations + apply_pack stay admin-only.
  "programme_journey.list": ALL,
  "programme_journey.read": ALL,

  // Catalog refresh 2026-05-22 — PlanItem is user-owned (planner) with team visibility
  // for managers; mutations stay own-only.
  "plan_item.list":      TEAM,
  "plan_item.read":      TEAM,
  "plan_item.create":    OWN,
  "plan_item.update":    OWN,
  "plan_item.delete":    OWN,
  // ChecklistItem inherits scope from parent Pitstop, so member reads use TEAM
  // (same as pitstop). Writes stay own-only on the child.
  "checklist_item.list":   TEAM,
  "checklist_item.read":   TEAM,
  "checklist_item.create": OWN,
  "checklist_item.update": OWN,
  "checklist_item.delete": OWN,

  // ActionPoint follows the pitstop_event pattern. update = TEAM so ZL/PM/Leader
  // can mark done on the RP's behalf (close-authority rule, locked 2026-06-03).
  // delete = OWN: the raiser cancels their own; supervisors don't silently delete.
  "action_point.list":   TEAM,
  "action_point.read":   TEAM,
  "action_point.create": OWN,
  "action_point.update": TEAM,
  "action_point.delete": OWN,
  "action_point.assign": TEAM,

  "thread.list":         TEAM_OR_SUBSCRIBED,
  "thread.read":         TEAM_OR_SUBSCRIBED,
  "thread.post_message": OWN,
  "thread.subscribe":    SELF,

  "notification.list":      SELF,
  "notification.read":      SELF,
  "notification.mark_read": SELF,

  "map_note.list":             ALL,
  "map_note.read":             ALL,
  "map_partner.list":          ALL,
  "map_partner.read":          ALL,
  "layer_feature.list":        ALL,
  "layer_feature.read":        ALL,
  "needs_scheme.list":         ALL,
  "needs_scheme.read":         ALL,
  "needs_formula.list":        ALL,
  "needs_formula.read":        ALL,
  "template.list":             ALL,
  "template.read":             ALL,
  "facility_indicator.list":   ALL,
  "facility_indicator.read":   ALL,
  "facility_layer.list":       ALL,
  "facility_layer.read":       ALL,
  "journey_outcome_pack.list": ALL,
  "journey_outcome_pack.read": ALL,
  "mis_provider.list":         ALL,
  "mis_provider.read":         ALL,

  // ── Catalog refresh 2026-05-22 — new resources ─────────────────────────────
  // TeamMetrics (SLA, overdue, engagement panels): anyone with reports sees their
  // team's metrics. RP/Other see self only (effectively empty for aggregates).
  "team_metrics.list":     TEAM,
  "team_metrics.read":     TEAM,

  // EffectsIndicator (Layer 1 outcomes): all-authenticated read, admin mutate.
  "effects_indicator.list": ALL,
  "effects_indicator.read": ALL,

  // Master quarter + theme lists.
  "quarter.list": ALL,
  "quarter.read": ALL,
  "theme.list":   ALL,
  "theme.read":   ALL,

  // Standup + Retrospective: team-recursive read; own writes.
  "standup.list":          TEAM,
  "standup.read":          TEAM,
  "standup.create":        OWN,
  "standup.update":        OWN,
  "standup.delete":        OWN,
  "retrospective.list":    TEAM,
  "retrospective.read":    TEAM,
  "retrospective.create":  OWN,
  "retrospective.update":  OWN,
  "retrospective.delete":  OWN,

  // Command center: TEAM — supervisors (ZL/PM/Leader) only in practice; nav
  // additionally requires reports, and the page resolves allowed zones per
  // designation (RP/Other resolve to no zones and are redirected).
  "command_center.list": TEAM,
  "command_center.read": TEAM,

  // Caregiver practices: all-authenticated read (RPs need the taxonomy to
  // capture); taxonomy mutation is admin-only (via ADMIN_GRANTS = ALL).
  "caregiver_practice.list": ALL,
  "caregiver_practice.read": ALL,

  // Needs assessment + actuals: all-authenticated read, admin mutate.
  "needs_assessment.list": ALL,
  "needs_assessment.read": ALL,
  "needs_actual.list":     ALL,
  "needs_actual.read":     ALL,

  // MapData (read-only feeds): all read. Mutations admin-only — handled by ADMIN_GRANTS.
  "map_data.list": ALL,
  "map_data.read": ALL,

  // Calendar is purely self-scoped.
  "calendar.read":      SELF,
  "calendar.subscribe": SELF,

  // Attachment: read inherits parent record's scope (modelled as OWN here; the
  // actual fetch-time check verifies access via the linked resource).
  "attachment.read":   OWN,
  "attachment.create": OWN,
  "attachment.delete": OWN,

  // Search: any authenticated user; results are filtered through per-resource scopes downstream.
  "search.execute": ALL,

  // Operating Models — anyone authenticated can browse/play instances (the
  // funder-dashboard framing is internal-only across roles). Mutations on
  // instances are OWN (you can edit/delete what you created). Template
  // authoring is reserved for admin via ADMIN_GRANTS (no member rows here).
  "operating_model.list":              ALL,
  "operating_model.read":              ALL,
  "operating_model.create":            ALL,
  "operating_model.update":            OWN,
  "operating_model.delete":            OWN,
  "operating_model.promote_to_budget": OWN,
  "operating_model_template.list":     ALL,
  "operating_model_template.read":     ALL,
};

const VIEWER_GRANTS: RoleGrant = (() => {
  const out: RoleGrant = {};
  const SENSITIVE = new Set(["audit_log", "review_portal", "budget", "system", "recruitment"]);
  for (const [resource, actions] of Object.entries(RESOURCE_ACTIONS)) {
    if (SENSITIVE.has(resource)) continue;
    for (const action of actions) {
      if (action === "list" || action === "read" || action === "mark_read") {
        out[`${resource}.${action}`] = (resource === "user" || resource === "notification") ? SELF : ALL;
      }
    }
  }
  return out;
})();

const BUDGET_ADMIN_GRANTS: RoleGrant = {
  "budget.list":   ALL,
  "budget.read":   ALL,
  "budget.create": ALL,
  "budget.update": ALL,
  "budget.delete": ALL,
  "user.read":                SELF,
  "user.update":              SELF,
  "user.change_own_password": SELF,
  "notification.list":        SELF,
  "notification.read":        SELF,
  "notification.mark_read":   SELF,
};

// External grantee login. Confined to their own budgets + reports (scoping is
// enforced via GrantPartner.userId in the pages/actions; grants gate nav/can()).
const PARTNER_GRANTS: RoleGrant = {
  "budget.list":    OWN,
  "budget.read":    OWN,
  "budget.propose": OWN,
  "user.read":                SELF,
  "user.update":              SELF,
  "user.change_own_password": SELF,
  "notification.list":        SELF,
  "notification.read":        SELF,
  "notification.mark_read":   SELF,
};

export const ROLES_CONFIG: Array<{ name: string; description: string; grants: RoleGrant }> = [
  {
    name: "super-admin",
    description: "Apex role. Bootstrapped via ADMIN_EMAIL on first sign-in; thereafter assigned in the DB.",
    grants: SUPER_ADMIN_GRANTS,
  },
  {
    name: "admin",
    description: "Organisation admin. Configures settings, templates, geography. Cannot manage admin/super-admin users.",
    grants: ADMIN_GRANTS,
  },
  {
    name: "member",
    description: "Default contributor. Scope tracks the user's place in the reporting hierarchy via designation.",
    grants: MEMBER_GRANTS,
  },
  {
    name: "viewer",
    description: "Read-only. Cannot mutate any resource.",
    grants: VIEWER_GRANTS,
  },
  {
    name: "budget-admin",
    description: "Budget realm only.",
    grants: BUDGET_ADMIN_GRANTS,
  },
  {
    name: "partner",
    description: "External grantee login. Sees only their own budgets and the reports due.",
    grants: PARTNER_GRANTS,
  },
];

// ── Seed operations ──────────────────────────────────────────────────────────

export async function seedPermissions(): Promise<number> {
  const keys: { resource: string; action: string }[] = [];
  for (const [resource, actions] of Object.entries(RESOURCE_ACTIONS)) {
    for (const action of actions) keys.push({ resource, action });
  }
  for (const k of keys) {
    await prisma.permission.upsert({
      where: { resource_action: { resource: k.resource, action: k.action } },
      create: k,
      update: {},
    });
  }
  return keys.length;
}

export async function seedRole(name: string): Promise<number> {
  const cfg = ROLES_CONFIG.find((r) => r.name === name);
  if (!cfg) throw new Error(`[rbac-seed] unknown role: ${name}`);

  await prisma.role.upsert({
    where: { name: cfg.name },
    create: { name: cfg.name, description: cfg.description, isSystem: true },
    update: { description: cfg.description, isSystem: true },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { name: cfg.name } });

  const perms = await prisma.permission.findMany();
  const permByKey = new Map(perms.map((p) => [`${p.resource}.${p.action}`, p.id]));

  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

  const entries = Object.entries(cfg.grants);
  if (entries.length === 0) return 0;

  await prisma.rolePermission.createMany({
    data: entries.map(([key, scopeRule]) => {
      const permissionId = permByKey.get(key);
      if (!permissionId) throw new Error(`[rbac-seed] unknown permission key in ${cfg.name}: ${key}`);
      return { roleId: role.id, permissionId, scopeRule };
    }),
    skipDuplicates: true,
  });
  return entries.length;
}

export async function seedAllRoles(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const role of ROLES_CONFIG) counts[role.name] = await seedRole(role.name);
  return counts;
}
