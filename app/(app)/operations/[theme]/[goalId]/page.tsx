import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, MapPin } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import prisma from "@/lib/prisma";
import { resolveViewContext } from "@/lib/operations/viewAs";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { goalOwnedByAnyOf } from "@/lib/ownership";
import { loadCentreDetail } from "@/lib/operations/today";
import { loadCentreCatalogView } from "@/lib/operations/catalogView";
import { loadCentrePlan } from "@/lib/operations/plan";
import { CentreDetail } from "../../_shared/CentreDetail";
import { CentrePlan } from "../../_shared/plan/CentrePlan";
import { CatalogViewer } from "../../_shared/CatalogViewer";
import { GoLiveButton } from "../../_shared/GoLiveButton";
import { RevertToSetupButton } from "../../_shared/RevertToSetupButton";
import { PreviewBanner } from "../../_shared/PreviewBanner";

export const dynamic = "force-dynamic";

/**
 * Centre drill-down — one centre's activities (this visit's tasks), grouped
 * Today / Overdue / Upcoming, plus follow-ups. Completion writes to the spine.
 */
export default async function CentreDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ theme: string; goalId: string }>;
  searchParams: Promise<{ asUser?: string; lens?: string; from?: string }>;
}) {
  const { theme, goalId } = await params;
  const { asUser, lens: lensParam, from } = await searchParams;
  const ctx = await resolveViewContext(asUser);
  if (!ctx) redirect("/login");
  const preview = ctx.viewingAs;
  const fromOversight = from === "oversight";
  const lens: "today" | "overdue" | null =
    lensParam === "today" ? "today" : lensParam === "overdue" ? "overdue" : null;

  // Widen the load to the viewer's supervised set so a ZL/PM/Leader can open a reportee's
  // centre. A centre the viewer doesn't personally own is shown read-only (they supervise,
  // not execute); their own centres stay interactive. RPs resolve to [self] — unchanged.
  const me = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { role: true, designation: true },
  });
  const visibleIds = me
    ? await getVisibleUserIds({ userId: ctx.userId, role: me.role ?? "member", designation: me.designation ?? "Other" })
    : [ctx.userId];

  const [detail, catalog, plan] = await Promise.all([
    loadCentreDetail(visibleIds, goalId),
    loadCentreCatalogView(goalId),
    loadCentrePlan(goalId),
  ]);
  if (!detail) notFound();

  // Setup-mode centres get the WBS one-page plan; live centres keep the visit/activity view.
  const isSetup = catalog ? catalog.mode !== "live" : detail.phase.lifecycle !== "live";

  const ownedBySelf =
    (await prisma.goal.count({ where: { id: goalId, ...goalOwnedByAnyOf([ctx.userId]) } })) > 0;
  const readOnly = !!preview || !ownedBySelf;

  // Back link returns to where the drill came from — the oversight tree or the theme portal.
  const asUserQs = preview ? `asUser=${encodeURIComponent(ctx.userId)}` : "";
  const themeQs = [lens ? `lens=${lens}` : "", asUserQs].filter(Boolean).join("&");
  const themeHref = fromOversight
    ? "/operations/oversight"
    : `/operations/${encodeURIComponent(theme)}${themeQs ? `?${themeQs}` : ""}`;
  const ph = detail.phase;
  const phaseLabel =
    ph.lifecycle === "setting_up" ? `${ph.currentPhaseLabel ?? "In setup"} · ${ph.currentStep}/${ph.totalSteps}`
    : ph.lifecycle === "live" ? "Live"
    : "Done";

  return (
    <SurfaceProvider id="operations.theme_portal">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-6">
        {preview && <PreviewBanner name={preview.name} exitHref="/operations" />}
        <div>
          <Link href={themeHref} className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600">
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </Link>
          <h1 className="text-lg font-semibold text-stone-900 mt-1">{detail.name}</h1>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-stone-500">
            {detail.cluster && (
              <span className="inline-flex items-center gap-0.5"><MapPin className="w-3 h-3" />{detail.cluster.name}</span>
            )}
            <span className="text-stone-300">·</span>
            <span className={ph.lifecycle === "setting_up" ? "text-amber-700 font-medium" : "text-emerald-700 font-medium"}>
              {phaseLabel}
            </span>
          </div>
        </div>

        {/* Setup centre with an authored domain catalog → offer to take it live. */}
        {catalog && catalog.mode !== "live" && catalog.hasDomainCatalog && !preview && (
          <GoLiveButton goalId={goalId} />
        )}

        {/* Live centre → show its visit catalog (cadence editor + add-item + Log-visit). */}
        {catalog?.live && !preview && (
          <div className="space-y-2">
            <CatalogViewer goalId={goalId} live={catalog.live} readOnly={readOnly} />
            {!readOnly && (
              <div className="flex justify-end">
                <RevertToSetupButton goalId={goalId} />
              </div>
            )}
          </div>
        )}

        {isSetup && plan ? (
          <CentrePlan plan={plan} />
        ) : (
          <CentreDetail
            activities={detail.activities}
            checklists={detail.checklists}
            followUps={detail.followUps}
            readOnly={readOnly}
            storageKey={`ops-centre-${detail.goalId}-done`}
            initialOpen={lens ?? "today"}
            phase={detail.phase}
            monthDone={detail.monthDone}
            monthRequired={detail.monthRequired}
          />
        )}
      </div>
    </SurfaceProvider>
  );
}
