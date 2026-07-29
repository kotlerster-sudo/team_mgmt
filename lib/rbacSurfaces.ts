/**
 * Surface registry — the closed set of UI contexts an action may originate from.
 *
 * A "surface" is a named UI region (page, tab, panel, sheet) that a user is
 * standing on when they trigger a mutation. The RBAC layer can constrain a
 * grant to a subset of surfaces — e.g. RPs may only complete activities from
 * `home.today` or `activities.list`, not from `pitstop.detail` or
 * `pitstop.panel`.
 *
 * Conventions:
 *   - IDs are dotted, lowercase. Prefix = page family (home / pitstop / goal …).
 *     The settings UI groups by prefix.
 *   - `<SurfaceProvider id="..."/>` declares the surface on the React tree.
 *   - `fetchJson()` reads the current surface from context and sends
 *     `X-Surface: <id>` with every mutation. The server inspects it via
 *     `getSurface(req)` and feeds it to `buildRbacContext(session, { req })`.
 *
 * Adding a surface = 2 lines: one entry here + one `<SurfaceProvider>` wrap on
 * the component. Leaving a page unwrapped means requests from it carry no
 * surface header — they pass any grant whose `scopeRule.surfaces` is undefined
 * (the default), but are denied by any grant that restricts surfaces.
 */

export type SurfaceDef = {
  /** Stable dotted ID (e.g. `home.today`). Used in grants and on the wire. */
  id: string;
  /** Human label for the settings UI. */
  label: string;
  /** Group label; defaults to the prefix before the first dot. */
  group?: string;
  /** Optional one-line description shown under the label in settings. */
  description?: string;
};

