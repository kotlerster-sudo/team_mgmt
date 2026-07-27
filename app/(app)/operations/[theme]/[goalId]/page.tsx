import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, MapPin } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { resolveViewContext } from "@/lib/operations/viewAs";
import { loadCentreDetail } from "@/lib/operations/today";
import { CentreDetail } from "../../_shared/CentreDetail";
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
  searchParams: Promise<{ asUser?: string; lens?: string }>;
}) {
  const { theme, goalId } = await params;
  const { asUser, lens: lensParam } = await searchParams;
  const ctx = await resolveViewContext(asUser);
  if (!ctx) redirect("/login");
  const preview = ctx.viewingAs;
  const lens: "today" | "overdue" | null =
    lensParam === "today" ? "today" : lensParam === "overdue" ? "overdue" : null;

  const detail = await loadCentreDetail([ctx.userId], goalId);
  if (!detail) notFound();

  // Back link returns to the same lens view of the programme.
  const themeQs = [lens ? `lens=${lens}` : "", preview ? `asUser=${encodeURIComponent(ctx.userId)}` : ""].filter(Boolean).join("&");
  const themeHref = `/operations/${encodeURIComponent(theme)}${themeQs ? `?${themeQs}` : ""}`;
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

        <CentreDetail
          activities={detail.activities}
          checklists={detail.checklists}
          followUps={detail.followUps}
          readOnly={!!preview}
          storageKey={`ops-centre-${detail.goalId}-done`}
          initialOpen={lens ?? "today"}
        />
      </div>
    </SurfaceProvider>
  );
}
