"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { compute, computeSensitivity } from "@/lib/models/engine";
import type { DaySimConfig, InstanceInputs, ModelNode, ModelOutput, ModelTemplate, NodeValue } from "@/lib/models/types";
import { forkScenario, promoteToBudget, saveInstanceInputs, searchPitstops, setInstancePitstop } from "./actions";
import OperationsSim from "./OperationsSim";
import { pickersForTemplate, managedNodeKeys, expandPickerValue, inferPickerValue, type EnumPicker } from "./inputEnumPickers";

type Sibling = { id: string; name: string; scenarioName: string | null };

type AttachedPitstop = {
  id: string; title: string; goalTitle: string | null;
  settlement: {
    id: string; name: string;
    totalHouseholds: number; children6m3yr: number; children4to14: number;
    youth15to21: number; elderly60plus: number;
  } | null;
};

type Props = {
  instanceId: string;
  instanceName: string;
  scenarioName: string | null;
  template: ModelTemplate;
  initialInputs: InstanceInputs;
  siblings: Sibling[] | null;
  headId: string;
  attachedPitstop: AttachedPitstop | null;
  canSeeDashboard: boolean;
};

type ViewMode = "dashboard" | "editor" | "sim";
type SimTier = "basic" | "advanced";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const fmtINR = (n: number) => {
  if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};