export const SURFACES: ReadonlyArray<SurfaceDef> = [
  // ── Home ─────────────────────────────────────────────────────────────────
  { id: "home.today",       label: "Today tab",       description: "RP/leader Today carousel + sections" },
  { id: "home.follow_ups",  label: "Follow-ups tab",  description: "Action-point follow-ups" },
  { id: "home.past_load",   label: "Past Load tab",   description: "Older activities / done log" },
  { id: "home.engagement",  label: "Engagement tab",  description: "Per-person activity feed" },
  { id: "home.goals",       label: "Goals tab" },
  { id: "home.overview",    label: "Overview tab",    description: "Admin overview" },
  { id: "home.attention",   label: "Attention tab",   description: "Admin attention" },
  { id: "home.team_health", label: "Team Health tab" },
  { id: "home.coverage",    label: "Field Coverage tab" },
  { id: "home.geography",   label: "Geography tab" },
  { id: "home.team",        label: "Team tab",        description: "Team directory / workload" },
  { id: "home.clusters",    label: "Cluster Status tab" },
  { id: "home.pipeline",    label: "Pipeline tab" },
  { id: "home.activity",    label: "Activity tab" },
  { id: "home.zl_health",   label: "ZL Health tab" },
  { id: "home.rp_health",   label: "RP Health tab" },
  { id: "home.health",      label: "Health tab" },
  { id: "home.past",        label: "Past tab" },
  { id: "home.accountability", label: "Accountability tab", description: "Due-anchored team accountability across goal/pitstop/checklist/activity/follow-up layers" },

  // ── Operations (Swiggy-style daily driver) ────────────────────────────────
  { id: "operations.home",          label: "Operations home",        description: "Theme tiles + on-the-ground today" },
  { id: "operations.theme_portal",  label: "Theme portal",           description: "Phase-aware per-centre list for one theme" },
  { id: "operations.today",         label: "On-the-ground today",    description: "Cluster→theme→centre daily driver" },
  { id: "operations.month_planner", label: "Month-end planner",      description: "Pre-filled drag-adjust next-month plan" },
  { id: "operations.oversight",     label: "Supervisory oversight",  description: "Zone→cluster→RP→centre drill-down + approvals for ZL/PM/Leader" },
  { id: "operations.dashboard",     label: "Cluster health dashboard", description: "Cross-cluster composite standing (overdue + cadence + approvals) for ZL/PM/Leader" },
  { id: "operations.shelf",         label: "Catalog shelf (deploy)", description: "Supervisor deploys catalog items to an RP's live centre" },
  { id: "operations.visit",         label: "Live-centre visit",      description: "RP's per-visit checklist/activity completion (voice/upload/done)" },

  // ── Pitstop ──────────────────────────────────────────────────────────────
  { id: "pitstop.list",          label: "Pitstops list" },
  { id: "pitstop.detail",        label: "Pitstop detail page", description: "Full-screen pitstop view" },
  { id: "pitstop.panel",         label: "Pitstop side panel",  description: "Quick sheet opened from flows/lists" },
  { id: "pitstop.create_modal",  label: "Create-pitstop modal" },
  { id: "pitstop.ap_panel",      label: "Pitstop action-points panel" },
  { id: "pitstop.reschedule_modal", label: "Pitstop reschedule modal" },

  // ── Activities / catalog ─────────────────────────────────────────────────
  { id: "activities.list",            label: "Activities catalog" },
  { id: "activities.add_modal",       label: "Add-activity modal" },
  { id: "activities.complete_modal",  label: "Complete-activity modal" },
  { id: "activities.reschedule_sheet", label: "Reschedule sheet" },
  { id: "activities.batch_reschedule_sheet", label: "Batch reschedule sheet" },
  { id: "activities.feed_panel",      label: "Activity feed panel" },
  { id: "activities.filter_sheet",    label: "Today filter sheet" },
  { id: "activities.reschedule_alerts_panel", label: "ZL reschedule alerts panel" },

  // ── Goal / flow ──────────────────────────────────────────────────────────
  { id: "goal.detail",          label: "Goal detail page" },
  { id: "goal.flow",            label: "Goal flow board" },
  { id: "goal.create_modal",    label: "Create-goal modal" },
  { id: "goal.edit_modal",      label: "Edit-goal modal" },

  // ── Action points ────────────────────────────────────────────────────────
  { id: "action_point.edit_modal",     label: "Edit action-point modal" },
  { id: "action_point.mark_done_modal", label: "Mark AP done modal" },

  // ── Wiki ─────────────────────────────────────────────────────────────────
  { id: "wiki.list",              label: "Wiki list page" },
  { id: "wiki.reader",            label: "Wiki entry reader" },
  { id: "wiki.editor",            label: "Wiki entry editor" },
  { id: "wiki.new",               label: "Wiki new entry" },
  { id: "wiki.capture",           label: "Wiki capture page" },
  { id: "wiki.capture_sheet",     label: "Wiki capture sheet" },
  { id: "wiki.circles",           label: "Wiki circles list" },
  { id: "wiki.circle_new",        label: "Wiki new circle" },
  { id: "wiki.circle_detail",     label: "Wiki circle detail" },
  { id: "wiki.partner_reviews",   label: "Wiki partner reviews list" },
  { id: "wiki.partner_review_new", label: "Wiki new partner review" },
  { id: "wiki.partner_review_detail", label: "Wiki partner review detail" },
  { id: "wiki.gaps",              label: "Wiki gaps queue" },
  { id: "wiki.dashboard",         label: "Wiki curator dashboard" },
  { id: "wiki.audit",             label: "Wiki audit page" },
  { id: "wiki.translation_queue", label: "Wiki translation queue" },
  { id: "wiki.observations",      label: "Wiki observations" },

  // ── Wiki v2 (programme-spine reference) ─────────────────────────────────
  { id: "wiki.programs",        label: "Wiki programmes grid" },
  { id: "wiki.elderly_spine",   label: "Elderly EVRAT spine" },
  { id: "wiki.fork_panel",      label: "Wiki fork panel",      description: "Side panel showing guideline / care plan / action manual content for a question" },
  { id: "wiki.article_view",    label: "Wiki article direct view" },
  { id: "wiki.article_edit",    label: "Wiki article editor" },
  { id: "wiki.category",        label: "Wiki category page" },
  { id: "wiki.search",          label: "Wiki search" },
  { id: "wiki.version_history", label: "Wiki version history modal" },
  { id: "wiki.fork_modal",      label: "Wiki fork-article confirm modal" },
  { id: "wiki.link_manager",    label: "Wiki link manager modal" },

  // ── Manual ───────────────────────────────────────────────────────────────
  { id: "manual.list",   label: "Manual list page" },
  { id: "manual.reader", label: "Manual entry reader" },
  { id: "manual.editor", label: "Manual entry editor" },
  { id: "manual.new",    label: "Manual new entry" },

  // ── Models ───────────────────────────────────────────────────────────────
  { id: "models.list",            label: "Models list" },
  { id: "models.detail",          label: "Model instance detail" },
  { id: "models.compare",         label: "Model compare view" },
  { id: "models.templates",       label: "Model templates list" },
  { id: "models.template_detail", label: "Model template detail" },

  // ── Programmes / programs ────────────────────────────────────────────────
  { id: "programmes.list",    label: "Programmes list" },
  { id: "programmes.detail",  label: "Programme detail" },
  { id: "programmes.outcome", label: "Programme outcome page" },
  { id: "programs.list",      label: "Programs list (legacy)" },
  { id: "programs.detail",    label: "Program detail (legacy)" },

  // ── Needs ────────────────────────────────────────────────────────────────
  { id: "needs.list",       label: "Needs list" },
  { id: "needs.settlement", label: "Needs settlement detail" },

  // ── Map ──────────────────────────────────────────────────────────────────
  { id: "map.view",         label: "Map page" },
  { id: "map.layer_panel",  label: "Map layer panel" },
  { id: "map.admin_panel",  label: "Map admin panel" },
  { id: "map.needs_panel",  label: "Map needs panel" },
  { id: "map.stats_panel",  label: "Map stats panel" },

  // ── Settings ─────────────────────────────────────────────────────────────
  { id: "settings.index",                label: "Settings landing" },
  { id: "settings.roles",                label: "Roles list" },
  { id: "settings.role_detail",          label: "Role editor" },
  { id: "settings.users",                label: "Users settings" },
  { id: "settings.templates",            label: "Templates list" },
  { id: "settings.template_detail",      label: "Template editor" },
  { id: "settings.template_sync_modal",  label: "Template sync modal" },
  { id: "settings.geography",            label: "Geography settings" },
  { id: "settings.needs",                label: "Needs settings" },
  { id: "settings.facility_indicators",  label: "Facility indicators settings" },
  { id: "settings.facility_layers",      label: "Facility layers settings" },
  { id: "settings.journey_outcome_packs", label: "Journey outcome packs settings" },
  { id: "settings.mis_providers",        label: "MIS providers settings" },
  { id: "settings.map_features",         label: "Map features settings" },
  { id: "settings.notifications",        label: "Notifications settings" },
  { id: "settings.audit",                label: "Audit log" },
  { id: "settings.wiki_staff",           label: "Wiki staff settings" },
  { id: "settings.language",             label: "Language settings" },

  // ── Help ─────────────────────────────────────────────────────────────────
  { id: "help.index",         label: "Help index" },
  { id: "help.templates",     label: "Help templates list" },
  { id: "help.template_detail", label: "Help template detail" },

  // ── Top-level pages ──────────────────────────────────────────────────────
  { id: "dashboard.view",     label: "Dashboard" },
  { id: "decisions.list",     label: "Decisions list" },
  { id: "effects.view",       label: "Effects page" },
  { id: "gantt.view",         label: "Gantt page" },
  { id: "geography.view",     label: "Geography page" },
  { id: "notifications.list", label: "Notifications list" },
  { id: "partners.list",      label: "Partners list" },
  { id: "people.list",        label: "People page" },
  { id: "planner.view",       label: "Planner page" },
  { id: "portal.view",        label: "Portal page" },
  { id: "quarters.view",      label: "Quarters dashboard" },
  { id: "readiness.view",     label: "Readiness page" },
  { id: "report.view",        label: "Report page" },
  { id: "review.view",        label: "Review portal" },
  { id: "risks.list",         label: "Risks list" },
  { id: "route.view",         label: "Route map page" },
  { id: "settlement.detail",  label: "Settlement detail" },
  { id: "sla.view",           label: "SLA page" },
  { id: "standup.view",       label: "Standup page" },
  { id: "themes.view",        label: "Themes page" },
  { id: "threads.list",       label: "Threads list" },
  { id: "timeline.view",      label: "Timeline page" },
  { id: "visits.view",        label: "Visits planner" },

  // ── Cross-cutting ────────────────────────────────────────────────────────
  { id: "search.modal",            label: "Search modal" },
  { id: "template.picker_modal",   label: "Template picker modal" },
];

const SURFACE_BY_ID = new Map(SURFACES.map((s) => [s.id, s]));

export const SURFACE_IDS = SURFACES.map((s) => s.id);

export function isKnownSurface(id: string | null | undefined): id is string {
  return !!id && SURFACE_BY_ID.has(id);
}

export function getSurfaceDef(id: string): SurfaceDef | undefined {
  return SURFACE_BY_ID.get(id);
}

/** Groups surfaces by their `group` (or first dotted segment). UI ordering helper. */
export function groupedSurfaces(): Array<{ group: string; surfaces: SurfaceDef[] }> {
  const map = new Map<string, SurfaceDef[]>();
  for (const s of SURFACES) {
    const g = s.group ?? s.id.split(".")[0];
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(s);
  }
  return [...map.entries()].map(([group, surfaces]) => ({ group, surfaces }));
}
