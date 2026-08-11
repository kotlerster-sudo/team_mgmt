"use client";

// Edit the display labels for behavior-bearing enums (the code/value stays fixed; only the label
// and — where relevant — colour are editable). De-hardcodes CaregiverPracticeStatus / Action /
// FacilityIndicatorSource into the EnumLabelConfig table.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ChevronLeft, Check } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

type Label = { code: string; label: string; color: string | null; meta: Record<string, unknown>; sortOrder: number };
type Group = { enumKey: string; labels: Label[] };

const TITLES: Record<string, string> = {
  CaregiverPracticeStatus: "Caregiver practice — statuses",
  CaregiverPracticeAction: "Caregiver practice — actions",
  FacilityIndicatorSource: "Facility indicator — capture sources",
};

export default function EnumLabelsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super-admin";

  const [groups, setGroups] = useState<Group[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/enum-labels");
    if (res.ok) setGroups(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (session && !isAdmin) router.replace("/settings"); }, [session, isAdmin, router]);
  if (!isAdmin) return null;

  const key = (enumKey: string, code: string) => `${enumKey}::${code}`;
  const save = async (enumKey: string, l: Label, label: string) => {
    await fetch("/api/admin/enum-labels", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enumKey, code: l.code, label, color: l.color }),
    });
    setSavedKey(key(enumKey, l.code));
    setTimeout(() => setSavedKey(null), 1500);
    await load();
  };

  return (
    <SurfaceProvider id="settings.index">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/settings" className="text-stone-400 hover:text-stone-600"><ChevronLeft className="w-5 h-5" /></Link>
          <div>
            <h1 className="text-xl font-semibold text-stone-900">Labels</h1>
            <p className="text-xs text-stone-400">Rename the options shown for fixed system values. The underlying value never changes.</p>
          </div>
        </div>

        {groups.map((g) => (
          <section key={g.enumKey} className="mb-8">
            <h2 className="text-sm font-semibold text-stone-700 mb-2">{TITLES[g.enumKey] ?? g.enumKey}</h2>
            <div className="space-y-2">
              {g.labels.map((l) => {
                const k = key(g.enumKey, l.code);
                const val = drafts[k] ?? l.label;
                return (
                  <div key={l.code} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-stone-400 bg-stone-100 rounded px-1.5 py-1 shrink-0 w-40 truncate" title={l.code}>{l.code}</span>
                    <input
                      value={val}
                      onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                      className="flex-1 px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white"
                    />
                    <button
                      onClick={() => save(g.enumKey, l, val.trim())}
                      disabled={!val.trim() || val.trim() === l.label}
                      className="px-3 py-1.5 text-xs font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-40 inline-flex items-center gap-1"
                    >
                      {savedKey === k ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : "Save"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </SurfaceProvider>
  );
}