const fmtNum = (n: number) => {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const formatScalar = (v: NodeValue | undefined, format: string | undefined): string => {
  if (v === undefined || v === null) return "—";
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (format === "currency") return fmtINR(v as number);
  if (format === "percent") return fmtPct(v as number);
  return fmtNum(v as number);
};

export default function PlayWorkbench({ instanceId, instanceName, scenarioName, template, initialInputs, siblings, headId, attachedPitstop, canSeeDashboard }: Props) {
  const router = useRouter();
  const [inputs, setInputs] = useState<InstanceInputs>(initialInputs);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const dirtyRef = useRef(false);
  const [isForkPending, startFork] = useTransition();

  // View mode: leadership users land on "dashboard" by default; everyone else on
  // "editor". "sim" (Operations) is available to all. Per-user choice persists.
  const [mode, setMode] = useState<ViewMode>(canSeeDashboard ? "dashboard" : "editor");
  // Sim-tab Basic/Advanced toggle — Advanced reveals engineering-constant nodes.
  const [simTier, setSimTier] = useState<SimTier>("basic");
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("models:viewMode") : null;
    if (saved === "sim" || saved === "editor" || (saved === "dashboard" && canSeeDashboard)) {
      setMode(saved as ViewMode);
    }
  }, [canSeeDashboard]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("models:viewMode", mode);
  }, [mode]);

  // Debounced autosave. Triggers ~600ms after the last edit; cancels in-flight
  // saves implicitly because each call re-reads `inputs` from state.
  useEffect(() => {
    if (!dirtyRef.current) return;
    setSaveState("saving");
    const handle = setTimeout(async () => {
      try {
        await saveInstanceInputs(instanceId, inputs);
        setSaveState("saved");
        dirtyRef.current = false;
        setTimeout(() => setSaveState(s => (s === "saved" ? "idle" : s)), 1500);
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [inputs, instanceId]);

  const result = useMemo(() => compute(template, inputs), [template, inputs]);

  // The daySim output (if any) carries the nodeKey map → sim params. OperationsSim
  // resolves it against the computed values (one source of truth) and picks the
  // matching schematic renderer.
  const daySimConfig = useMemo<DaySimConfig | null>(() => {
    const out = template.outputs.find(o => o.kind === "daySim");
    return out ? (out.config as DaySimConfig) : null;
  }, [template.outputs]);

  const groupsByKey = useMemo(() => Object.fromEntries(template.groups.map(g => [g.key, g])), [template.groups]);

  // Active surface drives which input groups/nodes show. Finance for the
  // dashboard/editor tabs, sim for Operations. A node's effective surface is its
  // own (when not "both") else its group's. On the sim tab, the Basic/Advanced
  // toggle additionally hides tier="advanced" nodes until flipped.
  const activeSurface: "finance" | "sim" = mode === "sim" ? "sim" : "finance";
  const effSurface = (n: ModelNode): "finance" | "sim" | "both" => {
    if (n.surface && n.surface !== "both") return n.surface;
    const gs = groupsByKey[n.groupKey ?? ""]?.surface;
    if (gs && gs !== "both") return gs;
    return "both";
  };
  // Enum pickers translate a single dropdown into multiple sentinel inputs
  // (exactly one is 1). Managed nodes are hidden from the numeric list; the
  // picker renders in the same group instead.
  const enumPickers = useMemo(() => pickersForTemplate(template.key), [template.key]);
  const managedKeys = useMemo(() => managedNodeKeys(template.key), [template.key]);
  const nodeDefaults = useMemo(() => {
    const out: Record<string, number> = {};
    for (const n of template.nodes) {
      if ((n.kind === "input" || n.kind === "constant") && typeof n.default === "number") {
        out[n.key] = n.default;
      }
    }
    return out;
  }, [template.nodes]);

  const inputNodes = template.nodes.filter(n => {
    if (n.kind !== "input" && n.kind !== "constant") return false;
    if (managedKeys.has(n.key)) return false;
    const es = effSurface(n);
    if (es !== "both" && es !== activeSurface) return false;
    if (mode === "sim" && simTier === "basic" && n.tier === "advanced") return false;
    return true;
  });
  const inputsByGroup = inputNodes.reduce<Record<string, typeof inputNodes>>((acc, n) => {
    const k = n.groupKey ?? "__ungrouped";
    (acc[k] = acc[k] ?? []).push(n);
    return acc;
  }, {});
  const orderedGroupKeys = [
    ...template.groups.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(g => g.key),
    ...(inputsByGroup.__ungrouped ? ["__ungrouped"] : []),
  ].filter(k => inputsByGroup[k]?.length);

  const setInputVal = (key: string, raw: string) => {
    dirtyRef.current = true;
    setSaveState("dirty");
    if (raw === "") {
      const next = { ...inputs }; delete next[key]; setInputs(next);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) setInputs({ ...inputs, [key]: n });
  };
  // Enum picker: writes all sentinel keys at once.
  const setPickerVal = (picker: EnumPicker, value: string) => {
    dirtyRef.current = true;
    setSaveState("dirty");
    setInputs({ ...inputs, ...expandPickerValue(picker, value) });
  };
  // Which pickers belong in a given group's render pass, filtered by the
  // active surface (so sim tab doesn't show finance-only pickers). We infer
  // surface from the first managed node — pickers manage sibling sentinels.
  const pickersForGroup = (groupKey: string): EnumPicker[] =>
    enumPickers.filter(p => {
      if (p.groupKey !== groupKey) return false;
      const anyManaged = template.nodes.find(n => p.managedNodeKeys.includes(n.key));
      if (!anyManaged) return false;
      const es = effSurface(anyManaged);
      return es === "both" || es === activeSurface;
    });
  const resetInputs = () => {
    dirtyRef.current = true;
    setSaveState("dirty");
    setInputs({});
  };

  const renderPicker = (p: EnumPicker) => (
    <label key={p.pickerKey} className="block">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-stone-600 truncate" title={p.label}>{p.label}</span>
      </div>
      <select
        value={inferPickerValue(p, inputs, nodeDefaults)}
        onChange={e => setPickerVal(p, e.target.value)}
        className="mt-1 w-full px-2 py-1 rounded-md border border-stone-200 text-sm focus:border-sky-400 focus:ring-1 focus:ring-sky-400 outline-none"
      >
        {p.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );

  const tabBtn = (m: ViewMode) =>
    `px-3 py-1 text-xs rounded ${mode === m ? "bg-white shadow text-stone-900" : "text-stone-500 hover:text-stone-700"}`;
  const modeToggle = (
    <div className="inline-flex rounded-md bg-stone-100 p-0.5">
      {canSeeDashboard && (
        <button onClick={() => setMode("dashboard")} className={tabBtn("dashboard")}>Leadership</button>
      )}
      <button onClick={() => setMode("editor")} className={tabBtn("editor")}>Editor</button>
      <button onClick={() => setMode("sim")} className={tabBtn("sim")}>Operations</button>
    </div>
  );

  const scenarioChips = siblings && (
    <div className="flex items-center gap-1 flex-wrap">
      {siblings.map(s => (
        <Link
          key={s.id}
          href={`/models/${s.id}`}
          className={`text-xs px-2 py-0.5 rounded ${s.id === instanceId ? "bg-sky-100 text-sky-700" : "text-stone-500 hover:bg-stone-100"}`}
        >
          {s.scenarioName ?? s.name}
        </Link>
      ))}
      <Link href={`/models/${headId}/compare`} className="text-xs px-2 py-0.5 rounded text-emerald-700 hover:bg-emerald-50">
        Compare →
      </Link>
    </div>
  );

  const actionButtons = (
    <div className="flex items-center gap-3">
      <button
        onClick={resetInputs}
        className="text-xs text-stone-500 hover:text-stone-700"
        disabled={Object.keys(inputs).length === 0}
      >
        Reset
      </button>
      <button
        onClick={() => {
          const name = prompt("Scenario name (e.g. Optimistic, Conservative):");
          if (!name) return;
          startFork(async () => {
            const r = await forkScenario(instanceId, name);
            router.push(`/models/${r.id}`);
          });
        }}
        disabled={isForkPending}
        className="text-xs text-stone-500 hover:text-stone-700 disabled:opacity-50"
      >
        {isForkPending ? "Forking…" : "Fork as scenario"}
      </button>
      <SaveIndicator state={saveState} />
    </div>
  );

  const outputs = (
    <div className="space-y-8">
      {template.outputs.filter(o => o.kind === "series").map(o => (
        <SeriesChart key={o.key} output={o} values={result.values} template={template} large={mode === "dashboard"} />
      ))}
      {template.outputs.filter(o => o.kind === "seriesGroup").map(o => (
        <SeriesGroupChart key={o.key} output={o} values={result.values} template={template} large={mode === "dashboard"} />
      ))}
      {template.outputs.filter(o => o.kind === "sensitivity").map(o => (
        <SensitivityGrid key={o.key} output={o} template={template} inputs={inputs} />
      ))}
      {template.outputs.filter(o => o.kind === "budgetExport").map(o => (
        <BudgetExportCard key={o.key} output={o} instanceId={instanceId} dirtyOrUnsaved={saveState !== "idle" && saveState !== "saved"} />
      ))}
    </div>
  );

  const errorPanels = (
    <>
      {Object.keys(result.errors).length > 0 && (
        <details className="mt-6 text-xs">
          <summary className="text-rose-600 cursor-pointer">{Object.keys(result.errors).length} compute error(s)</summary>
          <pre className="mt-2 p-3 bg-rose-50 border border-rose-200 rounded text-rose-700">
            {Object.entries(result.errors).map(([k, v]) => `${k}: ${v}`).join("\n")}
          </pre>
        </details>
      )}
      {mode === "editor" && (
        <details className="mt-8 text-xs text-stone-400">
          <summary className="cursor-pointer">Debug: raw values</summary>
          <pre className="mt-2 p-3 bg-stone-900 text-stone-200 rounded overflow-auto">
            {JSON.stringify(result.values, (_, v) => Array.isArray(v) && v.length > 6 ? `[${v.slice(0,3).map(n => Math.round(n)).join(", ")}, … ${v.length} items]` : v, 2)}
          </pre>
        </details>
      )}
    </>
  );

  // ── Leadership / dashboard layout ─────────────────────────────────────────
  if (mode === "dashboard") {
    return (
      <div className="min-h-screen bg-stone-50">
        <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-8 py-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-stone-900 truncate">{instanceName}</h1>
                {scenarioName && <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 shrink-0">{scenarioName}</span>}
              </div>
              <p className="text-xs text-stone-500 mt-0.5">{template.name}</p>
            </div>
            {scenarioChips}
            {modeToggle}
          </div>
          {attachedPitstop?.settlement && (
            <div className="max-w-7xl mx-auto px-8 pb-3 text-xs text-stone-500">
              Attached: <span className="text-stone-700">{attachedPitstop.title}</span>
              {" · "}
              {attachedPitstop.settlement.name} ({attachedPitstop.settlement.totalHouseholds.toLocaleString("en-IN")} HH)
            </div>
          )}
        </div>

        <div className="max-w-7xl mx-auto px-8 py-8 space-y-10">
          <KpiRow outputs={template.outputs.filter(o => o.kind === "kpi")} values={result.values} large />
          {outputs}

          <details className="bg-white border border-stone-200 rounded-xl">
            <summary className="px-5 py-3 cursor-pointer flex items-center justify-between text-sm text-stone-700 hover:bg-stone-50">
              <span>Tweak assumptions</span>
              <span className="text-xs text-stone-400">
                {Object.keys(inputs).length > 0 ? `${Object.keys(inputs).length} overridden` : "all defaults"}
              </span>
            </summary>
            <div className="px-5 pb-5 pt-2 border-t border-stone-100">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
                {orderedGroupKeys.flatMap(gk => [
                  ...inputsByGroup[gk]
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map(n => {
                      const current = inputs[n.key];
                      const isOverridden = current !== undefined;
                      const displayVal = current !== undefined ? current : (n.default ?? "");
                      return (
                        <label key={n.key} className="block">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-stone-600 truncate" title={n.label}>{n.label}</span>
                            {n.unit && <span className="text-[10px] text-stone-400 shrink-0">{n.unit}</span>}
                          </div>
                          <input
                            type="number"
                            step="any"
                            value={String(displayVal)}
                            onChange={e => setInputVal(n.key, e.target.value)}
                            className={`mt-1 w-full px-2 py-1 rounded-md border text-sm ${
                              isOverridden ? "border-amber-300 bg-amber-50" : "border-stone-200"
                            } focus:border-sky-400 focus:ring-1 focus:ring-sky-400 outline-none`}
                          />
                        </label>
                      );
                    }),
                  ...pickersForGroup(gk).map(renderPicker),
                ])}
              </div>
              <div className="mt-4 pt-3 border-t border-stone-100">{actionButtons}</div>
              <div className="mt-4">
                <PitstopAttachment
                  instanceId={instanceId}
                  attached={attachedPitstop}
                  onPrefillHH={(hh) => {
                    if (template.nodes.find(n => n.key === "hh_count")) {
                      dirtyRef.current = true; setSaveState("dirty");
                      setInputs({ ...inputs, hh_count: hh });
                    }
                  }}
                />
              </div>
            </div>
          </details>

          {errorPanels}
        </div>
      </div>
    );
  }

  // ── Operations / sim layout (day-in-the-life; sliders; basic/advanced) ────
  if (mode === "sim") {
    return (
      <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-64px)] bg-stone-50">
        <aside className="w-full lg:w-[360px] shrink-0 border-b lg:border-b-0 lg:border-r border-stone-200 bg-white lg:overflow-y-auto">
          <div className="px-5 py-4 border-b border-stone-200 lg:sticky lg:top-0 bg-white z-10">
            <div className="flex items-center justify-between gap-2">
              <h1 className="font-semibold text-stone-900 truncate">{instanceName}</h1>
              {scenarioName && <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 shrink-0">{scenarioName}</span>}
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-stone-500">{template.name}</p>
              {modeToggle}
            </div>
            {siblings && <div className="mt-3">{scenarioChips}</div>}
            <div className="mt-3">{actionButtons}</div>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs uppercase tracking-wide text-stone-400">Live parameters</h3>
              <div className="inline-flex rounded-md bg-stone-100 p-0.5">
                <button onClick={() => setSimTier("basic")} className={`px-2.5 py-0.5 text-[11px] rounded ${simTier === "basic" ? "bg-white shadow text-stone-900" : "text-stone-500 hover:text-stone-700"}`}>Basic</button>
                <button onClick={() => setSimTier("advanced")} className={`px-2.5 py-0.5 text-[11px] rounded ${simTier === "advanced" ? "bg-white shadow text-stone-900" : "text-stone-500 hover:text-stone-700"}`}>Advanced</button>
              </div>
            </div>
            {orderedGroupKeys.length === 0 ? (
              <p className="text-xs text-stone-400">No simulation parameters on this template yet.</p>
            ) : (
              <div className="space-y-6">
                {orderedGroupKeys.map(gk => (
                  <div key={gk}>
                    <h4 className="text-xs uppercase tracking-wide text-stone-400 mb-2">{groupsByKey[gk]?.label ?? "Other"}</h4>
                    <div className="space-y-3">
                      {inputsByGroup[gk]
                        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                        .map(n => (
                          <NodeField
                            key={n.key}
                            n={n}
                            value={inputs[n.key]}
                            isOverridden={inputs[n.key] !== undefined}
                            slider={!!n.ui}
                            onChange={raw => setInputVal(n.key, raw)}
                          />
                        ))}
                      {pickersForGroup(gk).map(renderPicker)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 lg:overflow-y-auto p-4 sm:p-6">
          {daySimConfig ? (
            <OperationsSim config={daySimConfig} values={result.values} />
          ) : (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
              <div className="text-sm font-medium text-stone-700">No operations simulation</div>
              <p className="mt-2 text-sm text-stone-500 max-w-md mx-auto">
                This template has no <code className="bg-stone-100 px-1 rounded">daySim</code> output configured.
              </p>
            </div>
          )}
          {errorPanels}
        </main>
      </div>
    );
  }

  // ── Editor layout (default for non-leadership; switchable for leadership) ─
  return (
    <div className="flex h-[calc(100vh-64px)] bg-stone-50">
      <aside className="w-[360px] shrink-0 border-r border-stone-200 bg-white overflow-y-auto">
        <div className="px-5 py-4 border-b border-stone-200 sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-semibold text-stone-900 truncate">{instanceName}</h1>
            {scenarioName && <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 shrink-0">{scenarioName}</span>}
          </div>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-stone-500">{template.name}</p>
            {modeToggle}
          </div>
          {siblings && <div className="mt-3">{scenarioChips}</div>}
          <div className="mt-3">{actionButtons}</div>
          <PitstopAttachment
            instanceId={instanceId}
            attached={attachedPitstop}
            onPrefillHH={(hh) => {
              if (template.nodes.find(n => n.key === "hh_count")) {
                dirtyRef.current = true; setSaveState("dirty");
                setInputs({ ...inputs, hh_count: hh });
              }
            }}
          />
        </div>
        <div className="px-5 py-4 space-y-6">
          {orderedGroupKeys.map(gk => (
            <div key={gk}>
              <h3 className="text-xs uppercase tracking-wide text-stone-400 mb-2">
                {groupsByKey[gk]?.label ?? "Other"}
              </h3>
              <div className="space-y-3">
                {inputsByGroup[gk]
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map(n => {
                    const current = inputs[n.key];
                    const isOverridden = current !== undefined;
                    const displayVal = current !== undefined ? current : (n.default ?? "");
                    return (
                      <label key={n.key} className="block">
                        <div className="flex items-baseline justify-between">
                          <span className="text-sm text-stone-700">{n.label}</span>
                          {n.unit && <span className="text-xs text-stone-400">{n.unit}</span>}
                        </div>
                        <input
                          type="number"
                          step="any"
                          value={String(displayVal)}
                          onChange={e => setInputVal(n.key, e.target.value)}
                          className={`mt-1 w-full px-3 py-1.5 rounded-md border text-sm ${
                            isOverridden ? "border-amber-300 bg-amber-50" : "border-stone-200"
                          } focus:border-sky-400 focus:ring-1 focus:ring-sky-400 outline-none`}
                        />
                        {n.notes && <p className="text-xs text-stone-400 mt-0.5">{n.notes}</p>}
                      </label>
                    );
                  })}
                {pickersForGroup(gk).map(renderPicker)}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        <KpiRow outputs={template.outputs.filter(o => o.kind === "kpi")} values={result.values} />
        <div className="mt-8">{outputs}</div>
        {errorPanels}
      </main>
    </div>
  );
}

function PitstopAttachment({
  instanceId, attached, onPrefillHH,
}: {
  instanceId: string;
  attached: AttachedPitstop | null;
  onPrefillHH: (hh: number) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchPitstops>>>([]);

  useEffect(() => {
    if (!searching || q.trim().length < 2) { setResults([]); return; }
    const h = setTimeout(() => { searchPitstops(q).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(h);
  }, [q, searching]);

  if (attached) {
    return (
      <div className="mt-4 pt-4 border-t border-stone-100">
        <div className="text-xs text-stone-400 uppercase tracking-wide mb-1">Attached pitstop</div>
        <div className="text-sm text-stone-700 truncate">{attached.title}</div>
        {attached.goalTitle && <div className="text-xs text-stone-400 truncate">{attached.goalTitle}</div>}
        {attached.settlement && (
          <div className="mt-2 p-2 bg-sky-50 rounded text-xs">
            <div className="text-stone-700">{attached.settlement.name}</div>
            <div className="mt-1 text-stone-500">
              {attached.settlement.totalHouseholds.toLocaleString("en-IN")} HH ·{" "}
              {(attached.settlement.children6m3yr + attached.settlement.children4to14).toLocaleString("en-IN")} children ·{" "}
              {attached.settlement.elderly60plus.toLocaleString("en-IN")} elderly
            </div>
            {attached.settlement.totalHouseholds > 0 && (
              <button
                onClick={() => onPrefillHH(attached.settlement!.totalHouseholds)}
                className="mt-2 text-xs text-sky-700 hover:underline"
              >
                Prefill hh_count = {attached.settlement.totalHouseholds.toLocaleString("en-IN")}
              </button>
            )}
          </div>
        )}
        <button
          onClick={() => start(async () => { await setInstancePitstop(instanceId, null); router.refresh(); })}
          disabled={pending}
          className="mt-2 text-xs text-stone-500 hover:text-stone-700 disabled:opacity-50"
        >
          Detach
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-stone-100">
      <button
        onClick={() => setSearching(s => !s)}
        className="text-xs text-stone-500 hover:text-stone-700"
      >
        {searching ? "Cancel" : "+ Attach to a Pitstop"}
      </button>
      {searching && (
        <div className="mt-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search pitstops…"
            autoFocus
            className="w-full px-2 py-1 text-sm border border-stone-200 rounded outline-none focus:border-sky-400"
          />
          {results.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto border border-stone-200 rounded text-xs">
              {results.map(r => (
                <li key={r.id}>
                  <button
                    onClick={() => start(async () => { await setInstancePitstop(instanceId, r.id); router.refresh(); })}
                    disabled={pending}
                    className="block w-full text-left px-2 py-1.5 hover:bg-sky-50 disabled:opacity-50"
                  >
                    <div className="text-stone-700 truncate">{r.title}</div>
                    <div className="text-stone-400 truncate">
                      {r.goalTitle ?? ""}{r.settlementName ? ` · ${r.settlementName}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NodeField({ n, value, isOverridden, slider, onChange }: {
  n: ModelNode;
  value: NodeValue | undefined;
  isOverridden: boolean;
  slider: boolean;
  onChange: (raw: string) => void;
}) {
  const displayVal = value !== undefined ? value : (n.default ?? "");
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-stone-700 truncate" title={n.label}>{n.label}</span>
        {n.unit && <span className="text-xs text-stone-400 shrink-0">{n.unit}</span>}
      </div>
      {slider && n.ui ? (
        <div className="mt-1 flex items-center gap-2">
          <input
            type="range"
            min={n.ui.min}
            max={n.ui.max}
            step={n.ui.step ?? "any"}
            value={Number(displayVal)}
            onChange={e => onChange(e.target.value)}
            className="flex-1 accent-sky-500"
          />
          <input
            type="number"
            step={n.ui.step ?? "any"}
            value={String(displayVal)}
            onChange={e => onChange(e.target.value)}
            className={`w-20 px-2 py-1 rounded-md border text-sm text-right tabular-nums ${
              isOverridden ? "border-amber-300 bg-amber-50" : "border-stone-200"
            } focus:border-sky-400 focus:ring-1 focus:ring-sky-400 outline-none`}
          />
        </div>
      ) : (
        <input
          type="number"
          step="any"
          value={String(displayVal)}
          onChange={e => onChange(e.target.value)}
          className={`mt-1 w-full px-3 py-1.5 rounded-md border text-sm ${
            isOverridden ? "border-amber-300 bg-amber-50" : "border-stone-200"
          } focus:border-sky-400 focus:ring-1 focus:ring-sky-400 outline-none`}
        />
      )}
      {n.notes && <p className="text-xs text-stone-400 mt-0.5">{n.notes}</p>}
    </label>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const cfg = {
    dirty: { text: "Unsaved", color: "text-amber-600" },
    saving: { text: "Saving…", color: "text-stone-500" },
    saved: { text: "Saved", color: "text-emerald-600" },
    error: { text: "Save failed", color: "text-rose-600" },
  }[state];
  return <span className={`text-xs ${cfg.color}`}>{cfg.text}</span>;
}

function KpiRow({ outputs, values, large }: { outputs: ModelOutput[]; values: Record<string, NodeValue>; large?: boolean }) {
  if (outputs.length === 0) return null;
  return (
    <div className={large ? "grid grid-cols-2 lg:grid-cols-4 gap-4" : "grid grid-cols-2 md:grid-cols-4 gap-3"}>
      {outputs.map(o => {
        const cfg = o.config as { nodeKey?: string; index?: number; format?: string };
        const v = cfg.nodeKey ? values[cfg.nodeKey] : undefined;
        const scalar = Array.isArray(v) ? v[cfg.index ?? 0] : v;
        return (
          <div key={o.key} className={`bg-white border border-stone-200 rounded-xl ${large ? "p-6" : "p-4"}`}>
            <div className={large ? "text-sm text-stone-500" : "text-xs text-stone-500"}>{o.label}</div>
            <div className={`mt-1 font-semibold text-stone-900 tabular-nums ${large ? "text-4xl" : "text-2xl"}`}>
              {formatScalar(scalar as NodeValue | undefined, cfg.format)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type SensitivityConfig = {
  xNode?: string; xValues?: number[];
  yNode?: string; yValues?: number[];
  resultNode?: string; resultIndex?: number; format?: string;
};

function BudgetExportCard({ output, instanceId, dirtyOrUnsaved }: { output: ModelOutput; instanceId: string; dirtyOrUnsaved: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cfg = output.config as { domainName?: string; capexLines?: unknown[]; opexLines?: unknown[] };
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-medium text-stone-900">{output.label}</h3>
        <span className="text-xs text-stone-400">
          {cfg.capexLines?.length ?? 0} capex · {cfg.opexLines?.length ?? 0} opex
        </span>
      </div>
      <p className="text-xs text-stone-500 mb-3">
        Snapshots the current inputs into a new draft Budget under domain <code className="bg-stone-100 px-1 rounded">{cfg.domainName ?? "Operating_Model"}</code>.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setError(null);
            const name = prompt("Budget name:");
            if (!name) return;
            start(async () => {
              try {
                const r = await promoteToBudget(instanceId, output.key, name);
                router.push(`/budget/${r.budgetId}`);
              } catch (e) { setError((e as Error).message); }
            });
          }}
          disabled={pending}
          className="text-sm bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Creating budget…" : "Promote to Budget →"}
        </button>
        {dirtyOrUnsaved && <span className="text-xs text-amber-600">Unsaved changes; save first to capture them</span>}
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </div>
  );
}

function SensitivityGrid({ output, template, inputs }: { output: ModelOutput; template: ModelTemplate; inputs: InstanceInputs }) {
  const cfg = output.config as SensitivityConfig;
  const result = useMemo(() => {
    if (!cfg.xNode || !cfg.yNode || !cfg.resultNode || !cfg.xValues?.length || !cfg.yValues?.length) return null;
    return computeSensitivity(template, inputs, {
      xNode: cfg.xNode, xValues: cfg.xValues,
      yNode: cfg.yNode, yValues: cfg.yValues,
      resultNode: cfg.resultNode, resultIndex: cfg.resultIndex,
    });
  }, [template, inputs, cfg]);
  if (!result) return null;

  const xLabel = template.nodes.find(n => n.key === cfg.xNode)?.label ?? cfg.xNode;
  const yLabel = template.nodes.find(n => n.key === cfg.yNode)?.label ?? cfg.yNode;
  const fmtAxis = (n: number) => n < 1 && n > 0 ? `${(n * 100).toFixed(0)}%` : String(n);
  const cellColor = (v: number | null) => {
    if (v === null || result.max === result.min) return "bg-stone-50";
    const t = (v - result.min) / (result.max - result.min);
    if (v < 0) return "bg-rose-100";
    if (t > 0.66) return "bg-emerald-200";
    if (t > 0.33) return "bg-emerald-100";
    return "bg-amber-50";
  };
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-medium text-stone-900">{output.label}</h3>
        <span className="text-xs text-stone-400">{yLabel} (rows) × {xLabel} (cols)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-xs text-stone-400 font-normal">{yLabel} ↓ / {xLabel} →</th>
              {cfg.xValues!.map(x => (
                <th key={x} className="px-3 py-1 text-xs text-stone-500 font-medium border-b border-stone-100">{fmtAxis(x)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cfg.yValues!.map((y, yi) => (
              <tr key={y}>
                <td className="px-2 py-1 text-xs text-stone-500 font-medium border-r border-stone-100">{fmtAxis(y)}</td>
                {result.grid[yi].map((v, xi) => (
                  <td key={xi} className={`px-3 py-1 text-right tabular-nums ${cellColor(v)}`}>
                    {v === null ? "—" : formatScalar(v, cfg.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Chart helpers (shared by SeriesChart + SeriesGroupChart) ─────────────────

/** Build readable x-axis ticks. Monthly horizon: dense in Y1+Y2 (M1/M3/M6/M9/
 *  M12/M18/M24), then yearly (Y3/Y4/Y5). Annual horizon: every period (Y1..YN).
 *  Anything else: ~7 evenly spaced labels. */
function buildAxisTicks(horizon: string | undefined, length: number): { idx: number; label: string }[] {
  if (horizon === "monthly" && length >= 24) {
    const monthlyIdx = [0, 2, 5, 8, 11, 17, 23]; // M1, M3, M6, M9, M12, M18, M24
    const out: { idx: number; label: string }[] = monthlyIdx
      .filter(i => i < length)
      .map(i => ({ idx: i, label: `M${i + 1}` }));
    for (let y = 3; y * 12 <= length; y++) {
      out.push({ idx: y * 12 - 1, label: `Y${y}` });
    }
    return out;
  }
  if (horizon === "annual") {
    return Array.from({ length }, (_, i) => ({ idx: i, label: `Y${i + 1}` }));
  }
  const step = Math.max(1, Math.ceil(length / 7));
  const out: { idx: number; label: string }[] = [];
  for (let i = 0; i < length; i += step) out.push({ idx: i, label: String(i + 1) });
  if (out[out.length - 1].idx !== length - 1) out.push({ idx: length - 1, label: String(length) });
  return out;
}

/** Format the per-period label used in tooltips ("M7", "Y3"). */
function periodLabel(horizon: string | undefined, idx: number): string {
  if (horizon === "annual") return `Y${idx + 1}`;
  return `M${idx + 1}`;
}

function AxisLabels({ ticks, length }: { ticks: { idx: number; label: string }[]; length: number }) {
  return (
    <div className="relative mt-2 h-4 text-xs text-stone-400 select-none">
      {ticks.map(t => (
        <span
          key={t.idx}
          className="absolute -translate-x-1/2 tabular-nums"
          style={{ left: `${((t.idx + 0.5) / length) * 100}%` }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

function SeriesChart({ output, values, template, large }: { output: ModelOutput; values: Record<string, NodeValue>; template: ModelTemplate; large?: boolean }) {
  const cfg = output.config as { nodeKey?: string; horizon?: string; format?: string };
  const v = cfg.nodeKey ? values[cfg.nodeKey] : undefined;
  const [hover, setHover] = useState<{ period: number; value: number } | null>(null);
  if (!Array.isArray(v) || v.length === 0) {
    return <div className="text-xs text-stone-400">{output.label}: no data</div>;
  }
  const horizon = template.horizons.find(h => h.key === cfg.horizon);
  const max = Math.max(...v.map(Math.abs));
  const ticks = buildAxisTicks(cfg.horizon, v.length);
  return (
    <div className={`bg-white border border-stone-200 rounded-xl ${large ? "p-6" : "p-4"}`}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className={`font-medium text-stone-900 ${large ? "text-lg" : ""}`}>{output.label}</h3>
        <span className="text-xs text-stone-400">{horizon?.key ?? ""}</span>
      </div>
      <div className="relative">
        {hover && (
          <div
            className={`absolute -top-2 -translate-y-full -translate-x-1/2 z-10 rounded-md bg-stone-900 text-white shadow-lg pointer-events-none ${large ? "text-xs px-3 py-2" : "text-[11px] px-2 py-1.5"}`}
            style={{ left: `${((hover.period + 0.5) / v.length) * 100}%` }}
          >
            <div className="font-semibold opacity-80 mb-0.5">{periodLabel(cfg.horizon, hover.period)}</div>
            <div className="tabular-nums">{formatScalar(hover.value, cfg.format)}</div>
          </div>
        )}
        <div className={`flex items-end gap-px ${large ? "h-48" : "h-32"}`} onMouseLeave={() => setHover(null)}>
          {v.map((n, i) => {
            const pct = max === 0 ? 0 : (Math.abs(n) / max) * 100;
            const positive = n >= 0;
            const isHovered = hover?.period === i;
            return (
              <div
                key={i}
                onMouseEnter={() => setHover({ period: i, value: n })}
                className={`flex-1 cursor-default ${positive ? "bg-sky-400" : "bg-rose-400"} ${isHovered ? "opacity-100 ring-1 ring-stone-700" : "opacity-90 hover:opacity-100"} rounded-t`}
                style={{ height: `${pct}%` }}
              />
            );
          })}
        </div>
      </div>
      <AxisLabels ticks={ticks} length={v.length} />
    </div>
  );
}

function SeriesGroupChart({ output, values, template, large }: { output: ModelOutput; values: Record<string, NodeValue>; template: ModelTemplate; large?: boolean }) {
  const cfg = output.config as { horizon?: string; format?: string; series?: { nodeKey: string; label: string; color: string }[] };
  const seriesDefs = cfg.series ?? [];
  const [hover, setHover] = useState<{ period: number } | null>(null);
  if (seriesDefs.length === 0) {
    return <div className="text-xs text-stone-400">{output.label}: no series configured</div>;
  }
  // Resolve each declared series to its vector; drop missing ones with a warning.
  const resolved = seriesDefs
    .map(s => ({ ...s, vec: values[s.nodeKey] }))
    .filter((s): s is typeof s & { vec: number[] } => Array.isArray(s.vec) && s.vec.length > 0);
  if (resolved.length === 0) {
    return <div className="text-xs text-stone-400">{output.label}: no data</div>;
  }
  const length = Math.max(...resolved.map(s => s.vec.length));
  const max = Math.max(...resolved.flatMap(s => s.vec.map(Math.abs)));
  const horizon = template.horizons.find(h => h.key === cfg.horizon);
  const ticks = buildAxisTicks(cfg.horizon, length);
  // Heuristic: when there are many periods (e.g. 60 months), thin the bar gap
  // to almost nothing so 3-bar groups don't overflow their column.
  const dense = length > 24;
  return (
    <div className={`bg-white border border-stone-200 rounded-xl ${large ? "p-6" : "p-4"}`}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className={`font-medium text-stone-900 ${large ? "text-lg" : ""}`}>{output.label}</h3>
        <span className="text-xs text-stone-400">{horizon?.key ?? ""}</span>
      </div>
      <div className="relative">
        {hover && (
          <div
            className={`absolute -top-2 -translate-y-full -translate-x-1/2 z-10 rounded-md bg-stone-900 text-white shadow-lg pointer-events-none whitespace-nowrap ${large ? "text-xs px-3 py-2" : "text-[11px] px-2 py-1.5"}`}
            style={{ left: `${((hover.period + 0.5) / length) * 100}%` }}
          >
            <div className="font-semibold opacity-80 mb-0.5">{periodLabel(cfg.horizon, hover.period)}</div>
            <div className="space-y-0.5">
              {resolved.map(s => (
                <div key={s.nodeKey} className="flex items-center gap-2 tabular-nums">
                  <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
                  <span className="opacity-80 mr-3">{s.label}</span>
                  <span className="ml-auto">{formatScalar(s.vec[hover.period] ?? 0, cfg.format)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className={`flex items-end gap-px ${large ? "h-48" : "h-32"}`} onMouseLeave={() => setHover(null)}>
          {Array.from({ length }).map((_, i) => (
            <div
              key={i}
              onMouseEnter={() => setHover({ period: i })}
              className={`flex-1 flex items-end h-full ${dense ? "gap-0" : "gap-0.5"} cursor-default`}
            >
              {resolved.map(s => {
                const n = s.vec[i] ?? 0;
                const pct = max === 0 ? 0 : (Math.abs(n) / max) * 100;
                const isHovered = hover?.period === i;
                return (
                  <div
                    key={s.nodeKey}
                    className={`flex-1 rounded-t ${isHovered ? "opacity-100 ring-1 ring-stone-700" : "opacity-90"} ${n < 0 ? "outline outline-1 outline-rose-400 outline-offset-[-1px]" : ""}`}
                    style={{ height: `${pct}%`, background: s.color }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <AxisLabels ticks={ticks} length={length} />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        {resolved.map(s => (
          <div key={s.nodeKey} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: s.color }} />
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
