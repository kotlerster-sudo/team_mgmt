import { redirect } from "next/navigation";
import Link from "next/link";
import { PackagePlus, ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { loadShelfData } from "@/lib/operations/shelf";
import { ShelfClient } from "./ShelfClient";

export const dynamic = "force-dynamic";

/**
 * Catalog shelf — a supervisor deploys optional checklist+activity items onto an RP's live centre.
 * Pick RP → their live centre → items off the domain shelf → deploy. Gated on catalog_item.deploy
 * (TEAM) and the oversight visibility rule (RPs are self-only → bounced).
 */
export default async function ShelfPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const ctx = await buildRbacContext(session);
  if (!ctx) redirect("/login");

  const visibleIds = await getVisibleUserIds(ctx);
  const isAdmin = ctx.role === "admin" || ctx.role === "super-admin";
  if ((visibleIds.length <= 1 && !isAdmin) || !(await can(ctx, "catalog_item", "deploy"))) {
    redirect("/operations");
  }

  const rps = await loadShelfData(visibleIds);

  return (
    <SurfaceProvider id="operations.shelf">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-6">
        <header>
          <Link href="/operations/oversight" className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600">
            <ChevronLeft className="w-3.5 h-3.5" /> Oversight
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <PackagePlus className="w-4 h-4 text-sky-600 shrink-0" />
            <h1 className="text-lg font-semibold text-stone-900">Deploy catalog items</h1>
          </div>
          <p className="text-sm text-stone-500 mt-0.5">
            Assign optional checklist items to an RP&apos;s live centre. They appear on the next visit and
            fire indicators on completion.
          </p>
        </header>

        {rps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
            No live centres in your team to deploy to yet.
          </div>
        ) : (
          <ShelfClient rps={rps} />
        )}
      </div>
    </SurfaceProvider>
  );
}
