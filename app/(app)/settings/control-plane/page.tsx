"use client";

// Backend Control Plane — a tabbed "toolbox": one editable table per config entity (edit inline,
// then and there), plus a read-only Graph view tab to see connections + broken edges. Replaces the
// old graph-as-editor. Editing flows through the existing dual-writing admin endpoints.

import { useEffect, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import GraphTab from "@/components/controlplane/tabs/GraphTab";
import TemplatesTab from "@/components/controlplane/tabs/TemplatesTab";
import CatalogsTab from "@/components/controlplane/tabs/CatalogsTab";
import IndicatorsTab from "@/components/controlplane/tabs/IndicatorsTab";
import OutcomesTab from "@/components/controlplane/tabs/OutcomesTab";
import CaregiverPracticesTab from "@/components/controlplane/tabs/CaregiverPracticesTab";
import FacilityLayersTab from "@/components/controlplane/tabs/FacilityLayersTab";
import LabelsTab from "@/components/controlplane/tabs/LabelsTab";

const TABS: { key: string; label: string; Component: ComponentType }[] = [
  { key: "templates", label: "Templates", Component: TemplatesTab },
  { key: "catalogs", label: "Catalogs", Component: CatalogsTab },
  { key: "indicators", label: "Indicators", Component: IndicatorsTab },
  { key: "outcomes", label: "Outcomes", Component: OutcomesTab },
  { key: "caregiver", label: "Caregiver practices", Component: CaregiverPracticesTab },
  { key: "layers", label: "Facility layers", Component: FacilityLayersTab },
  { key: "labels", label: "Labels", Component: LabelsTab },
  { key: "graph", label: "Graph view", Component: GraphTab },
];

export default function ControlPlanePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super-admin";
  const [active, setActive] = useState(TABS[0].key);

  useEffect(() => { if (session && !isAdmin) router.replace("/settings"); }, [session, isAdmin, router]);
  if (!isAdmin) return null;

  const ActiveTab = TABS.find((t) => t.key === active)?.Component ?? TABS[0].Component;

  return (
    <SurfaceProvider id="settings.index">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/settings" className="text-stone-400 hover:text-stone-600"><ChevronLeft className="w-5 h-5" /></Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-stone-900">Backend Control Plane</h1>
            <p className="text-xs text-stone-400">Edit every config entity inline. The Graph tab is a read-only view.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-stone-200 mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${active === t.key ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <ActiveTab />
      </div>
    </SurfaceProvider>
  );
}
