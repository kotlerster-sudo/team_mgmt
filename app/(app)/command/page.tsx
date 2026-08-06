import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { resolveCommandScope } from "@/lib/operations/command";
import CommandCenter from "./CommandCenter";

export const dynamic = "force-dynamic";

/**
 * Operational Command Center — leader drill-down over the spine.
 *
 * Server shell only: auth → grant check → allowed-zone resolution. All data
 * flows through /api/command/* so zone / month / lens switches refetch without
 * navigation. RPs (no allowed zones) are bounced to their own /operations home.
 */
export default async function CommandPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const ctx = await buildRbacContext(session);
  if (!ctx) redirect("/login");
  if (!(await can(ctx, "command_center", "list"))) redirect("/operations");

  const zones = await resolveCommandScope(ctx);
  if (zones.length === 0) redirect("/operations");

  return (
    <SurfaceProvider id="command.view">
      <CommandCenter zones={zones} />
    </SurfaceProvider>
  );
}
