"use client";

// Enum display-label editor (EnumLabelConfig). Code is the fixed behavior key; label is editable.
import { useCallback, useEffect, useState } from "react";
import { EditableText } from "@/components/controlplane/cells";

type Label = { code: string; label: string; color: string | null };
type Group = { enumKey: string; labels: Label[] };

const TITLES: Record<string, string> = {
  CaregiverPracticeStatus: "Caregiver practice — statuses",
  CaregiverPracticeAction: "Caregiver practice — actions",
  FacilityIndicatorSource: "Facility indicator — capture sources",
};

export default function LabelsTab() {
  const [groups, setGroups] = useState<Group[]>([]);
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/enum-labels");
    if (res.ok) setGroups(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (enumKey: string, l: Label, label: string) => {
    await fetch("/api/admin/enum-labels", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enumKey, code: l.code, label, color: l.color }),
    });
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-stone-400">Rename the options shown for fixed system values. The underlying value never changes.</p>
      {groups.map((g) => (
        <section key={g.enumKey}>
          <h3 className="text-sm font-semibold text-stone-700 mb-2">{TITLES[g.enumKey] ?? g.enumKey}</h3>
          <div className="space-y-1.5 max-w-2xl">
            {g.labels.map((l) => (
              <div key={l.code} className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-stone-400 bg-stone-100 rounded px-1.5 py-1 shrink-0 w-52 truncate" title={l.code}>{l.code}</span>
                <EditableText value={l.label} onSave={(v) => save(g.enumKey, l, v)} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
