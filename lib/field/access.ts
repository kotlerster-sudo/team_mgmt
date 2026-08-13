// Access gate for the /field surface (P3 dogfood). While the surface is being
// validated it is OFF by default and reachable only by:
//   • anyone, when FIELD_SURFACE_ENABLED === "1" (global on), OR
//   • a user whose email is in FIELD_ALLOWLIST (comma-separated), OR
//   • an admin (so the team can preview it).
// At cut-over (P4) this relaxes to "all RPs".
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";

export type FieldSession = { userId: string; email: string | null };

export async function getFieldSession(): Promise<FieldSession | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  if (!fieldEnabledForSession(session)) return null;
  return { userId, email: session.user.email ?? null };
}

/**
 * Gate the /field backend console. Allowed for admins/super-admins (as before)
 * OR any role granted the `field.manage` permission via /settings/roles — so
 * a programme lead can manage the field backend without being a super-admin.
 * Returns userId or null.
 */
export async function requireFieldAdmin(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  if (isAdminUser(session)) return userId;
  const { buildRbacContext, can } = await import("@/lib/rbac");
  const ctx = await buildRbacContext(session);
  if (ctx && (await can(ctx, "field", "manage"))) return userId;
  return null;
}

/** Whether this session may see /field (env global, admin, or allowlist). Safe to call in the layout. */
export function fieldEnabledForSession(session: Awaited<ReturnType<typeof auth>>): boolean {
  if (process.env.FIELD_SURFACE_ENABLED === "1") return true;
  if (session && isAdminUser(session)) return true;
  const email = session?.user?.email?.toLowerCase();
  const allow = (process.env.FIELD_ALLOWLIST ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allow.includes(email);
}

/**
 * Verify the user may act on this goal from /field: it must be one of their
 * interventions (owned, or in a cluster they work in) and in an active field domain.
 * Returns the goal id if allowed, else null.
 */
export async function assertFieldGoalAccess(userId: string, goalId: string): Promise<string | null> {
  const { getUserClusters, goalInClusterFilter } = await import("@/lib/operations/clusters");
  const { goalOwnedByAnyOf } = await import("@/lib/ownership");
  const domains = await activeFieldDomains();
  if (domains.size === 0) return null;
  const clusters = await getUserClusters([userId]);
  const goal = await prisma.goal.findFirst({
    where: {
      id: goalId,
      deletedAt: null,
      needsDomain: { in: [...domains.keys()] },
      OR: [goalOwnedByAnyOf([userId]), ...clusters.map((c) => goalInClusterFilter(c.id))],
    },
    select: { id: true },
  });
  return goal?.id ?? null;
}

/** Domains that have been onboarded onto /field (have a FieldDomainConfig row). */
export async function activeFieldDomains(): Promise<Map<string, { label: string; unit: string; cadenceCount: number | null; cadencePeriod: string | null; overallSlaDays: number | null }>> {
  const rows = await prisma.fieldDomainConfig.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  return new Map(rows.map((r) => [r.domain, { label: r.label, unit: r.unit, cadenceCount: r.cadenceCount, cadencePeriod: r.cadencePeriod, overallSlaDays: r.overallSlaDays }]));
}
