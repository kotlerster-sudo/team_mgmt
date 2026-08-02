"use client";

import { useState, useMemo, useTransition, Fragment } from "react";
import {
  seedCostRegistry, updateCostRegistry, resetCostRegistry, deleteCostItem, addCostItem, saveCostComponents,
  seedProgrammeInputs, backfillDisplayGroups,
  toggleLineTemplate, addLineTemplate, updateLineTemplate, deleteLineTemplate,
  reorderLineTemplates, seedLineTemplates,
  addDomain, updateDomain, toggleDomain, reorderDomains, seedDomains,
  getGeoChildren, loadNeedsScenario, loadBudgetForCompare, getCostHistory,
  type LineTemplateFields, type DomainConfigFields,
} from "./actions";
import type { BudgetSection, InflationType, LineTemplate, BudgetDomainConfig } from "@/app/generated/prisma/client";
import { generateBudgetLines, buildAugmentedRegistry, type BudgetGeneratorInputs } from "@/lib/budget-generator";

// inputVar values that produce units unconditionally (not driven by programme inputs)
const FIXED_INPUT_VARS = new Set(["fixed_1", "fixed_12"]);

type CostRow = {
  id: string | null;
  domain: string | null;
  itemKey: string;
  unit: string;
  notes: string | null;
  defaultCost: number;
  currentCost: number;
  isEdited: boolean;
  displayGroup: string | null;
  needsDomain: string | null;
  derivation: string | null;
};

type ComponentItem = { label: string; spec: string | null; qty: number; unitCost: number };
type HistoryRow = { id: string; oldCost: number | null; newCost: number | null; source: string | null; reason: string | null; changedBy: string | null; changedAt: string };

const CITIES = ["Bangalore", "Chennai", "Others"] as const;
const SECTIONS: BudgetSection[] = ["salary", "capex", "travel", "programme", "admin_salary", "admin_other", "additional"];
const INFLATION_TYPES: InflationType[] = ["Salary", "Other", "Nil"];
const INPUT_VARS = [
  { value: "fixed_1",         label: "Fixed (1)" },
  { value: "fixed_12",        label: "Fixed (12 months)" },
  { value: "nCLCs",           label: "N CLCs" },
  { value: "nYRCs",           label: "N YRCs" },
  { value: "nSettlements",    label: "N Settlements" },
  { value: "nClusters",       label: "N Clusters" },
  { value: "nElderly",        label: "N Elderly" },
  { value: "nElderlyCentres", label: "N Elderly Centres" },
  { value: "nCreches",        label: "N Creches" },
  { value: "cosTotal",        label: "COs total (clusters × COs/cluster)" },
  { value: "gate:nCLCs",        label: "Gated by N CLCs (1 if CLCs > 0, else 0)" },
  { value: "gate:nYRCs",        label: "Gated by N YRCs (1 if YRCs > 0, else 0)" },
  { value: "gate:nElderlyCentres", label: "Gated by N Elderly Centres" },
  { value: "gate:nCreches",     label: "Gated by N Creches" },
];

const PROGRAMME_INPUTS: { key: string; label: string; unit: string }[] = [
  { key: "inp.nSettlements",    label: "N Settlements",       unit: "settlements" },
  { key: "inp.nClusters",       label: "N Clusters",          unit: "clusters" },
  { key: "inp.cosPerCluster",   label: "COs per cluster",     unit: "COs" },
  { key: "inp.cosTotal",        label: "Total COs",           unit: "COs" },
  { key: "inp.nCLCs",           label: "N CLCs",              unit: "CLCs" },
  { key: "inp.nYRCs",           label: "N YRCs",              unit: "YRCs" },
  { key: "inp.nElderlyCentres", label: "N Elderly Centres",   unit: "centres" },
  { key: "inp.nElderly",        label: "N Elderly enrolled",  unit: "persons" },
  { key: "inp.nCreches",        label: "N Creches",           unit: "creches" },
];

function formatKey(key: string) {
  return key.split(".").slice(1).join(".").replace(/_/g, " ");
}

function formulaSummary(t: LineTemplate): string {
  const unitPart = t.supervisorRatioKey
    ? `ceil(${t.inputVar} / ${t.supervisorRatioKey})×12`
    : t.inputMonthly ? `${t.inputVar}×12` : t.inputVar;

  let costPart = "0";
  if (t.isSalaryStub)   costPart = "salary (blank)";
  else if (t.userInputCost) costPart = `input:${t.userInputCost}`;
  else if (t.costPctOf) costPart = `${t.costPct}% of ${t.costPctOf}`;
  else if (t.workerRatioKey) costPart = `${t.workerRatioKey}×${t.costKey}×12${t.bufferKey ? `×(1+${t.bufferKey}/100)` : ""}`;
  else if (t.costKey) {
    costPart = t.costKey;
    if (t.costKey2) costPart += `×${t.costKey2}`;
    if (t.costKey3) costPart += `×${t.costKey3}`;
    if (t.costMonthly) costPart += "×12";
  }

  return `units=${unitPart}  ·  cost=${costPart}`;
}

function makeDefaultInputs(costs: { itemKey: string; currentCost: number }[]): BudgetGeneratorInputs {
  return Object.fromEntries(
    costs.filter(c => c.itemKey.startsWith("inp.")).map(c => [c.itemKey.slice(4), c.currentCost])
  );
}

// ─── Cost Registry tab ────────────────────────────────────────────────────────

function CostRegistryTab({ costs, isSeeded, city, domainOrder, domainLabels, needsDomains, componentsByKey }: {
  costs: CostRow[]; isSeeded: boolean; city: string;
  domainOrder: (string | null)[]; domainLabels: Record<string, string>;
  needsDomains: { domain: string; label: string | null }[];
  componentsByKey: Record<string, ComponentItem[]>;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>("");
  // Provenance drill-down: which item is expanded + its lazily-loaded history.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [historyByKey, setHistoryByKey] = useState<Record<string, HistoryRow[]>>({});
  const [historyLoading, setHistoryLoading] = useState(false);

  function toggleExpand(itemKey: string) {
    if (expandedKey === itemKey) { setExpandedKey(null); return; }
    setExpandedKey(itemKey);
    if (!historyByKey[itemKey]) {
      setHistoryLoading(true);
      getCostHistory(city, itemKey)
        .then(rows => setHistoryByKey(prev => ({ ...prev, [itemKey]: rows })))
        .finally(() => setHistoryLoading(false));
    }
  }

  // ── Working editor (author component breakup + derivation) ──────────────────
  type WRow = { label: string; spec: string; qty: string; unitCost: string };
  const [wEditKey, setWEditKey] = useState<string | null>(null);
  const [wRows, setWRows] = useState<WRow[]>([]);
  const [wDeriv, setWDeriv] = useState("");

  function startWorkingEdit(row: CostRow) {
    setWEditKey(row.itemKey);
    setWRows((componentsByKey[row.itemKey] ?? []).map(c => ({ label: c.label, spec: c.spec ?? "", qty: String(c.qty), unitCost: String(c.unitCost) })));
    setWDeriv(row.derivation ?? "");
  }
  const addWRow = () => setWRows(p => [...p, { label: "", spec: "", qty: "1", unitCost: "" }]);
  const updateWRow = (i: number, k: keyof WRow, v: string) => setWRows(p => p.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const removeWRow = (i: number) => setWRows(p => p.filter((_, idx) => idx !== i));
  const wRollup = Math.round(wRows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.unitCost) || 0), 0));

  function saveWorking(row: CostRow) {
    startTransition(async () => {
      await saveCostComponents(
        city, row.itemKey,
        wRows.map(r => ({ label: r.label, spec: r.spec || null, qty: parseFloat(r.qty) || 0, unitCost: parseFloat(r.unitCost) || 0 })),
        wDeriv.trim() || null,
        { unit: row.unit, domain: row.domain, currentCost: row.currentCost },
      );
      setWEditKey(null);
    });
  }
  const [activeDomain, setActiveDomain] = useState<string>(() => domainOrder.find(d => d !== null) ?? "");
  const [addingItem, setAddingItem] = useState(false);
  const [newItemType, setNewItemType] = useState<"cost" | "ratio">("cost");
  const [newKey, setNewKey] = useState("");
  const [newUnit, setNewUnit] = useState("₹");
  const [newCost, setNewCost] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [addingProgInput, setAddingProgInput] = useState(false);
  const [newProgKey, setNewProgKey] = useState("");
  const [newProgUnit, setNewProgUnit] = useState("count");
  const [newProgValue, setNewProgValue] = useState("");
  const [newProgNotes, setNewProgNotes] = useState("");
  const [newProgGroup, setNewProgGroup] = useState<string>("coverage");

  // Split programme inputs (inp.*) from regular cost items
  const progInputRows = costs.filter(c => c.itemKey.startsWith("inp."));
  const domainCosts   = costs.filter(c => !c.itemKey.startsWith("inp."));

  const grouped = domainOrder.map(d => ({
    domain: d,
    label: d ? (domainLabels[d] ?? d) : "Cross-cutting",
    costs: domainCosts.filter(c => c.domain === d),
  }));

  const currentGroup = grouped.find(g => (g.domain ?? "cross") === activeDomain) ?? grouped[0];

  const handleSeed = () => startTransition(() => seedCostRegistry(city));
  const handleSeedProgInputs = () => startTransition(() => seedProgrammeInputs(city));
  const handleBackfillGroups = () => startTransition(() => backfillDisplayGroups(city));

  const [editDisplayGroup, setEditDisplayGroup] = useState<string | null>(null);
  const [editNeedsDomain, setEditNeedsDomain]   = useState<string | null>(null);

  const startEdit = (row: CostRow) => {
    setEditing(row.itemKey);
    setEditVal(String(row.currentCost));
    setEditNotes(row.notes ?? "");
    setEditDisplayGroup(row.displayGroup);
    setEditNeedsDomain(row.needsDomain);
  };

  const saveEdit = (row: CostRow) => {
    const newVal = parseFloat(editVal);
    if (isNaN(newVal)) return;
    startTransition(async () => {
      if (row.id) {
        const isInp = row.itemKey.startsWith("inp.");
        await updateCostRegistry(
          row.id, newVal, editNotes || undefined,
          isInp ? editDisplayGroup : undefined,
          isInp ? editNeedsDomain  : undefined,
        );
      } else {
        await seedCostRegistry(city);
      }
      setEditing(null);
    });
  };

  const handleReset = (row: CostRow) => {
    if (!row.id) return;
    startTransition(() => resetCostRegistry(row.id!));
  };

  const handleDeleteItem = (row: CostRow) => {
    if (!row.id) return;
    if (!confirm(`Delete "${row.itemKey}"? This cannot be undone.`)) return;
    startTransition(() => deleteCostItem(row.id!));
  };

  const handleAddItem = () => {
    const key = newKey.trim();
    if (!key || !newCost) return;
    const domain = activeDomain === "cross" ? null : activeDomain;
    startTransition(async () => {
      await addCostItem(city, { domain, itemKey: key, unit: newUnit, unitCost: parseFloat(newCost), notes: newNotes || undefined });
      setAddingItem(false); setNewKey(""); setNewCost(""); setNewNotes(""); setNewUnit("₹"); setNewItemType("cost");
    });
  };

  const handleAddProgInput = () => {
    const suffix = newProgKey.trim();
    if (!suffix || !newProgValue) return;
    startTransition(async () => {
      await addCostItem(city, { domain: null, itemKey: `inp.${suffix}`, unit: newProgUnit, unitCost: parseFloat(newProgValue), notes: newProgNotes || undefined, displayGroup: newProgGroup });
      setAddingProgInput(false); setNewProgKey(""); setNewProgValue(""); setNewProgNotes(""); setNewProgUnit("count"); setNewProgGroup("coverage");
    });
  };

  // Shared row renderer used for both cost registry and programme inputs
  const renderRow = (row: CostRow) => editing === row.itemKey ? (
    <tr key={row.itemKey} className="border-b border-sky-100 bg-sky-50">
      <td className="px-4 py-2" colSpan={2}>
        <div className="text-sm font-medium text-stone-800">{formatKey(row.itemKey)}</div>
        <div className="text-xs font-mono text-stone-400 mt-0.5">{row.itemKey}</div>
        <input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes / label"
          className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500" />
        {row.itemKey.startsWith("inp.") && (
          <>
            <select value={editDisplayGroup ?? "coverage"} onChange={e => setEditDisplayGroup(e.target.value)}
              className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500">
              <option value="geography">Geography & Scale</option>
              <option value="facilities">Facilities</option>
              <option value="coverage">Coverage & Beneficiaries</option>
            </select>
            <select value={editNeedsDomain ?? ""} onChange={e => setEditNeedsDomain(e.target.value || null)}
              className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500">
              <option value="">— no needs domain —</option>
              {needsDomains.map(nd => (
                <option key={nd.domain} value={nd.domain}>{nd.label ?? nd.domain} ({nd.domain})</option>
              ))}
            </select>
          </>
        )}
      </td>
      <td className="px-3 py-2 text-right text-stone-400 text-xs">{row.defaultCost.toLocaleString("en-IN")}</td>
      <td className="px-3 py-2">
        <input autoFocus type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") saveEdit(row); if (e.key === "Escape") setEditing(null); }}
          className="w-full border border-sky-400 rounded px-2 py-1 text-right text-sm focus:outline-none" />
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <button onClick={() => saveEdit(row)} disabled={pending} className="text-xs bg-sky-600 text-white px-2 py-1 rounded hover:bg-sky-700">Save</button>
          <button onClick={() => setEditing(null)} className="text-xs text-stone-400 hover:text-stone-700">×</button>
        </div>
      </td>
    </tr>
  ) : (() => {
    const comps = componentsByKey[row.itemKey] ?? [];
    const isExpanded = expandedKey === row.itemKey;
    const compSum = Math.round(comps.reduce((s, c) => s + c.qty * c.unitCost, 0));
    const reconciles = comps.length === 0 || compSum === Math.round(row.currentCost);
    const hist = historyByKey[row.itemKey];
    return (
      <Fragment key={row.itemKey}>
        <tr className="border-b border-stone-50 hover:bg-stone-50 group">
          <td className="px-4 py-2.5">
            <div className="flex items-start gap-2">
              <button onClick={() => toggleExpand(row.itemKey)} className="mt-0.5 text-stone-300 hover:text-stone-600 text-xs w-3 shrink-0" title="Working & change history">{isExpanded ? "▾" : "▸"}</button>
              <div className="min-w-0">
                <div className="text-stone-800">
                  {formatKey(row.itemKey)}
                  {comps.length > 0 && (
                    <button onClick={() => toggleExpand(row.itemKey)} className={`ml-2 text-xs sm:text-[10px] px-1.5 py-0.5 rounded border ${reconciles ? "bg-sky-50 text-sky-600 border-sky-100" : "bg-red-50 text-red-600 border-red-200"}`}>
                      working · {comps.length}{reconciles ? "" : " ⚠"}
                    </button>
                  )}
                </div>
                <div className="text-xs font-mono text-stone-400 mt-0.5">{row.itemKey}</div>
                {row.notes && <div className="text-xs text-stone-400 mt-0.5">{row.notes}</div>}
                {row.itemKey.startsWith("inp.") && (
                  row.needsDomain
                    ? <span className="text-xs sm:text-[10px] font-mono bg-sky-50 text-sky-600 border border-sky-100 px-1.5 py-0.5 rounded mt-0.5 inline-block">→ {row.needsDomain}</span>
                    : <span className="text-xs sm:text-[10px] text-stone-300 mt-0.5 inline-block">no needs domain</span>
                )}
              </div>
            </div>
          </td>
          <td className="px-3 py-2.5 text-stone-500 text-xs">{row.unit}</td>
          <td className="text-right px-3 py-2.5 text-stone-400 text-xs">{row.defaultCost.toLocaleString("en-IN")}</td>
          <td className="text-right px-3 py-2.5">
            <span className={`font-medium ${row.isEdited ? "text-amber-700" : "text-stone-800"}`}>{row.currentCost.toLocaleString("en-IN")}</span>
            {row.isEdited && <span className="ml-1 text-xs text-amber-500">edited</span>}
          </td>
          <td className="px-3 py-2.5">
            <div className="flex gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              <button onClick={() => startEdit(row)} className="text-xs text-sky-600 hover:text-sky-800">Edit</button>
              {row.isEdited && row.id && <button onClick={() => handleReset(row)} className="text-xs text-stone-400 hover:text-stone-600">Reset</button>}
              {row.id && <button onClick={() => handleDeleteItem(row)} className="text-xs text-stone-300 hover:text-red-500">Delete</button>}
            </div>
          </td>
        </tr>
        {isExpanded && (
          <tr className="border-b border-stone-100 bg-stone-50/60">
            <td colSpan={5} className="px-4 py-3">
              {/* Working — component breakup (read) or editor. Cost items only. */}
              {!row.itemKey.startsWith("inp.") && (
                wEditKey === row.itemKey ? (
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-stone-500 mb-1.5">Edit working — components sum to the unit cost</div>
                    <div className="overflow-x-auto max-w-2xl">
                    <table className="w-full min-w-[480px] text-xs">
                      <thead>
                        <tr className="text-stone-400">
                          <th className="text-left py-1 font-medium">Item</th>
                          <th className="text-left font-medium">Spec</th>
                          <th className="text-right font-medium w-16">Qty</th>
                          <th className="text-right font-medium w-24">Unit ₹</th>
                          <th className="text-right font-medium w-24">Amount ₹</th>
                          <th className="w-6" />
                        </tr>
                      </thead>
                      <tbody>
                        {wRows.map((r, i) => (
                          <tr key={i} className="border-t border-stone-100">
                            <td className="py-1"><input value={r.label} onChange={e => updateWRow(i, "label", e.target.value)} placeholder="Item" className="w-full border border-stone-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500" /></td>
                            <td><input value={r.spec} onChange={e => updateWRow(i, "spec", e.target.value)} placeholder="spec" className="w-full border border-stone-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500" /></td>
                            <td><input type="number" value={r.qty} onChange={e => updateWRow(i, "qty", e.target.value)} className="w-full border border-stone-200 rounded px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-sky-500" /></td>
                            <td><input type="number" value={r.unitCost} onChange={e => updateWRow(i, "unitCost", e.target.value)} className="w-full border border-stone-200 rounded px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-sky-500" /></td>
                            <td className="text-right text-stone-600">{Math.round((parseFloat(r.qty) || 0) * (parseFloat(r.unitCost) || 0)).toLocaleString("en-IN")}</td>
                            <td className="text-center"><button onClick={() => removeWRow(i)} className="text-stone-300 hover:text-red-500">×</button></td>
                          </tr>
                        ))}
                        <tr className="border-t border-stone-200 font-medium text-stone-700">
                          <td className="py-1.5" colSpan={4}>
                            <button onClick={addWRow} className="text-xs text-sky-600 hover:text-sky-800">+ Add item</button>
                            {wRows.length > 0 && <span className="ml-3 font-normal text-stone-500">→ unit cost becomes ₹{wRollup.toLocaleString("en-IN")}</span>}
                          </td>
                          <td className="text-right">{wRollup.toLocaleString("en-IN")}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                    </div>
                    <div className="mt-2 max-w-2xl">
                      <label className="text-xs text-stone-500">Derivation note (for rates that aren’t itemised)</label>
                      <textarea value={wDeriv} onChange={e => setWDeriv(e.target.value)} rows={2} placeholder="e.g. average of 3 vendor quotes · ₹500/hr × 2 staff × 8 hrs"
                        className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => saveWorking(row)} disabled={pending} className="text-xs bg-sky-600 text-white px-3 py-1.5 rounded hover:bg-sky-700 disabled:opacity-50">{pending ? "Saving…" : "Save working"}</button>
                      <button onClick={() => setWEditKey(null)} className="text-xs text-stone-400 hover:text-stone-700">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mb-4">
                    {comps.length > 0 ? (
                      <>
                        <div className="text-xs font-semibold text-stone-500 mb-1.5">Working — how ₹{row.currentCost.toLocaleString("en-IN")} is derived</div>
                        <div className="overflow-x-auto max-w-2xl">
                        <table className="w-full min-w-[480px] text-xs">
                          <thead>
                            <tr className="text-stone-400">
                              <th className="text-left py-1 font-medium">Item</th>
                              <th className="text-left font-medium">Spec</th>
                              <th className="text-right font-medium">Qty</th>
                              <th className="text-right font-medium">Unit ₹</th>
                              <th className="text-right font-medium">Amount ₹</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comps.map((c, i) => (
                              <tr key={i} className="border-t border-stone-100">
                                <td className="py-1 text-stone-700">{c.label}</td>
                                <td className="text-stone-400">{c.spec ?? ""}</td>
                                <td className="text-right text-stone-600">{c.qty}</td>
                                <td className="text-right text-stone-600">{c.unitCost.toLocaleString("en-IN")}</td>
                                <td className="text-right text-stone-800">{Math.round(c.qty * c.unitCost).toLocaleString("en-IN")}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-stone-200 font-medium text-stone-700">
                              <td className="py-1" colSpan={4}>
                                Sub-total{!reconciles && <span className="ml-2 text-red-500 font-normal">⚠ ≠ current unit cost ₹{row.currentCost.toLocaleString("en-IN")}</span>}
                              </td>
                              <td className="text-right">{compSum.toLocaleString("en-IN")}</td>
                            </tr>
                          </tbody>
                        </table>
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-stone-400">No breakup recorded for this item yet.</div>
                    )}
                    {row.derivation && <p className="text-xs text-stone-500 mt-2 max-w-2xl"><span className="text-stone-400">Derivation:</span> {row.derivation}</p>}
                    <button onClick={() => startWorkingEdit(row)} className="text-xs text-sky-600 hover:text-sky-800 mt-2">{comps.length > 0 || row.derivation ? "Edit working" : "Add working"}</button>
                  </div>
                )
              )}
              {/* Change history */}
              <div>
                <div className="text-xs font-semibold text-stone-500 mb-1.5">Change history</div>
                {!hist ? (
                  <div className="text-xs text-stone-400">{historyLoading ? "Loading…" : "—"}</div>
                ) : hist.length === 0 ? (
                  <div className="text-xs text-stone-400">No changes logged.</div>
                ) : (
                  <ul className="space-y-1">
                    {hist.map(h => (
                      <li key={h.id} className="text-xs text-stone-600 flex flex-wrap gap-x-2">
                        <span className="text-stone-400 tabular-nums">{new Date(h.changedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                        <span>{h.oldCost == null ? "created" : `₹${h.oldCost.toLocaleString("en-IN")}`} → {h.newCost == null ? "deleted" : `₹${h.newCost.toLocaleString("en-IN")}`}</span>
                        {h.source && <span className="text-stone-400">· {h.source}</span>}
                        {h.changedBy && <span className="text-stone-400">· {h.changedBy}</span>}
                        {h.reason && <span className="text-stone-500">· {h.reason}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  })();

  const colHeaders = (
    <tr className="border-b border-stone-100 bg-stone-50 text-xs text-stone-500">
      <th className="text-left px-4 py-2.5 font-medium">Parameter</th>
      <th className="text-left px-3 py-2.5 font-medium">Unit</th>
      <th className="text-right px-3 py-2.5 font-medium w-28">Default</th>
      <th className="text-right px-3 py-2.5 font-medium w-32">Current</th>
      <th className="w-24 px-3 py-2.5"></th>
    </tr>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-y-2 mb-4">
        <p className="text-sm text-stone-500">Unit costs used to auto-generate budgets. Changes apply to new budgets only.</p>
        <div className="flex items-center gap-3">
          {isSeeded && (
            <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
              {domainCosts.filter(c => c.isEdited).length} customised · {domainCosts.length} items
            </span>
          )}
          <button onClick={handleSeed} disabled={pending}
            className={`text-sm px-3 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-50 ${!isSeeded ? "bg-sky-600 text-white hover:bg-sky-700" : "border border-stone-200 text-stone-500 hover:bg-stone-50"}`}>
            {pending ? "Seeding…" : !isSeeded ? "Seed defaults" : "Re-seed defaults"}
          </button>
        </div>
      </div>

      {/* Domain tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {grouped.map(g => (
          <button key={g.domain ?? "cross"} onClick={() => setActiveDomain(g.domain ?? "cross")}
            className={`text-sm px-4 py-1.5 rounded-lg whitespace-nowrap transition-all ${activeDomain === (g.domain ?? "cross") ? "bg-sky-600 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
            {g.label}
            {g.costs.some(c => c.isEdited) && <span className="ml-1.5 w-1.5 h-1.5 bg-amber-400 rounded-full inline-block" />}
          </button>
        ))}
      </div>

      {/* Cost table */}
      {(() => {
        const isCost = (row: CostRow) => row.unit.includes("₹");
        const costRows  = currentGroup?.costs.filter(isCost) ?? [];
        const ratioRows = currentGroup?.costs.filter(r => !isCost(r)) ?? [];
        const sectionHeader = (label: string) => (
          <tr key={label}><td colSpan={5} className="px-4 pt-4 pb-1.5 text-xs font-semibold text-stone-500 uppercase tracking-wide bg-white">{label}</td></tr>
        );
        return (
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            {costRows.length === 0 && ratioRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-stone-400 text-center">No cost items for this domain yet.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>{colHeaders}</thead>
                <tbody>
                  {costRows.length > 0 && sectionHeader("Unit Costs")}
                  {costRows.map(renderRow)}
                  {ratioRows.length > 0 && sectionHeader("Programme Ratios")}
                  {ratioRows.map(renderRow)}
                </tbody>
              </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* Add new cost item */}
      <div className="mt-3">
        {addingItem ? (
          <div className="p-4 bg-white border border-stone-200 rounded-xl space-y-3">
            <div className="flex gap-1 bg-stone-100 rounded-lg p-1 w-fit">
              {(["cost", "ratio"] as const).map(type => (
                <button key={type} onClick={() => { setNewItemType(type); setNewUnit(type === "cost" ? "₹" : "ratio"); }}
                  className={`text-sm px-4 py-1 rounded-md transition-all ${newItemType === type ? "bg-white shadow-sm text-stone-900 font-medium" : "text-stone-500 hover:text-stone-800"}`}>
                  {type === "cost" ? "Unit Cost" : "Programme Ratio"}
                </button>
              ))}
            </div>
            <p className="text-xs text-stone-400">
              {newItemType === "cost" ? "A monetary cost used directly in budget lines." : "A parameter or ratio referenced in formulas."}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="sm:col-span-2">
                <span className="text-xs font-medium text-stone-600">Key name</span>
                <input value={newKey} onChange={e => setNewKey(e.target.value)}
                  placeholder={`e.g. ${activeDomain === "cross" ? "cross" : (activeDomain ?? "children").toLowerCase()}.${newItemType === "cost" ? "accommodation_per_person" : "days_per_year"}`}
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-500" />
                <p className="text-xs text-stone-400 mt-0.5">domain.descriptive_name format</p>
              </label>
              <label>
                <span className="text-xs font-medium text-stone-600">Unit label</span>
                <input value={newUnit} onChange={e => setNewUnit(e.target.value)}
                  placeholder={newItemType === "cost" ? "e.g. ₹ / person" : "e.g. workers per creche"}
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
              <label>
                <span className="text-xs font-medium text-stone-600">{newItemType === "cost" ? "Cost (₹)" : "Value"}</span>
                <input type="number" value={newCost} onChange={e => setNewCost(e.target.value)}
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
              <label className="sm:col-span-2">
                <span className="text-xs font-medium text-stone-600">Notes (optional)</span>
                <input value={newNotes} onChange={e => setNewNotes(e.target.value)}
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAddingItem(false); setNewKey(""); setNewCost(""); setNewNotes(""); setNewUnit("₹"); setNewItemType("cost"); }}
                className="text-sm text-stone-500 hover:text-stone-800 px-3 py-1.5">Cancel</button>
              <button onClick={handleAddItem} disabled={pending || !newKey.trim() || !newCost}
                className="text-sm bg-sky-600 text-white px-4 py-1.5 rounded-lg hover:bg-sky-700 disabled:opacity-50">
                {pending ? "Saving…" : `Add ${newItemType === "cost" ? "cost item" : "ratio"}`}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAddingItem(true)}
            className="text-sm text-sky-600 hover:text-sky-800 border border-dashed border-sky-300 rounded-lg px-4 py-2 hover:bg-sky-50 w-full">
            + New cost item or ratio
          </button>
        )}
      </div>

      {/* Programme inputs — editable */}
      <div className="mt-8">
        <div className="flex flex-wrap items-start justify-between gap-y-2 mb-2">
          <div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Programme inputs</p>
            <p className="text-xs text-stone-400 mt-0.5">
              Default values used in Cost Analysis. Reference as <span className="font-mono">inp.*</span> keys in template formulas.
            </p>
          </div>
          <div className="flex gap-2 ml-4 shrink-0">
            {progInputRows.some(r => r.itemKey.startsWith("inp.") && r.displayGroup === null) && (
              <button onClick={handleBackfillGroups} disabled={pending}
                className="text-sm border border-stone-300 text-stone-500 px-3 py-1.5 rounded-lg hover:bg-stone-50 disabled:opacity-50">
                Fix sections
              </button>
            )}
            <button onClick={handleSeedProgInputs} disabled={pending}
              className={`text-sm px-3 py-1.5 rounded-lg disabled:opacity-50 ${progInputRows.length === 0 ? "bg-sky-600 text-white hover:bg-sky-700" : "border border-stone-200 text-stone-500 hover:bg-stone-50"}`}>
              {pending ? "Seeding…" : progInputRows.length === 0 ? "Seed standard inputs" : "Re-seed standard inputs"}
            </button>
          </div>
        </div>

        {progInputRows.length > 0 ? (
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>{colHeaders}</thead>
              <tbody>{progInputRows.map(renderRow)}</tbody>
            </table>
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-stone-200 rounded-xl p-6 text-center">
            <p className="text-sm text-stone-400">No programme inputs yet.</p>
            <p className="text-xs text-stone-300 mt-1">Click "Seed standard inputs" to create defaults for CLCs, YRCs, elderly centres, rents, etc.</p>
          </div>
        )}

        <div className="mt-2">
          {addingProgInput ? (
            <div className="p-3 bg-white border border-stone-200 rounded-xl">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <label>
                  <span className="text-xs text-stone-500">Key (inp. suffix)</span>
                  <div className="flex mt-0.5">
                    <span className="px-2 py-1 bg-stone-50 border border-r-0 border-stone-300 rounded-l text-xs text-stone-400 font-mono">inp.</span>
                    <input value={newProgKey} onChange={e => setNewProgKey(e.target.value)}
                      placeholder="n_volunteers"
                      className="w-full border border-stone-300 rounded-r px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                </label>
                <label>
                  <span className="text-xs text-stone-500">Unit</span>
                  <select value={newProgUnit} onChange={e => setNewProgUnit(e.target.value)}
                    className="mt-0.5 w-full border border-stone-300 rounded px-2 py-1 text-sm focus:outline-none">
                    <option value="count">count</option>
                    <option value="₹/month">₹/month</option>
                    <option value="ratio">ratio</option>
                    <option value="days">days</option>
                  </select>
                </label>
                <label>
                  <span className="text-xs text-stone-500">Default value</span>
                  <input type="number" value={newProgValue} onChange={e => setNewProgValue(e.target.value)}
                    className="mt-0.5 w-full border border-stone-300 rounded px-2 py-1 text-sm focus:outline-none" />
                </label>
                <label>
                  <span className="text-xs text-stone-500">Section (in analysis)</span>
                  <select value={newProgGroup} onChange={e => setNewProgGroup(e.target.value)}
                    className="mt-0.5 w-full border border-stone-300 rounded px-2 py-1 text-sm focus:outline-none">
                    <option value="geography">Geography & Scale</option>
                    <option value="facilities">Facilities</option>
                    <option value="coverage">Coverage & Beneficiaries</option>
                  </select>
                </label>
                <label className="sm:col-span-2">
                  <span className="text-xs text-stone-500">Notes / label</span>
                  <input value={newProgNotes} onChange={e => setNewProgNotes(e.target.value)}
                    className="mt-0.5 w-full border border-stone-300 rounded px-2 py-1 text-sm focus:outline-none" />
                </label>
                <div className="flex gap-2">
                  <button onClick={handleAddProgInput} disabled={pending || !newProgKey.trim() || !newProgValue}
                    className="text-sm bg-sky-600 text-white px-3 py-1 rounded hover:bg-sky-700 disabled:opacity-50">
                    {pending ? "…" : "Add"}
                  </button>
                  <button onClick={() => { setAddingProgInput(false); setNewProgKey(""); setNewProgValue(""); setNewProgNotes(""); }}
                    className="text-sm text-stone-400 hover:text-stone-700">Cancel</button>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingProgInput(true)}
              className="text-sm text-sky-600 hover:text-sky-800 border border-dashed border-sky-300 rounded-lg px-4 py-2 hover:bg-sky-50 w-full">
              + Add programme input
            </button>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-stone-400">Cost registry changes apply to newly created budgets only.</p>
    </>
  );
}

// ─── Line template form (add / edit) ─────────────────────────────────────────

const BLANK_FORM: LineTemplateFields = {
  domain: null, section: "programme", description: "", costCategory: "Other",
  unitType: "", inputVar: "fixed_1", inputMonthly: false,
  isSalaryStub: false,
  applyY1: true, applyY2: true, applyY3: true,
};

function TemplateForm({ initial, onSave, onCancel, pending, registryKeys, customInputVars, domains }: {
  initial: LineTemplateFields;
  onSave: (f: LineTemplateFields) => void;
  onCancel: () => void;
  pending: boolean;
  registryKeys: string[];
  customInputVars: { value: string; label: string }[];
  domains: BudgetDomainConfig[];
}) {
  const [f, setF] = useState<LineTemplateFields>(initial);
  const set = <K extends keyof LineTemplateFields>(k: K, v: LineTemplateFields[K]) => setF(p => ({ ...p, [k]: v }));

  const str = (k: keyof LineTemplateFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    set(k, (e.target.value || null) as never);
  const bool = (k: keyof LineTemplateFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, e.target.checked as never);

  return (
    <div className="space-y-3 p-4 bg-stone-50 rounded-xl border border-stone-200">
      <datalist id="admin-ck">
        {registryKeys.map(k => <option key={k} value={k} />)}
        {PROGRAMME_INPUTS.map(p => <option key={p.key} value={p.key} label={p.label} />)}
      </datalist>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-stone-600">Description</span>
          <input value={f.description} onChange={e => set("description", e.target.value)}
            className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500" />
        </label>

        <label>
          <span className="text-xs font-medium text-stone-600">Domain</span>
          <select value={f.domain ?? ""} onChange={e => set("domain", e.target.value || null)}
            className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none">
            <option value="">Cross-cutting</option>
            {domains.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>

        <label>
          <span className="text-xs font-medium text-stone-600">Section</span>
          <select value={f.section} onChange={e => set("section", e.target.value as BudgetSection)}
            className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none">
            {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label>
          <span className="text-xs font-medium text-stone-600">Inflation type</span>
          <select value={f.costCategory} onChange={e => set("costCategory", e.target.value as InflationType)}
            className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none">
            {INFLATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label>
          <span className="text-xs font-medium text-stone-600">Unit type label</span>
          <input value={f.unitType} onChange={e => set("unitType", e.target.value)}
            placeholder="e.g. Per CLC, Month, Annual"
            className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
        </label>
      </div>

      {/* Unit count formula */}
      <div className="border border-stone-200 rounded-lg p-3 bg-white space-y-2">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Unit count formula</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label>
            <span className="text-xs text-stone-600">Scales with</span>
            <select value={f.inputVar ?? "fixed_1"} onChange={e => set("inputVar", e.target.value)}
              className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none">
              {INPUT_VARS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
              {customInputVars.length > 0 && <option disabled>── Custom ──</option>}
              {customInputVars.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </label>
          <label>
            <span className="text-xs text-stone-600">Supervisor ratio key</span>
            <input value={f.supervisorRatioKey ?? ""} onChange={str("supervisorRatioKey")}
              list="admin-ck" placeholder="e.g. creche.supervisor_per_n_creches"
              className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
          </label>
          <label>
            <span className="text-xs text-stone-600">Minimum to include (threshold)</span>
            <input type="number" value={f.inputThreshold ?? ""} min={0}
              onChange={e => set("inputThreshold", (e.target.value ? parseInt(e.target.value) : null) as never)}
              placeholder="e.g. 2 → only if input > 2"
              className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
            <p className="text-xs text-stone-400 mt-0.5">Leave blank for no threshold. Set to 2 to suppress this line when the input variable is ≤ 2.</p>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={f.inputMonthly ?? false} onChange={bool("inputMonthly")} className="rounded" />
          × 12 (monthly → annual)
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={f.y1UnitsZero ?? false} onChange={bool("y1UnitsZero")} className="rounded" />
          Override Y1 units to 0 (e.g. CAPEX maintenance starts Y2)
        </label>

        {/* Year applicability */}
        <div className="border border-stone-100 rounded-lg p-3 bg-stone-50 space-y-2">
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Applicable years</p>
          <div className="flex gap-4">
            {(["Y1", "Y2", "Y3"] as const).map((yr, i) => {
              const k = (["applyY1", "applyY2", "applyY3"] as const)[i];
              return (
                <label key={yr} className="flex items-center gap-1.5 text-sm text-stone-700">
                  <input type="checkbox" checked={f[k] ?? true} onChange={bool(k)} className="rounded" />
                  {yr}
                </label>
              );
            })}
          </div>
          {((f.applyY2 ?? true) || (f.applyY3 ?? true)) && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              {(f.applyY2 ?? true) && (
                <label>
                  <span className="text-xs text-stone-600">Y2 unit scale (blank = same as Y1)</span>
                  <input type="number" step="0.01" min="0"
                    value={f.y2UnitsScale ?? ""}
                    onChange={e => set("y2UnitsScale", e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="e.g. 1.5"
                    className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
                </label>
              )}
              {(f.applyY3 ?? true) && (
                <label>
                  <span className="text-xs text-stone-600">Y3 unit scale (blank = same as Y1)</span>
                  <input type="number" step="0.01" min="0"
                    value={f.y3UnitsScale ?? ""}
                    onChange={e => set("y3UnitsScale", e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="e.g. 2.0"
                    className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
                </label>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Unit cost formula */}
      <div className="border border-stone-200 rounded-lg p-3 bg-white space-y-2">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Unit cost formula</p>

        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={f.isSalaryStub ?? false} onChange={bool("isSalaryStub")} className="rounded" />
          Salary stub (cost = 0, user fills in)
        </label>

        {!f.isSalaryStub && (
          <div className="space-y-2">
            <label>
              <span className="text-xs text-stone-600">User input field (for rent)</span>
              <input value={f.userInputCost ?? ""} onChange={str("userInputCost")}
                placeholder="e.g. clcRentPerMonth, crecheRentPerMonth"
                className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label>
                <span className="text-xs text-stone-600">Cost key (primary)</span>
                <input value={f.costKey ?? ""} onChange={str("costKey")}
                  list="admin-ck" placeholder="e.g. children.snack_per_child_per_day"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
              <label>
                <span className="text-xs text-stone-600">× key 2 (optional)</span>
                <input value={f.costKey2 ?? ""} onChange={str("costKey2")}
                  list="admin-ck" placeholder="e.g. children.snack_days_per_year"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
              <label>
                <span className="text-xs text-stone-600">× key 3 (optional)</span>
                <input value={f.costKey3 ?? ""} onChange={str("costKey3")}
                  list="admin-ck" placeholder="e.g. children.children_per_clc"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={f.costMonthly ?? false} onChange={bool("costMonthly")} className="rounded" />
              × 12 on cost keys product (monthly → annual)
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="text-xs text-stone-600">Worker ratio key (optional)</span>
                <input value={f.workerRatioKey ?? ""} onChange={str("workerRatioKey")}
                  list="admin-ck" placeholder="e.g. creche.workers_per_creche"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
              <label>
                <span className="text-xs text-stone-600">Buffer % key (optional)</span>
                <input value={f.bufferKey ?? ""} onChange={str("bufferKey")}
                  list="admin-ck" placeholder="e.g. creche.maternity_buffer_pct"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="text-xs text-stone-600">% of registry key (CAPEX-style)</span>
                <input value={f.costPctOf ?? ""} onChange={str("costPctOf")}
                  list="admin-ck" placeholder="e.g. creche.setup_cost"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
              <label>
                <span className="text-xs text-stone-600">Percentage</span>
                <input type="number" value={f.costPct ?? ""} onChange={e => set("costPct", parseFloat(e.target.value) || null)}
                  placeholder="e.g. 5"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
            </div>
          </div>
        )}

        {f.isSalaryStub && (
          <label>
            <span className="text-xs text-stone-600">Salary hint</span>
            <input value={f.salaryHint ?? ""} onChange={str("salaryHint")}
              placeholder="e.g. ₹40,000–55,000/month"
              className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
          </label>
        )}
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="text-sm text-stone-500 hover:text-stone-800 px-3 py-1.5">Cancel</button>
        <button onClick={() => onSave(f)} disabled={pending || !f.description.trim()}
          className="text-sm bg-sky-600 text-white px-4 py-1.5 rounded-lg hover:bg-sky-700 disabled:opacity-50">
          {pending ? "Saving…" : "Save line"}
        </button>
      </div>
    </div>
  );
}

// ─── Line Templates tab ───────────────────────────────────────────────────────

const SECTION_BADGE: Record<string, string> = {
  salary: "bg-blue-50 text-blue-700",
  capex: "bg-purple-50 text-purple-700",
  travel: "bg-orange-50 text-orange-700",
  programme: "bg-green-50 text-green-700",
  admin_salary: "bg-slate-50 text-slate-700",
  admin_other: "bg-slate-50 text-slate-700",
  additional: "bg-stone-50 text-stone-700",
};

function buildNewGlobalOrder(
  allTemplates: LineTemplate[],
  domainKey: string | null,
  newVisibleOrder: LineTemplate[],
): string[] {
  const sorted = [...allTemplates].sort((a, b) => a.position - b.position);
  const result: string[] = [];
  let vi = 0;
  for (const t of sorted) {
    if (t.domain === domainKey) {
      result.push(newVisibleOrder[vi++].id);
    } else {
      result.push(t.id);
    }
  }
  return result;
}

const STANDARD_INP_KEYS = new Set([
  "inp.nSettlements","inp.nClusters","inp.cosPerCluster","inp.cosTotal",
  "inp.nCLCs","inp.clcRentPerMonth","inp.nYRCs","inp.yrcRentPerMonth",
  "inp.nElderlyCentres","inp.nElderly","inp.elderlyCentreRentPerMonth",
  "inp.nCreches","inp.crecheRentPerMonth","inp.rcRentPerMonth",
]);

function LineTemplatesTab({ templates, city, registryKeys, costs, domains }: {
  templates: LineTemplate[]; city: string; registryKeys: string[]; costs: CostRow[];
  domains: BudgetDomainConfig[];
}) {
  const [pending, startTransition] = useTransition();
  const [activeDomain, setActiveDomain] = useState<string>(() => domains[0]?.key ?? "");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const customInputVars = useMemo(() =>
    costs
      .filter(c => c.itemKey.startsWith("inp.") && !STANDARD_INP_KEYS.has(c.itemKey))
      .map(c => ({
        value: c.itemKey.slice(4), // strip "inp." — matches extraInputs key
        label: c.notes ?? c.itemKey.slice(4).replace(/_/g, " "),
      })),
    [costs]
  );

  const domainKey = activeDomain === "cross" ? null : activeDomain;
  const visible = useMemo(() =>
    templates
      .filter(t => activeDomain === "cross" ? t.domain === null : t.domain === activeDomain)
      .sort((a, b) => a.position - b.position),
    [templates, activeDomain]
  );


  const domainTabs = [
    ...domains.map(d => ({
      key: d.key, label: d.label,
      count: templates.filter(t => t.domain === d.key).length,
    })),
    { key: "cross", label: "Cross-cutting + Admin", count: templates.filter(t => t.domain === null).length },
  ];

  const handleToggle = (id: string, current: boolean) =>
    startTransition(() => toggleLineTemplate(id, !current));

  const handleAdd = (fields: LineTemplateFields) =>
    startTransition(async () => {
      await addLineTemplate(city, { ...fields, domain: domainKey });
      setAdding(false);
    });

  const handleEdit = (id: string, fields: LineTemplateFields) =>
    startTransition(async () => {
      await updateLineTemplate(id, fields);
      setEditingId(null);
    });

  const handleDelete = (id: string) => {
    if (!confirm("Delete this line template? This affects all future budgets for this city.")) return;
    startTransition(() => deleteLineTemplate(id));
  };

  const handleSeed = () => startTransition(() => seedLineTemplates(city));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedId || !dragOverId || draggedId === dragOverId) {
      setDraggedId(null); setDragOverId(null); return;
    }
    const from = visible.findIndex(t => t.id === draggedId);
    const to   = visible.findIndex(t => t.id === dragOverId);
    const reordered = [...visible];
    const [item] = reordered.splice(from, 1);
    reordered.splice(to, 0, item);
    const globalOrder = buildNewGlobalOrder(templates, domainKey, reordered);
    setDraggedId(null); setDragOverId(null);
    startTransition(() => reorderLineTemplates(city, globalOrder));
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-y-2 mb-4">
        <p className="text-sm text-stone-500">
          Line items generated for each new budget. Changes apply to newly created budgets only.
        </p>
        <button onClick={handleSeed} disabled={pending}
          className={`text-sm px-3 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-50 ${templates.length === 0 ? "bg-sky-600 text-white hover:bg-sky-700" : "border border-stone-200 text-stone-500 hover:bg-stone-50"}`}>
          {pending ? "Seeding…" : templates.length === 0 ? "Seed templates" : "Re-seed defaults"}
        </button>
      </div>

      {/* Domain tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {domainTabs.map(d => (
          <button key={d.key} onClick={() => { setActiveDomain(d.key); setDraggedId(null); setDragOverId(null); }}
            className={`text-sm px-3 py-1.5 rounded-lg whitespace-nowrap transition-all ${activeDomain === d.key ? "bg-sky-600 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
            {d.label}
            <span className={`ml-1.5 text-xs ${activeDomain === d.key ? "text-sky-200" : "text-stone-400"}`}>{d.count}</span>
          </button>
        ))}
      </div>

      {/* Template list */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-sm text-stone-400 text-center">No templates for this domain yet.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-xs text-stone-500">
                <th className="w-6 px-2 py-2.5"></th>
                <th className="text-left px-4 py-2.5 font-medium">Description</th>
                <th className="text-left px-3 py-2.5 font-medium w-24">Section</th>
                <th className="text-left px-3 py-2.5 font-medium w-16">Inflation</th>
                <th className="text-left px-3 py-2.5 font-medium">Formula</th>
                <th className="w-28 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(t => (
                <Fragment key={t.id}>
                  <tr
                    draggable
                    onDragStart={() => setDraggedId(t.id)}
                    onDragOver={e => { e.preventDefault(); setDragOverId(prev => prev === t.id ? prev : t.id); }}
                    onDrop={handleDrop}
                    onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                    className={[
                      "border-b border-stone-50 group",
                      !t.isActive ? "opacity-40" : "",
                      draggedId === t.id ? "opacity-30" : "",
                      dragOverId === t.id && draggedId !== t.id ? "border-t-2 border-sky-400" : "",
                    ].join(" ")}
                  >
                    <td className="px-2 py-2.5 text-stone-300 cursor-grab select-none text-center" title="Drag to reorder">⠿</td>
                    <td className="px-4 py-2.5">
                      <div className="text-stone-800 font-medium">{t.description}</div>
                      {t.salaryHint && <div className="text-xs text-stone-400 mt-0.5">{t.salaryHint}</div>}
                      {t.notes && <div className="text-xs text-stone-400 mt-0.5">{t.notes}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SECTION_BADGE[t.section] ?? "bg-stone-50 text-stone-600"}`}>
                        {t.section}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-stone-500">{t.costCategory}</td>
                    <td className="px-3 py-2.5 text-xs text-stone-400 font-mono max-w-xs truncate" title={formulaSummary(t)}>
                      {formulaSummary(t)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                          className="text-xs text-sky-600 hover:text-sky-800">Edit</button>
                        <button onClick={() => handleToggle(t.id, t.isActive)}
                          className="text-xs text-stone-400 hover:text-stone-700">
                          {t.isActive ? "Off" : "On"}
                        </button>
                        <button onClick={() => handleDelete(t.id)}
                          className="text-xs text-stone-300 hover:text-red-500">Del</button>
                      </div>
                    </td>
                  </tr>
                  {editingId === t.id && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 bg-sky-50 border-b border-sky-100">
                        <TemplateForm
                          initial={{ domain: t.domain, section: t.section, description: t.description, costCategory: t.costCategory, unitType: t.unitType, notes: t.notes, salaryHint: t.salaryHint, isAutoGenerated: t.isAutoGenerated, inputVar: t.inputVar, inputMonthly: t.inputMonthly, supervisorRatioKey: t.supervisorRatioKey, inputThreshold: t.inputThreshold, isSalaryStub: t.isSalaryStub, userInputCost: t.userInputCost, costKey: t.costKey, costKey2: t.costKey2, costKey3: t.costKey3, costMonthly: t.costMonthly, workerRatioKey: t.workerRatioKey, bufferKey: t.bufferKey, costPctOf: t.costPctOf, costPct: t.costPct, y1UnitsZero: t.y1UnitsZero, applyY1: t.applyY1, applyY2: t.applyY2, applyY3: t.applyY3, y2UnitsScale: t.y2UnitsScale, y3UnitsScale: t.y3UnitsScale }}
                          onSave={fields => handleEdit(t.id, fields)}
                          onCancel={() => setEditingId(null)}
                          pending={pending}
                          registryKeys={registryKeys}
                          customInputVars={customInputVars}
                          domains={domains}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Add form or button */}
      <div className="mt-3">
        {adding ? (
          <TemplateForm
            initial={{ ...BLANK_FORM, domain: domainKey }}
            onSave={handleAdd}
            onCancel={() => setAdding(false)}
            pending={pending}
            registryKeys={registryKeys}
            customInputVars={customInputVars}
            domains={domains}
          />
        ) : (
          <button onClick={() => setAdding(true)}
            className="text-sm text-sky-600 hover:text-sky-800 border border-dashed border-sky-300 rounded-lg px-4 py-2 hover:bg-sky-50 w-full">
            + Add line template
          </button>
        )}
      </div>
    </>
  );
}

// ─── Cost Analysis tab ────────────────────────────────────────────────────────


// Sections excluded from per-beneficiary cost calculations
const EXCLUDED_FROM_PER_UNIT = new Set<BudgetSection>(["capex", "admin_salary", "admin_other"]);

const fmt = (n: number) => n === 0 ? "—" : n.toLocaleString("en-IN");
const fmtCost = (n: number) => n === 0 ? "—" : `₹${n.toLocaleString("en-IN")}`;
const INP_CLS = "mt-0.5 w-full border border-stone-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500";
const DERIVED_CLS = "mt-0.5 px-2 py-1 text-sm border border-stone-100 rounded bg-stone-50 text-stone-500 tabular-nums";
const SCENARIO_CLS = "mt-0.5 px-2 py-1 text-sm border border-sky-200 rounded bg-sky-50 text-sky-700 tabular-nums font-medium";

// Parse "₹40,000–55,000/month" or "₹45,000/month" → average monthly value
function parseIndicativeSalary(hint: string | null | undefined): number {
  if (!hint) return 0;
  const nums = [...hint.replace(/,/g, "").matchAll(/\d+/g)]
    .map(m => parseInt(m[0]))
    .filter(n => n > 999);
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
}

type GeoItem = { id: string; name: string };
type GeoLevel = "city" | "zone" | "cluster" | "settlement";
type ScenarioMetric = "need" | "addressable" | "existing" | "plan" | "gap";

const METRIC_LABELS: Record<ScenarioMetric, string> = {
  need: "Need", addressable: "Addressable", existing: "Existing", plan: "Plan", gap: "Gap",
};

function CostAnalysisTab({ templates, costs, domains, city, zones, cityBudgets }: {
  templates: LineTemplate[]; costs: CostRow[]; domains: BudgetDomainConfig[];
  city: string; zones: GeoItem[];
  cityBudgets: CompareBudget[];
}) {
  const ALL_DOMAINS = domains.map(d => d.key);
  const [inp, setInp] = useState<BudgetGeneratorInputs>(() => makeDefaultInputs(costs));
  const setField = (k: string, v: number) =>
    setInp(p => ({ ...p, [k]: isNaN(v) ? 0 : v }));

  // ── Domain filter — chips at top decide which domains drive the panel
  //    below + which per-domain tables render. Initially all selected so the
  //    landing experience matches today's "everything visible".
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(() => new Set(ALL_DOMAINS));
  // Locally named to avoid shadowing the imported toggleDomain server action.
  const toggleDomainFilter = (key: string) => setSelectedDomains(p => {
    const next = new Set(p);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // ── Compare-with-budget — null when none loaded.
  const [compareBudgetId, setCompareBudgetId] = useState<string>("");
  const [compareData, setCompareData] = useState<{
    name: string;
    programmeInputs: Record<string, number>;
    costOverrides: Record<string, number>;
    // Saved BudgetLine rows from the partner budget — the authoritative source
    // for Yours-column values (includes salary-stub fill-ins + manual edits).
    lines: Array<{
      id: string;
      templateKey: string | null;
      domain: string | null;
      section: BudgetSection;
      description: string;
      y1Total: number;
      y2Total: number;
      y3Total: number;
      y4Total: number;
      y5Total: number;
    }>;
  } | null>(null);
  const [comparePending, startCompare] = useTransition();
  const onCompareChange = (id: string) => {
    setCompareBudgetId(id);
    if (!id) { setCompareData(null); return; }
    startCompare(async () => {
      try { setCompareData(await loadBudgetForCompare(id)); }
      catch { setCompareData(null); }
    });
  };

  const [exporting, setExporting] = useState(false);
  const exportComparison = async () => {
    if (!compareData || exporting) return;
    setExporting(true);
    try {
      const summary = perUnit.map(r => ({ label: r.label, sub: r.sub, std: r.std, you: r.you }));
      const stdKeys = new Set(indicativeLines.map(l => l.templateKey).filter(Boolean));
      const grand = (o: { y1Total: number; y2Total: number; y3Total: number; y4Total?: number; y5Total?: number }) =>
        o.y1Total + o.y2Total + o.y3Total + (o.y4Total ?? 0) + (o.y5Total ?? 0);
      type ExpLine = { domain: string; section: string; description: string; std: number | null; you: number | null; stdTotal: number | null; youTotal: number | null };
      const lines: ExpLine[] = [];
      // Standard lines — skip those the user excluded from the like-for-like scope.
      for (const l of indicativeLines) {
        if (excludedTemplateKeys.has(l.templateKey)) continue;
        const you = l.templateKey ? youLineMap.get(l.templateKey) : undefined;
        lines.push({
          domain: l.domain ?? "Cross-cutting",
          section: String(l.section),
          description: l.description,
          std: l.y1Total,
          you: you ? you.y1Total : 0,
          stdTotal: grand(l),
          youTotal: you ? grand(you) : 0,
        });
      }
      // Yours-only additions (no matching standard template) — honour the symmetric exclude.
      for (const yl of compareData.lines) {
        if (yl.templateKey && stdKeys.has(yl.templateKey)) continue;
        if (excludedOrphanIds.has(yl.id)) continue;
        lines.push({
          domain: yl.domain ?? "Cross-cutting",
          section: String(yl.section),
          description: `${yl.description} (your addition)`,
          std: null,
          you: yl.y1Total,
          stdTotal: null,
          youTotal: grand(yl),
        });
      }
      const res = await fetch("/api/budget/cost-analysis-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ standardName: "Standard", compareName: compareData.name, summary, lines }),
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cost-analysis_${compareData.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // Per-table-row expansion (formula breakdown drawer). Keyed by `${domain}:${position}`.
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());
  const toggleLineExpand = (key: string) => setExpandedLines(p => {
    const next = new Set(p);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // Standard-side exclusions for like-for-like comparison. Session-only — does
  // not touch the cost registry, does not persist across reloads. Keyed by
  // templateKey since every generated standard line carries one.
  const [excludedTemplateKeys, setExcludedTemplateKeys] = useState<Set<string>>(new Set());
  const toggleExcludeLine = (templateKey: string) => setExcludedTemplateKeys(p => {
    const next = new Set(p);
    next.has(templateKey) ? next.delete(templateKey) : next.add(templateKey);
    return next;
  });
  // Symmetric exclude — Yours-only "your addition" rows can also be dropped
  // from the Yours sums so the Δ vs Standard reads as a strict like-for-like
  // rate check. Keyed by BudgetLine.id since orphans don't have templateKey.
  const [excludedOrphanIds, setExcludedOrphanIds] = useState<Set<string>>(new Set());
  const toggleExcludeOrphan = (lineId: string) => setExcludedOrphanIds(p => {
    const next = new Set(p);
    next.has(lineId) ? next.delete(lineId) : next.add(lineId);
    return next;
  });
  // Unified "show all" clears both sides — keeps the header bar simple.
  const showAllStandard = () => {
    setExcludedTemplateKeys(new Set());
    setExcludedOrphanIds(new Set());
  };
  const totalExclusions = excludedTemplateKeys.size + excludedOrphanIds.size;

  // ── Scenario picker state ──────────────────────────────────────────────────
  const [geoLevel, setGeoLevel]             = useState<GeoLevel>("city");
  const [geoZoneId, setGeoZoneId]           = useState("");
  const [geoClusterId, setGeoClusterId]     = useState("");
  const [geoSettlementId, setGeoSettlementId] = useState("");
  const [clusterOptions, setClusterOptions]   = useState<GeoItem[]>([]);
  const [settlementOptions, setSettlementOptions] = useState<GeoItem[]>([]);
  const [scenarioMetric, setScenarioMetric] = useState<ScenarioMetric>("plan");
  const [scenarioLabel, setScenarioLabel]   = useState<string | null>(null);
  const [loadPending, startLoad]            = useTransition();
  const [cascadePending, startCascade]      = useTransition();

  const handleLevelChange = (lvl: GeoLevel) => {
    setGeoLevel(lvl);
    setGeoClusterId(""); setGeoSettlementId("");
    setClusterOptions([]); setSettlementOptions([]);
    // If zone already selected and drilling to cluster/settlement, fetch clusters
    if (geoZoneId && (lvl === "cluster" || lvl === "settlement")) {
      startCascade(async () => {
        setClusterOptions(await getGeoChildren("zone", geoZoneId));
      });
    }
  };

  const handleZoneChange = (zoneId: string) => {
    setGeoZoneId(zoneId); setGeoClusterId(""); setGeoSettlementId("");
    setClusterOptions([]); setSettlementOptions([]);
    if (zoneId && (geoLevel === "cluster" || geoLevel === "settlement")) {
      startCascade(async () => {
        setClusterOptions(await getGeoChildren("zone", zoneId));
      });
    }
  };

  const handleClusterChange = (clusterId: string) => {
    setGeoClusterId(clusterId); setGeoSettlementId(""); setSettlementOptions([]);
    if (clusterId && geoLevel === "settlement") {
      startCascade(async () => {
        setSettlementOptions(await getGeoChildren("cluster", clusterId));
      });
    }
  };

  const geoId =
    geoLevel === "city"       ? city :
    geoLevel === "zone"       ? geoZoneId :
    geoLevel === "cluster"    ? geoClusterId :
    geoSettlementId;

  const geoName =
    geoLevel === "city"       ? city :
    geoLevel === "zone"       ? (zones.find(z => z.id === geoZoneId)?.name ?? "") :
    geoLevel === "cluster"    ? (clusterOptions.find(c => c.id === geoClusterId)?.name ?? "") :
    (settlementOptions.find(s => s.id === geoSettlementId)?.name ?? "");

  const canLoad = geoLevel === "city"
    ? true
    : geoLevel === "zone" ? !!geoZoneId
    : geoLevel === "cluster" ? !!geoClusterId
    : !!geoSettlementId;

  // Scenario overlay — stored separately so inp (manual) is never mutated
  const [scenarioOverrides, setScenarioOverrides] = useState<Record<string, number> | null>(null);

  const handleLoad = () => {
    if (!canLoad) return;
    startLoad(async () => {
      const vals = await loadNeedsScenario(city, geoLevel, geoId, scenarioMetric);
      setScenarioOverrides(vals);
      setScenarioLabel(`${geoName} · ${METRIC_LABELS[scenarioMetric]}`);
    });
  };

  const handleReset = () => {
    setScenarioOverrides(null);
    setScenarioLabel(null);
  };

  // Logical display order within each group (lower = earlier; unknown keys get 999)
  const PROG_SORT: Record<string, number> = {
    // Geography — clusters → settlements → COs
    nClusters: 1, nSettlements: 2, cosPerCluster: 3, cosTotal: 4,
    // Facilities — count then rent, grouped by facility type
    nCLCs: 10, clcRentPerMonth: 11,
    nYRCs: 12, yrcRentPerMonth: 13,
    nElderlyCentres: 14, elderlyCentreRentPerMonth: 15,
    nCreches: 16, crecheRentPerMonth: 17,
    nResourceCentres: 18, nRCs: 18, rcRentPerMonth: 19,
    // Coverage — enrolled first, then totals, then kitchens/support
    nElderly: 10, nElderlyTotal: 11, nElderlyKitchens: 12,
  };
  const sortProg = (a: { key: string }, b: { key: string }) =>
    (PROG_SORT[a.key] ?? 999) - (PROG_SORT[b.key] ?? 999);

  // All inp.* items grouped by displayGroup and sorted in logical order
  const progByGroup = useMemo(() => {
    const groups: Record<"geography" | "facilities" | "coverage", { key: string; label: string }[]> = {
      geography: [], facilities: [], coverage: [],
    };
    for (const c of costs) {
      if (!c.itemKey.startsWith("inp.")) continue;
      const key = c.itemKey.slice(4);
      const label = c.notes ?? key.replace(/_/g, " ");
      const g = (c.displayGroup ?? "coverage") as "geography" | "facilities" | "coverage";
      groups[g].push({ key, label });
    }
    groups.geography.sort(sortProg);
    groups.facilities.sort(sortProg);
    groups.coverage.sort(sortProg);
    return groups;
  }, [costs]);

  // Households: editable override; falls back to nSettlements × hhPerSettlement
  const [hhOverride, setHhOverride] = useState<number | null>(null);

  // Returns a read-only scenario display when a scenario overrides this key, else a normal input
  const inpField = (key: string) => {
    const override = scenarioOverrides?.[key];
    if (override !== undefined) {
      return <div className={SCENARIO_CLS}>{Math.round(override).toLocaleString("en-IN")}</div>;
    }
    return (
      <input type="number" min={0} value={inp[key] ?? 0}
        onChange={e => setField(key, parseFloat(e.target.value))} className={INP_CLS} />
    );
  };

  const registry = useMemo(
    () => Object.fromEntries(costs.map(c => [c.itemKey, c.currentCost])),
    [costs]
  );

  // Scenario overrides layer on top of manual inp — never mutates inp
  const effectiveInp = useMemo<BudgetGeneratorInputs>(
    () => scenarioOverrides ? { ...inp, ...scenarioOverrides } : inp,
    [inp, scenarioOverrides]
  );

  const lines = useMemo(
    // Cost-analysis scenario uses 36-month horizon with default inflation for
    // benchmarking. Inflation horizon stays standard regardless of compare-with;
    // we only overlay the partner's inputs + cost overrides, not their period.
    () => generateBudgetLines(ALL_DOMAINS, effectiveInp, { horizonMonths: 36, applyInflation: true }, registry, templates),
    [effectiveInp, registry, templates]
  );

  // "You" projection sources directly from the partner budget's saved
  // BudgetLine rows. Earlier versions re-ran the generator against the
  // partner's inputs + overrides — but the generator can't reproduce
  // salary-stub fill-ins or any manual unit-cost / category edits the partner
  // made after creation, so Salary rows landed as ₹0 in Yours even when the
  // partner had clearly entered them. The saved totals are authoritative.
  // Keyed by templateKey for O(1) lookup from the per-domain table.
  const youLineMap = useMemo(() => {
    const m = new Map<string, { y1Total: number; y2Total: number; y3Total: number; y4Total: number; y5Total: number }>();
    if (!compareData) return m;
    // Multi-partner budgets carry one line per partner sharing the same
    // templateKey — SUM them so the per-line/subtotal "Yours" reflects the whole
    // budget, not just whichever partner's line was last (which undercounted).
    for (const l of compareData.lines) {
      if (!l.templateKey) continue;
      const ex = m.get(l.templateKey);
      if (ex) {
        ex.y1Total += l.y1Total; ex.y2Total += l.y2Total; ex.y3Total += l.y3Total;
        ex.y4Total += l.y4Total; ex.y5Total += l.y5Total;
      } else {
        m.set(l.templateKey, { y1Total: l.y1Total, y2Total: l.y2Total, y3Total: l.y3Total, y4Total: l.y4Total, y5Total: l.y5Total });
      }
    }
    return m;
  }, [compareData]);

  // Which inp.* keys are referenced by selected-domain templates. Used to
  // hide irrelevant programme-size inputs as the user narrows their selection.
  const inpKeysBySelectedDomain = useMemo(() => {
    const visible = new Set<string>();
    for (const t of templates) {
      if (!t.isActive || !t.domain) continue;
      if (!selectedDomains.has(t.domain)) continue;
      if (t.inputVar)       visible.add(t.inputVar);
      if (t.userInputCost)  visible.add(t.userInputCost);
    }
    return visible;
  }, [templates, selectedDomains]);

  type AnalysisLine = ReturnType<typeof generateBudgetLines>[number] & { isIndicative: boolean };

  // Fill salary stubs with indicative values parsed from salaryHint
  const indicativeLines = useMemo<AnalysisLine[]>(() =>
    lines.map(l => {
      const isSalaryStub = l.y1UnitCost === 0 && l.y1Units > 0 && !!l.salaryHint;
      if (!isSalaryStub) return { ...l, isIndicative: false };
      const mo = parseIndicativeSalary(l.salaryHint);
      const y2uc = Math.round(mo * 1.10);
      const y3uc = Math.round(mo * 1.21);
      return {
        ...l,
        y1UnitCost: mo,       y1Total: Math.round(l.y1Units * mo),
        y2UnitCost: y2uc,     y2Total: Math.round(l.y2Units * y2uc),
        y3UnitCost: y3uc,     y3Total: Math.round(l.y3Units * y3uc),
        isIndicative: true,
      };
    }),
    [lines]
  );

  // Operational lines only (no capex / admin_salary / admin_other). Std-side
  // exclusions are honoured here so the per-beneficiary tiles reflect the
  // user's like-for-like scope.
  const opLines = useMemo(
    () => indicativeLines.filter(l =>
      !EXCLUDED_FROM_PER_UNIT.has(l.section) && !excludedTemplateKeys.has(l.templateKey)
    ),
    [indicativeLines, excludedTemplateKeys]
  );

  // Total children derived from registry ratio
  const totalChildren = Math.round((effectiveInp.nCLCs ?? 0) * (registry["children.children_per_clc"] ?? 0));

  // Est. households: auto from nSettlements × beneficiaryMult, or manually overridden
  const hhDomain = domains.find(d => d.beneficiaryVar === "nSettlements");
  const hhPerSettlement = hhDomain?.beneficiaryMult ?? 150;
  const autoHH = Math.round((effectiveInp.nSettlements ?? 0) * hhPerSettlement);
  const estHH = hhOverride ?? autoHH;

  // Per-domain operational Y1 totals — keyed by domain key
  const domainOp = useMemo(() => {
    const byDomain: Record<string, number> = {};
    for (const d of ALL_DOMAINS) {
      byDomain[d] = opLines.filter(l => l.domain === d).reduce((s, l) => s + l.y1Total, 0);
    }
    byDomain["total"] = opLines.reduce((s, l) => s + l.y1Total, 0);
    return byDomain;
  }, [opLines, ALL_DOMAINS]);

  // Yours-side operational totals per domain — from the partner's saved
  // BudgetLine rows, filtered to operational sections, minus any orphan the
  // user excluded via the symmetric ✕, AND minus any standard templateKey the
  // user excluded on the Std side. Both exclusions apply symmetrically so the
  // per-beneficiary tiles compare like-for-like (matches opLines above).
  const domainOpYou = useMemo(() => {
    const m: Record<string, number> = {};
    if (!compareData) return m;
    for (const d of ALL_DOMAINS) m[d] = 0;
    m["total"] = 0;
    for (const l of compareData.lines) {
      if (EXCLUDED_FROM_PER_UNIT.has(l.section)) continue;
      if (excludedOrphanIds.has(l.id)) continue;
      if (l.templateKey && excludedTemplateKeys.has(l.templateKey)) continue;
      if (l.domain && m[l.domain] !== undefined) m[l.domain] += l.y1Total;
      m["total"] += l.y1Total;
    }
    return m;
  }, [compareData, ALL_DOMAINS, excludedOrphanIds, excludedTemplateKeys]);

  // Per-unit costs computed from domain configs (beneficiaryVar × beneficiaryMult).
  // When comparing, every tile carries a Yours value too so the Δ is visible
  // alongside the Standard reading.
  const perUnit = useMemo(() => {
    const result: { label: string; std: number | null; you: number | null; sub: string }[] = [];
    for (const d of domains) {
      if (!d.beneficiaryVar || !d.beneficiaryLabel) continue;
      const stdCount = Math.round((effectiveInp[d.beneficiaryVar] ?? 0) * d.beneficiaryMult);
      const stdTotal = domainOp[d.key] ?? 0;
      const youCount = compareData
        ? Math.round((compareData.programmeInputs[d.beneficiaryVar] ?? 0) * d.beneficiaryMult)
        : 0;
      const youTotal = compareData ? (domainOpYou[d.key] ?? 0) : 0;
      result.push({
        label: `Per ${d.beneficiaryLabel.toLowerCase()}`,
        std: stdCount > 0 ? Math.round(stdTotal / stdCount) : null,
        you: compareData && youCount > 0 ? Math.round(youTotal / youCount) : null,
        sub: `${stdCount.toLocaleString("en-IN")} ${d.beneficiaryLabel.toLowerCase()}`,
      });
    }
    // Per-cluster + per-HH derive from total op spend. Yours uses partner's own
    // cluster / settlement counts so the metric is internally consistent.
    const youClusters = compareData ? (compareData.programmeInputs.nClusters ?? 0) : 0;
    const youHH = compareData
      ? Math.round((compareData.programmeInputs.nSettlements ?? 0) * hhPerSettlement)
      : 0;
    result.push({
      label: "Per cluster",
      std: (effectiveInp.nClusters ?? 0) > 0 ? Math.round((domainOp["total"] ?? 0) / effectiveInp.nClusters!) : null,
      you: compareData && youClusters > 0 ? Math.round((domainOpYou["total"] ?? 0) / youClusters) : null,
      sub: `${effectiveInp.nClusters ?? 0} clusters`,
    });
    result.push({
      label: "Per HH",
      std: estHH > 0 ? Math.round((domainOp["total"] ?? 0) / estHH) : null,
      you: compareData && youHH > 0 ? Math.round((domainOpYou["total"] ?? 0) / youHH) : null,
      sub: `${estHH.toLocaleString("en-IN")} households`,
    });
    return result;
  }, [domainOp, domainOpYou, domains, effectiveInp, estHH, hhPerSettlement, compareData]);

  /** Partner line a Standard template can't anchor (manual addition or template
   *  no longer active). Surfaced as "your addition" rows in the per-domain table
   *  so the comparison doesn't silently roll them into the subtotal. */
  type OrphanLine = {
    id: string;
    templateKey: string | null;
    domain: string | null;
    section: BudgetSection;
    description: string;
    y1Total: number; y2Total: number; y3Total: number;
  };

  type DomainGroup = {
    domain: string | null;
    label: string;
    bySection: {
      section: BudgetSection;
      lines: AnalysisLine[];
      orphans: OrphanLine[];
      y1: number; y2: number; y3: number;
    }[];
    y1: number; y2: number; y3: number;
  };

  const grouped = useMemo<DomainGroup[]>(() => {
    const stdTemplateKeys = new Set(templates.filter(t => t.isActive).map(t => t.templateKey));
    const orphansByDomain = new Map<string | null, OrphanLine[]>();
    if (compareData) {
      for (const l of compareData.lines) {
        if (l.templateKey && stdTemplateKeys.has(l.templateKey)) continue;
        const arr = orphansByDomain.get(l.domain) ?? [];
        arr.push(l);
        orphansByDomain.set(l.domain, arr);
      }
    }

    const domainOrder = [...ALL_DOMAINS, null] as (string | null)[];
    return domainOrder.flatMap(domain => {
      // Domain chips at the top decide which per-domain tables render. Cross-cutting
      // (null) is always included so admin / travel / shared lines stay visible.
      if (domain !== null && !selectedDomains.has(domain)) return [];
      const allDomLines = indicativeLines.filter(l => l.domain === domain);
      const hasVariableLine = allDomLines.some(l => !FIXED_INPUT_VARS.has(l.inputVar) && l.y1Units > 0);
      const domOrphans = orphansByDomain.get(domain) ?? [];
      // Surface the domain if either side contributes — standard scenario or
      // partner orphan lines. Skipping when only standard is empty would
      // hide the partner's manual additions entirely.
      if (!hasVariableLine && domOrphans.length === 0) return [];
      const domLines = allDomLines.filter(l => l.y1Total > 0);
      if (!domLines.length && domOrphans.length === 0) return [];
      const sections = new Set<BudgetSection>([
        ...domLines.map(l => l.section),
        ...domOrphans.map(l => l.section),
      ]);
      const bySection = [...sections].map(s => {
        const sl = domLines.filter(l => l.section === s);
        const ol = domOrphans.filter(l => l.section === s);
        return {
          section: s, lines: sl, orphans: ol,
          y1: sl.reduce((acc, l) => acc + l.y1Total, 0),
          y2: sl.reduce((acc, l) => acc + l.y2Total, 0),
          y3: sl.reduce((acc, l) => acc + l.y3Total, 0),
        };
      });
      return [{
        domain,
        label: domain ? (domains.find(d => d.key === domain)?.label ?? domain) : "Cross-cutting + Admin",
        bySection,
        y1: domLines.reduce((acc, l) => acc + l.y1Total, 0),
        y2: domLines.reduce((acc, l) => acc + l.y2Total, 0),
        y3: domLines.reduce((acc, l) => acc + l.y3Total, 0),
      }];
    });
  }, [indicativeLines, selectedDomains, domains, ALL_DOMAINS, templates, compareData]);

  // Grand total derives from `grouped` (which already filters by selectedDomains
  // + drops domains with no variable-driven activity) so the bar reflects the
  // user's chip selection. Summing `indicativeLines` would sum across every
  // domain regardless of selection.
  const grand = useMemo(() => ({
    y1: grouped.reduce((s, g) => s + g.y1, 0),
    y2: grouped.reduce((s, g) => s + g.y2, 0),
    y3: grouped.reduce((s, g) => s + g.y3, 0),
  }), [grouped]);

  // Per-domain sum of excluded Std-Y1 totals — subtracted from the displayed
  // section / group / grand Standard totals to honour the user's like-for-like
  // scope. Y2/Y3 stay full because they only appear in non-compare mode where
  // exclusions are disabled.
  const excludedY1ByDomain = useMemo(() => {
    const m = new Map<string | null, number>();
    if (excludedTemplateKeys.size === 0) return m;
    for (const g of grouped) {
      let sum = 0;
      for (const sec of g.bySection) {
        for (const l of sec.lines) {
          if (excludedTemplateKeys.has(l.templateKey)) sum += l.y1Total;
        }
      }
      m.set(g.domain, sum);
    }
    return m;
  }, [grouped, excludedTemplateKeys]);

  const totalExcludedStdY1 = useMemo(
    () => [...excludedY1ByDomain.values()].reduce((s, v) => s + v, 0),
    [excludedY1ByDomain]
  );

  const hasIndicative = indicativeLines.some(l => l.isIndicative);

  // When the user narrows their selection, hide programme inputs that no
  // selected-domain template references. When all domains are picked (the
  // default landing state), behave like before — every input is visible.
  const allDomainsSelected = selectedDomains.size === domains.length;
  const isVisibleInputKey = (key: string) =>
    allDomainsSelected || inpKeysBySelectedDomain.has(key);

  // Fast template lookup by templateKey, used by the formula-breakdown
  // sub-row to render the cost-keys + their registry / override values.
  const templateByKey = useMemo(() => {
    const m = new Map<string, LineTemplate>();
    for (const t of templates) m.set(t.templateKey, t);
    return m;
  }, [templates]);

  /** Auto-exclude every standard line whose Yours counterpart is empty.
   *  Useful one-click "compare like-for-like" — keeps Std lines that are
   *  legitimately present on both sides, drops Std-only indicative entries. */
  const matchMyBudgetScope = () => {
    if (!compareData) return;
    const next = new Set<string>();
    for (const l of indicativeLines) {
      // Skip rows the standard generator also drops (units=0 / fixed-only with no
      // variable input) so we don't accumulate dead exclusions.
      if (l.y1Total === 0) continue;
      const you = youLineMap.get(l.templateKey);
      if (!you || you.y1Total === 0) next.add(l.templateKey);
    }
    setExcludedTemplateKeys(next);
  };

  /** Render a single formula component row inside the breakdown drawer. */
  const renderBreakdownComponent = (label: string, key: string) => {
    const std = registry[key] ?? 0;
    const you = compareData?.costOverrides[key];
    const isOverride = you !== undefined && you !== std;
    return (
      <div key={key} className="flex items-center justify-between text-xs py-0.5">
        <span className="text-stone-500">
          {label} <span className="font-mono text-xs sm:text-[10px] text-stone-300 ml-1">{key}</span>
        </span>
        <span className="tabular-nums">
          <span className={isOverride ? "text-stone-400 line-through mr-2" : "text-stone-700 font-medium"}>
            {std.toLocaleString("en-IN")}
          </span>
          {isOverride && (
            <span className="text-sky-700 font-medium">
              {you!.toLocaleString("en-IN")}
            </span>
          )}
        </span>
      </div>
    );
  };

  /** Compact delta badge shown beside Yours value. Green when lower, red when higher. */
  const renderDelta = (std: number, you: number | undefined) => {
    if (you === undefined || std <= 0 || you === std) return null;
    const pct = ((you - std) / std) * 100;
    const cls = pct < 0 ? "text-emerald-600" : "text-red-500";
    const sym = pct > 0 ? "▲" : "▼";
    return <span className={`text-xs sm:text-[10px] ${cls} ml-1 tabular-nums`}>{sym}{Math.abs(pct).toFixed(0)}%</span>;
  };

  return (
    <>
      {/* Filter & Compare bar — domain chips drive what cascades below; compare
          dropdown overlays a real partner budget for benchmarking. */}
      <div className="mb-4 p-3 sm:p-4 bg-white border border-stone-200 rounded-xl space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
            What do you want to cost?
          </p>
          {compareData && (
            <span className="text-xs text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-full font-medium truncate max-w-full">
              comparing vs {compareData.name}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {domains.map(d => {
            const active = selectedDomains.has(d.key);
            return (
              <button key={d.key} onClick={() => toggleDomainFilter(d.key)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${active ? "bg-sky-600 text-white border-sky-600" : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}>
                {active && <span className="mr-1">✓</span>}{d.label}
              </button>
            );
          })}
          {selectedDomains.size > 0 && (
            <button onClick={() => setSelectedDomains(new Set())}
              className="text-xs px-2 py-1 text-stone-400 hover:text-stone-700">Clear</button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-stone-500">Compare with budget:</label>
          <select value={compareBudgetId} onChange={e => onCompareChange(e.target.value)}
            disabled={comparePending}
            className="w-full sm:w-auto text-xs border border-stone-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white max-w-full sm:max-w-xs">
            <option value="">— Standard only —</option>
            {cityBudgets.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {comparePending && <span className="text-xs text-stone-400">loading…</span>}
          {compareData && (
            <button onClick={() => onCompareChange("")}
              className="text-xs text-stone-400 hover:text-stone-700">✕ clear</button>
          )}
          {compareData && (
            <button onClick={exportComparison} disabled={exporting}
              className="text-xs border border-emerald-200 text-emerald-700 bg-emerald-50 rounded px-2 py-1 hover:bg-emerald-100 disabled:opacity-60">
              {exporting ? "Exporting…" : "↓ Export comparison (xlsx)"}
            </button>
          )}
        </div>
        {/* Like-for-like controls only appear when a budget is loaded. The
            "Match my budget" shortcut auto-excludes every standard line where
            Yours is zero / missing — useful for stripping indicative-only Std
            entries (e.g. unfilled salary stubs) from the comparison. */}
        {compareData && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-100">
            <span className="text-xs text-stone-500">Standard scope:</span>
            <button onClick={matchMyBudgetScope}
              className="text-xs border border-sky-200 text-sky-700 bg-sky-50 rounded px-2 py-1 hover:bg-sky-100">
              Match my budget
            </button>
            {totalExclusions > 0 && (
              <>
                <span className="text-xs text-stone-500">
                  <span className="font-medium text-amber-700">{totalExclusions}</span> line{totalExclusions === 1 ? "" : "s"} excluded
                  {excludedOrphanIds.size > 0 && excludedTemplateKeys.size > 0 && (
                    <span className="text-stone-400 ml-1">({excludedTemplateKeys.size} Std · {excludedOrphanIds.size} Yours)</span>
                  )}
                </span>
                <button onClick={showAllStandard}
                  className="text-xs text-stone-400 hover:text-stone-700">Show all</button>
              </>
            )}
            <span className="text-[10px] text-stone-400 ml-1">Session only · cost registry untouched</span>
          </div>
        )}
      </div>

      {/* Programme size assumptions — fully driven by displayGroup on each inp.* item */}
      <div className="mb-4 p-3 sm:p-4 bg-white border border-stone-200 rounded-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Programme size assumptions</p>
          {scenarioLabel && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium">{scenarioLabel}</span>
              <button onClick={handleReset} className="text-xs text-stone-400 hover:text-stone-700">Reset</button>
            </div>
          )}
        </div>

        {/* Scenario picker — collapsed by default; opens into the city/zone/cluster/settlement cascade. */}
        <details className="group rounded-lg border border-stone-200 bg-stone-50">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-stone-500 uppercase tracking-widest flex flex-wrap items-center justify-between gap-y-1">
            <span>Load from geography</span>
            <span className="text-stone-400 group-open:hidden text-[10px] font-normal normal-case">click to load need / addressable / plan / gap from a zone, cluster, or settlement</span>
          </summary>
        <div className="p-3 space-y-2 border-t border-stone-200">
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">Load from geography</p>
          {/* Level selector */}
          <div className="flex gap-1 flex-wrap">
            {(["city", "zone", "cluster", "settlement"] as GeoLevel[]).map(lvl => (
              <button key={lvl} onClick={() => handleLevelChange(lvl)}
                className={`text-xs px-2.5 py-1 rounded-md capitalize transition-colors ${geoLevel === lvl ? "bg-stone-800 text-white" : "bg-white border border-stone-200 text-stone-600 hover:border-stone-400"}`}>
                {lvl}
              </button>
            ))}
          </div>
          {/* Cascading area selectors */}
          <div className="flex flex-wrap gap-2 items-center">
            {geoLevel === "city" && (
              <span className="text-xs border border-stone-200 rounded px-2 py-1 bg-stone-100 text-stone-500">{city}</span>
            )}
            {geoLevel !== "city" && (
              <select value={geoZoneId} onChange={e => handleZoneChange(e.target.value)}
                disabled={cascadePending}
                className="w-full sm:w-auto text-xs border border-stone-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white">
                <option value="">— Zone —</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            )}
            {(geoLevel === "cluster" || geoLevel === "settlement") && (
              <select value={geoClusterId} onChange={e => handleClusterChange(e.target.value)}
                disabled={cascadePending || !geoZoneId}
                className="w-full sm:w-auto text-xs border border-stone-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white disabled:opacity-50">
                <option value="">— Cluster —</option>
                {clusterOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {geoLevel === "settlement" && (
              <select value={geoSettlementId} onChange={e => setGeoSettlementId(e.target.value)}
                disabled={cascadePending || !geoClusterId}
                className="w-full sm:w-auto text-xs border border-stone-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white disabled:opacity-50">
                <option value="">— Settlement —</option>
                {settlementOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <select value={scenarioMetric} onChange={e => setScenarioMetric(e.target.value as ScenarioMetric)}
              className="w-full sm:w-auto text-xs border border-stone-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white">
              {(Object.entries(METRIC_LABELS) as [ScenarioMetric, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <button onClick={handleLoad} disabled={!canLoad || loadPending}
              className="text-xs bg-sky-600 text-white px-3 py-1 rounded-md hover:bg-sky-700 disabled:opacity-50 transition-colors">
              {loadPending ? "Loading…" : "Load"}
            </button>
          </div>
          <p className="text-xs sm:text-[10px] text-stone-400">
            Only inputs linked to a needs domain via Cost Registry will be populated. Geography counts (settlements, clusters) are always updated.
          </p>
        </div>
        </details>

        {/* 1. Geography & Scale */}
        {progByGroup.geography.some(g => isVisibleInputKey(g.key)) && (
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-2">Geography & Scale</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {progByGroup.geography.filter(g => isVisibleInputKey(g.key)).map(({ key, label }) => (
                <Fragment key={key}>
                  <label className="block">
                    <span className="text-xs text-stone-500">{label}</span>
                    {inpField(key)}
                  </label>
                  {/* Est. HH — editable override, auto-computed from nSettlements × hhPerSettlement */}
                  {key === "nSettlements" && (
                    <div className="block">
                      <span className="text-xs text-stone-500">Est. households</span>
                      <div className="flex items-center gap-1">
                        <input type="number" min={0} value={estHH}
                          onChange={e => setHhOverride(isNaN(parseFloat(e.target.value)) ? null : parseFloat(e.target.value))}
                          className={INP_CLS} />
                        {hhOverride !== null && (
                          <button onClick={() => setHhOverride(null)} className="text-stone-300 hover:text-stone-600 text-xs shrink-0" title="Reset to auto">↺</button>
                        )}
                      </div>
                      <p className="text-xs text-stone-300 mt-0.5">
                        {hhOverride !== null ? `auto: ${autoHH.toLocaleString("en-IN")}` : `× ${hhPerSettlement} HH/settlement`}
                      </p>
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {progByGroup.facilities.some(g => isVisibleInputKey(g.key)) && <div className="border-t border-stone-100" />}

        {/* 2. Facilities — auto-paired: sorted list has count then rent for each type */}
        {progByGroup.facilities.some(g => isVisibleInputKey(g.key)) && (
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-2">Facilities</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {(() => {
                type FItem = { key: string; label: string };
                const isRent = (k: string) => k.toLowerCase().includes("rent");
                const strip = (s: string) =>
                  s.replace(/^Typical\s+/i, "").replace(/^No\.?\s*of\s+/i, "").replace(/\s*rent.*$/i, "").trim();
                const items = progByGroup.facilities.filter(g => isVisibleInputKey(g.key));
                const pairs: { heading: string; count?: FItem; rent?: FItem }[] = [];
                let i = 0;
                while (i < items.length) {
                  const cur = items[i], nxt = items[i + 1];
                  if (!isRent(cur.key) && nxt && isRent(nxt.key)) {
                    pairs.push({ heading: strip(cur.label), count: cur, rent: nxt }); i += 2;
                  } else if (isRent(cur.key)) {
                    pairs.push({ heading: strip(cur.label), rent: cur }); i += 1;
                  } else {
                    pairs.push({ heading: strip(cur.label), count: cur }); i += 1;
                  }
                }
                return pairs.map(({ heading, count, rent }, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <p className="text-xs font-medium text-stone-500">{heading}</p>
                    {count && (
                      <label className="block">
                        <span className="text-[11px] text-stone-400">Count</span>
                        {inpField(count.key)}
                      </label>
                    )}
                    {rent && (
                      <label className="block">
                        <span className="text-[11px] text-stone-400">Rent / mo (₹)</span>
                        {inpField(rent.key)}
                      </label>
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        <div className="border-t border-stone-100" />

        {/* 3. Coverage & Beneficiaries */}
        <div>
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-2">Coverage & Beneficiaries</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Children: always derived. Only shown when a selected-domain template wires through nCLCs. */}
            {(allDomainsSelected || inpKeysBySelectedDomain.has("nCLCs")) && (
              <div className="block">
                <span className="text-xs text-stone-500">Children</span>
                <div className={DERIVED_CLS}>
                  {totalChildren > 0 ? totalChildren.toLocaleString("en-IN") : <span className="italic text-stone-300">set children_per_clc</span>}
                </div>
                <p className="text-xs text-stone-300 mt-0.5">nCLCs × children_per_clc</p>
              </div>
            )}
            {/* Beneficiary counts derived from domain config (beneficiaryVar × beneficiaryMult).
                Restricted to selected domains so the row matches the user's filter. */}
            {domains.filter(d => d.beneficiaryVar && d.beneficiaryLabel && d.beneficiaryVar !== "nSettlements")
                    .filter(d => allDomainsSelected || selectedDomains.has(d.key)).map(d => {
              const count = Math.round((effectiveInp[d.beneficiaryVar!] ?? 0) * d.beneficiaryMult);
              return (
                <div key={d.key} className="block">
                  <span className="text-xs text-stone-500">{d.beneficiaryLabel}</span>
                  <div className={DERIVED_CLS}>{count > 0 ? count.toLocaleString("en-IN") : "—"}</div>
                  <p className="text-xs text-stone-300 mt-0.5">{d.beneficiaryVar} × {d.beneficiaryMult}</p>
                </div>
              );
            })}
            {/* All inp.* items tagged as coverage — includes nElderly, nElderlyTotal, kitchens, etc. */}
            {progByGroup.coverage.filter(g => isVisibleInputKey(g.key)).map(({ key, label }) => (
              <label key={key} className="block">
                <span className="text-xs text-stone-500">{label}</span>
                {inpField(key)}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Per-unit summary */}
      <div className="mb-6 p-3 sm:p-4 bg-sky-950 rounded-xl">
        <p className="text-xs font-semibold text-sky-300 uppercase tracking-wide mb-3">
          Cost per beneficiary / year — operational spend only
          <span className="ml-2 normal-case font-normal text-sky-500">(excludes capex, admin salaries, admin other)</span>
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {perUnit.map(({ label, std, you, sub }) => (
            <div key={label} className="bg-sky-900/50 rounded-lg p-3">
              <p className="text-xs text-sky-400">{label}</p>
              <p className="text-lg font-bold text-white mt-1">
                {std != null ? fmtCost(std) : <span className="text-sky-600 text-sm">—</span>}
              </p>
              {compareData && (
                <p className="text-xs text-sky-300 mt-0.5 tabular-nums">
                  Yours {you != null ? fmtCost(you) : "—"}
                  {std != null && you != null && std > 0 && you !== std && (() => {
                    const pct = ((you - std) / std) * 100;
                    const cls = pct < 0 ? "text-emerald-400" : "text-red-400";
                    const sym = pct > 0 ? "▲" : "▼";
                    return <span className={`ml-1 ${cls}`}>{sym}{Math.abs(pct).toFixed(0)}%</span>;
                  })()}
                </p>
              )}
              <p className="text-xs text-sky-600 mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
        {hasIndicative && (
          <p className="text-xs text-sky-600 mt-3">
            ~ Salary lines use indicative averages from salary hints. Actual costs depend on hiring.
          </p>
        )}
      </div>

      {/* Per-domain tables. When comparing, Y2/Y3 columns get replaced by
          Yours-Y1 + Δ so the table stays the same width. Click any row caret
          to expand a formula-breakdown sub-row pulled from the LineTemplate. */}
      <div className="space-y-6">
        {grouped.map(g => {
          // Per-domain Yours-Y1 sums the partner's saved lines for that domain,
          // dropping any orphan the user excluded via the symmetric ✕. Matched
          // lines (templateKey ∈ std set) stay since the Std side handles
          // its own exclusions independently.
          const youGroupY1 = compareData
            ? compareData.lines
                .filter(l => l.domain === g.domain && !excludedOrphanIds.has(l.id))
                .reduce((s, l) => s + l.y1Total, 0)
            : 0;
          // Std-side excluded contribution for this domain. Subtracted from
          // the visible group-Y1 + Δ-vs-Yours so the comparison reflects the
          // scope the user trimmed to.
          const excludedHere = excludedY1ByDomain.get(g.domain) ?? 0;
          const effectiveGroupY1 = g.y1 - excludedHere;
          // colSpan for sub-rows + footers stays at 7 regardless of compare mode.
          const cols = 7;
          return (
          <div key={g.domain ?? "cross"}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
              <h3 className="text-sm font-semibold text-stone-700">{g.label}</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-400">
                <span>Y1 <span className="font-medium text-stone-600">{fmtCost(effectiveGroupY1)}</span>
                  {excludedHere > 0 && <span className="ml-1 text-xs sm:text-[10px] text-amber-600">(−{fmtCost(excludedHere)} excluded)</span>}
                </span>
                {!compareData && <span>Y2 <span className="font-medium text-stone-600">{fmtCost(g.y2)}</span></span>}
                {!compareData && <span>Y3 <span className="font-medium text-stone-600">{fmtCost(g.y3)}</span></span>}
                {compareData && <>
                  <span>Yours <span className="font-medium text-sky-700">{fmtCost(youGroupY1)}</span>{renderDelta(effectiveGroupY1, youGroupY1)}</span>
                </>}
              </div>
            </div>
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50 text-xs text-stone-500">
                    <th className="text-left px-4 py-2 font-medium">Description</th>
                    <th className="text-left px-3 py-2 font-medium w-24">Section</th>
                    <th className="text-right px-3 py-2 font-medium w-28">Unit cost Y1</th>
                    <th className="text-right px-3 py-2 font-medium w-20">Units</th>
                    <th className="text-right px-3 py-2 font-medium w-28">Total Y1</th>
                    {compareData ? <>
                      <th className="text-right px-3 py-2 font-medium w-28 text-sky-700">Yours Y1</th>
                      <th className="text-right px-3 py-2 font-medium w-16">Δ</th>
                    </> : <>
                      <th className="text-right px-3 py-2 font-medium w-28">Total Y2</th>
                      <th className="text-right px-3 py-2 font-medium w-28">Total Y3</th>
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {g.bySection.map(({ section, lines: sLines, orphans, y1: sy1, y2: sy2, y3: sy3 }) => (
                    <Fragment key={section}>
                      <tr className="border-b border-stone-50">
                        <td colSpan={cols} className="px-4 pt-3 pb-1 text-xs font-semibold text-stone-400 uppercase tracking-wide bg-stone-50/50">
                          {section}
                        </td>
                      </tr>
                      {sLines.map((l, i) => {
                        const lineKey = `${g.domain ?? "cross"}:${l.position}`;
                        const expanded = expandedLines.has(lineKey);
                        const t = templateByKey.get(l.templateKey);
                        const youLine = compareData ? youLineMap.get(l.templateKey) : undefined;
                        const youY1 = youLine?.y1Total;
                        const excluded = excludedTemplateKeys.has(l.templateKey);
                        const components: { label: string; key: string }[] = [];
                        if (t?.costKey)  components.push({ label: "× ", key: t.costKey });
                        if (t?.costKey2) components.push({ label: "× ", key: t.costKey2 });
                        if (t?.costKey3) components.push({ label: "× ", key: t.costKey3 });
                        if (t?.supervisorRatioKey) components.push({ label: "supervisor ratio", key: t.supervisorRatioKey });
                        if (t?.workerRatioKey)    components.push({ label: "worker ratio", key: t.workerRatioKey });
                        if (t?.bufferKey)         components.push({ label: "buffer %", key: t.bufferKey });
                        const canExpand = components.length > 0;
                        // Std side of an excluded row: strikethrough greys.
                        // Δ vs Yours treats the excluded Std as 0 so the delta
                        // becomes "added 100%" for any Yours-only contribution,
                        // which is the intended like-for-like read.
                        const stdMutedCls = excluded ? "line-through text-stone-300" : "";
                        return (
                          <Fragment key={i}>
                          <tr className={`group border-b border-stone-50 hover:bg-stone-50 ${l.isIndicative ? "bg-amber-50/30" : ""} ${excluded ? "bg-stone-50/60" : ""}`}>
                            <td className="px-4 py-2 text-stone-800">
                              <button onClick={() => canExpand && toggleLineExpand(lineKey)}
                                disabled={!canExpand}
                                className={`mr-1 inline-block w-3 text-xs sm:text-[10px] ${canExpand ? "text-stone-400 hover:text-stone-700" : "text-stone-200 cursor-default"}`}
                                title={canExpand ? "Show formula" : "No formula breakdown"}>
                                {canExpand ? (expanded ? "▾" : "▸") : "·"}
                              </button>
                              <span className={excluded ? "text-stone-400" : ""}>{l.description}</span>
                              {l.isIndicative && !excluded && <span className="ml-2 text-xs text-amber-500">~indicative · {l.salaryHint}</span>}
                              {excluded && <span className="ml-2 text-[10px] uppercase tracking-widest text-stone-400">excluded</span>}
                              {compareData && (
                                excluded
                                  ? <button onClick={() => toggleExcludeLine(l.templateKey)}
                                      className="ml-2 text-xs text-sky-600 hover:text-sky-800">↺ restore</button>
                                  : <button onClick={() => toggleExcludeLine(l.templateKey)}
                                      className="ml-2 text-xs text-stone-300 hover:text-stone-700 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity"
                                      title="Drop this line from the Standard scope">✕ exclude</button>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SECTION_BADGE[l.section] ?? "bg-stone-50 text-stone-600"} ${excluded ? "opacity-50" : ""}`}>
                                {l.section}
                              </span>
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums ${stdMutedCls} ${l.isIndicative && !excluded ? "text-amber-600" : "text-stone-600"}`}>
                              {l.isIndicative ? `~${fmtCost(l.y1UnitCost)}/mo` : fmtCost(l.y1UnitCost)}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums ${stdMutedCls} text-stone-500`}>{fmt(l.y1Units)}</td>
                            <td className={`px-3 py-2 text-right font-medium tabular-nums ${stdMutedCls} ${excluded ? "" : "text-stone-800"}`}>{fmtCost(l.y1Total)}</td>
                            {compareData ? <>
                              <td className="px-3 py-2 text-right text-sky-700 font-medium tabular-nums">
                                {youY1 !== undefined ? fmtCost(youY1) : "—"}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{renderDelta(excluded ? 0 : l.y1Total, youY1)}</td>
                            </> : <>
                              <td className={`px-3 py-2 text-right tabular-nums ${stdMutedCls} text-stone-500`}>{fmtCost(l.y2Total)}</td>
                              <td className={`px-3 py-2 text-right tabular-nums ${stdMutedCls} text-stone-500`}>{fmtCost(l.y3Total)}</td>
                            </>}
                          </tr>
                          {expanded && t && (
                            <tr className="border-b border-stone-100 bg-sky-50/40">
                              <td colSpan={cols} className="px-8 py-3">
                                <div className="text-[10px] uppercase tracking-widest text-stone-400 mb-1">Formula</div>
                                <div className="font-mono text-xs text-stone-500 mb-2">{formulaSummary(t)}</div>
                                {components.length > 0 && (
                                  <div className="space-y-0.5 mt-1 max-w-md">
                                    {components.map(c => renderBreakdownComponent(c.label, c.key))}
                                    {t.userInputCost && (
                                      <div className="text-xs text-stone-500 py-0.5">
                                        Uses user input <span className="font-mono">{t.userInputCost}</span> (e.g. monthly rent)
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                      {/* Yours-only rows: partner lines no Standard template anchors —
                          either manual additions or templates that have since been
                          deactivated. Standard column shows "—"; Yours column carries
                          the partner's saved total. Rolled into the section subtotal. */}
                      {compareData && orphans.map((o, oi) => {
                        const oExcluded = excludedOrphanIds.has(o.id);
                        const yMutedCls = oExcluded ? "line-through text-stone-300" : "text-sky-700";
                        return (
                        <tr key={`orphan-${o.id}-${oi}`} className={`group border-b border-stone-50 hover:bg-sky-50/40 ${oExcluded ? "bg-stone-50/60" : "bg-sky-50/20"}`}>
                          <td className="px-4 py-2 text-stone-700">
                            <span className="mr-1 inline-block w-3 text-xs sm:text-[10px] text-stone-200" title="No standard template">·</span>
                            <span className={oExcluded ? "text-stone-400" : ""}>{o.description}</span>
                            {oExcluded
                              ? <span className="ml-2 text-[10px] uppercase tracking-widest text-stone-400">excluded</span>
                              : <span className="ml-2 text-[10px] uppercase tracking-widest text-sky-600">your addition</span>}
                            {oExcluded
                              ? <button onClick={() => toggleExcludeOrphan(o.id)}
                                  className="ml-2 text-xs text-sky-600 hover:text-sky-800">↺ restore</button>
                              : <button onClick={() => toggleExcludeOrphan(o.id)}
                                  className="ml-2 text-xs text-stone-300 hover:text-stone-700 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity"
                                  title="Drop this line from the Yours scope">✕ exclude</button>}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SECTION_BADGE[o.section] ?? "bg-stone-50 text-stone-600"} ${oExcluded ? "opacity-50" : ""}`}>
                              {o.section}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-stone-300 tabular-nums">—</td>
                          <td className="px-3 py-2 text-right text-stone-300 tabular-nums">—</td>
                          <td className="px-3 py-2 text-right text-stone-300 tabular-nums">—</td>
                          <td className={`px-3 py-2 text-right font-medium tabular-nums ${yMutedCls}`}>{fmtCost(o.y1Total)}</td>
                          <td className={`px-3 py-2 text-right text-xs sm:text-[10px] tabular-nums ${oExcluded ? "text-stone-300" : "text-sky-600"}`}>{oExcluded ? "" : "new"}</td>
                        </tr>
                        );
                      })}
                      {(() => {
                        // Orphan Yours contribution drops any orphan the user
                        // excluded — same like-for-like reasoning as Std side.
                        const oSumY1 = orphans.reduce(
                          (s, o) => excludedOrphanIds.has(o.id) ? s : s + o.y1Total, 0
                        );
                        // Excluded Std-Y1 within this section. Subtracted from
                        // the visible Standard subtotal so the row reads
                        // "what counts toward the comparison".
                        const sectionExcluded = sLines.reduce(
                          (s, l) => excludedTemplateKeys.has(l.templateKey) ? s + l.y1Total : s, 0
                        );
                        const sectionStdY1 = sy1 - sectionExcluded;
                        return (
                        <tr className="border-b border-stone-100 bg-stone-50/70">
                          <td colSpan={4} className="px-4 py-1.5 text-xs text-stone-400 text-right italic">{section} subtotal</td>
                          <td className="px-3 py-1.5 text-right text-xs font-semibold text-stone-700 tabular-nums">{fmtCost(sectionStdY1)}</td>
                          {compareData ? <>
                            {(() => {
                              const sYou = sLines.reduce((s, l) => s + (youLineMap.get(l.templateKey)?.y1Total ?? 0), 0) + oSumY1;
                              return <>
                                <td className="px-3 py-1.5 text-right text-xs font-medium text-sky-700 tabular-nums">{fmtCost(sYou)}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums">{renderDelta(sectionStdY1, sYou)}</td>
                              </>;
                            })()}
                          </> : <>
                            <td className="px-3 py-1.5 text-right text-xs font-medium text-stone-500 tabular-nums">{fmtCost(sy2)}</td>
                            <td className="px-3 py-1.5 text-right text-xs font-medium text-stone-500 tabular-nums">{fmtCost(sy3)}</td>
                          </>}
                        </tr>
                        );
                      })()}
                    </Fragment>
                  ))}
                  <tr className="bg-stone-100">
                    <td colSpan={4} className="px-4 py-2 text-xs font-bold text-stone-600 text-right">{g.label} total</td>
                    <td className="px-3 py-2 text-right text-sm font-bold text-stone-900 tabular-nums">{fmtCost(effectiveGroupY1)}</td>
                    {compareData ? <>
                      <td className="px-3 py-2 text-right text-sm font-bold text-sky-700 tabular-nums">{fmtCost(youGroupY1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{renderDelta(effectiveGroupY1, youGroupY1)}</td>
                    </> : <>
                      <td className="px-3 py-2 text-right text-sm font-semibold text-stone-600 tabular-nums">{fmtCost(g.y2)}</td>
                      <td className="px-3 py-2 text-right text-sm font-semibold text-stone-600 tabular-nums">{fmtCost(g.y3)}</td>
                    </>}
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
          </div>
        );
        })}
      </div>

      {/* Grand total. Yours-Y1 surfaces when comparing; Y2/Y3 stay visible
          so the standard-mode reading isn't lost. */}
      {grouped.length > 0 && (
        <div className="mt-6 p-4 bg-stone-900 text-white rounded-xl flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
          <div>
            <p className="text-sm font-semibold">
              Grand Total — {selectedDomains.size === 0 || allDomainsSelected ? "all domains" : `${selectedDomains.size} selected`}
            </p>
            <p className="text-xs text-stone-400 mt-0.5">
              {hasIndicative ? "Includes indicative salary estimates (marked ~)" : "Salary stubs not filled — add salary hints to templates for indicative totals"}
            </p>
          </div>
          <div className="flex gap-6 sm:gap-8">
            <div>
              <p className="text-xs text-stone-400">Year 1</p>
              <p className="text-lg font-bold">{fmtCost(grand.y1 - totalExcludedStdY1)}</p>
              {totalExcludedStdY1 > 0 && (
                <p className="text-xs sm:text-[10px] text-amber-300">−{fmtCost(totalExcludedStdY1)} excluded</p>
              )}
            </div>
            {compareData && (() => {
              // Sum Yours across the same domains the per-domain tables render
              // (i.e. selectedDomains + cross-cutting). Pulled from the
              // partner's saved BudgetLine rows; manual additions (no
              // templateKey) are included via domain filter.
              const visibleDomains = new Set<string | null>(grouped.map(g => g.domain));
              const youGrand = compareData.lines
                .filter(l => visibleDomains.has(l.domain) && !excludedOrphanIds.has(l.id))
                .reduce((s, l) => s + l.y1Total, 0);
              const stdY1 = grand.y1 - totalExcludedStdY1;
              return (
                <div>
                  <p className="text-xs text-sky-300">Yours Y1</p>
                  <p className="text-lg font-bold text-sky-200">{fmtCost(youGrand)}{renderDelta(stdY1, youGrand)}</p>
                </div>
              );
            })()}
            <div><p className="text-xs text-stone-400">Year 2</p><p className="text-lg font-semibold text-stone-300">{fmtCost(grand.y2)}</p></div>
            <div><p className="text-xs text-stone-400">Year 3</p><p className="text-lg font-semibold text-stone-300">{fmtCost(grand.y3)}</p></div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Domains tab ──────────────────────────────────────────────────────────────

function DomainsTab({ domains, city, progInputKeys }: { domains: BudgetDomainConfig[]; city: string; progInputKeys: string[] }) {
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editForm, setEditForm] = useState<Partial<DomainConfigFields>>({});
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newBenefLabel, setNewBenefLabel] = useState("");
  const [newBenefVar, setNewBenefVar] = useState("");
  const [newBenefMult, setNewBenefMult] = useState("1");

  const handleSeed = () => startTransition(() => seedDomains(city));

  const handleToggle = (id: string, current: boolean) =>
    startTransition(() => toggleDomain(id, !current));

  const startEdit = (d: BudgetDomainConfig) => {
    setEditingId(d.id);
    setEditForm({
      label: d.label,
      description: d.description,
      beneficiaryLabel: d.beneficiaryLabel,
      beneficiaryVar: d.beneficiaryVar,
      beneficiaryMult: d.beneficiaryMult,
    });
  };

  const saveEdit = (id: string) => {
    startTransition(async () => {
      await updateDomain(id, editForm);
      setEditingId(null);
    });
  };

  const handleAdd = () => {
    const key = newKey.trim();
    if (!key || !newLabel.trim()) return;
    startTransition(async () => {
      await addDomain(city, key, {
        label: newLabel.trim(),
        description: newDesc || null,
        beneficiaryLabel: newBenefLabel || null,
        beneficiaryVar: newBenefVar || null,
        beneficiaryMult: parseFloat(newBenefMult) || 1,
      });
      setAdding(false);
      setNewKey(""); setNewLabel(""); setNewDesc(""); setNewBenefLabel(""); setNewBenefVar(""); setNewBenefMult("1");
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-y-2 mb-4">
        <p className="text-sm text-stone-500">
          Programme domains available when creating a budget. Changes apply immediately to new budgets.
        </p>
        <button onClick={handleSeed} disabled={pending}
          className={`text-sm px-3 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-50 ${domains.length === 0 ? "bg-sky-600 text-white hover:bg-sky-700" : "border border-stone-200 text-stone-500 hover:bg-stone-50"}`}>
          {pending ? "Seeding…" : domains.length === 0 ? "Seed standard domains" : "Re-seed defaults"}
        </button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        {domains.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-stone-400">No domains configured yet.</p>
            <p className="text-xs text-stone-300 mt-1">Click "Seed standard domains" to add Children, Youth, Elderly, Welfare Rights, Creche.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-xs text-stone-500">
                <th className="text-left px-4 py-2.5 font-medium">Key</th>
                <th className="text-left px-3 py-2.5 font-medium">Label</th>
                <th className="text-left px-3 py-2.5 font-medium">Description</th>
                <th className="text-left px-3 py-2.5 font-medium">Beneficiary formula</th>
                <th className="w-28 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {domains.map(d => (
                <Fragment key={d.id}>
                  <tr className={`border-b border-stone-50 group ${!d.isActive ? "opacity-40" : ""}`}>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-stone-600 text-xs bg-stone-100 px-1.5 py-0.5 rounded">{d.key}</span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-stone-800">{d.label}</td>
                    <td className="px-3 py-2.5 text-stone-500 text-xs">{d.description ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-stone-400 font-mono">
                      {d.beneficiaryVar ? `${d.beneficiaryVar} × ${d.beneficiaryMult}` : "—"}
                      {d.beneficiaryLabel && <span className="ml-1 text-stone-300">({d.beneficiaryLabel})</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(d)} className="text-xs text-sky-600 hover:text-sky-800">Edit</button>
                        <button onClick={() => handleToggle(d.id, d.isActive)}
                          className="text-xs text-stone-400 hover:text-stone-700">
                          {d.isActive ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingId === d.id && (
                    <tr>
                      <td colSpan={5} className="px-4 py-3 bg-sky-50 border-b border-sky-100">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label>
                            <span className="text-xs font-medium text-stone-600">Label</span>
                            <input value={editForm.label ?? ""} onChange={e => setEditForm(p => ({ ...p, label: e.target.value }))}
                              className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500" />
                          </label>
                          <label>
                            <span className="text-xs font-medium text-stone-600">Description</span>
                            <input value={editForm.description ?? ""} onChange={e => setEditForm(p => ({ ...p, description: e.target.value || null }))}
                              className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
                          </label>
                          <label>
                            <span className="text-xs font-medium text-stone-600">Beneficiary label (e.g. "Children")</span>
                            <input value={editForm.beneficiaryLabel ?? ""} onChange={e => setEditForm(p => ({ ...p, beneficiaryLabel: e.target.value || null }))}
                              className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
                          </label>
                          <label>
                            <span className="text-xs font-medium text-stone-600">Beneficiary variable</span>
                            <input list="benef-var-list" value={editForm.beneficiaryVar ?? ""}
                              onChange={e => setEditForm(p => ({ ...p, beneficiaryVar: e.target.value || null }))}
                              placeholder="e.g. nHealthWorkers (new or existing)"
                              className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-500" />
                          </label>
                          <label>
                            <span className="text-xs font-medium text-stone-600">Multiplier (var × this = beneficiary count)</span>
                            <input type="number" value={editForm.beneficiaryMult ?? 1} onChange={e => setEditForm(p => ({ ...p, beneficiaryMult: parseFloat(e.target.value) || 1 }))}
                              className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
                          </label>
                        </div>
                        <div className="flex gap-2 justify-end mt-3">
                          <button onClick={() => setEditingId(null)} className="text-sm text-stone-500 hover:text-stone-800 px-3 py-1.5">Cancel</button>
                          <button onClick={() => saveEdit(d.id)} disabled={pending}
                            className="text-sm bg-sky-600 text-white px-4 py-1.5 rounded-lg hover:bg-sky-700 disabled:opacity-50">
                            {pending ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Add new domain */}
      <div className="mt-3">
        {adding ? (
          <div className="p-4 bg-white border border-stone-200 rounded-xl space-y-3">
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">New domain</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label>
                <span className="text-xs font-medium text-stone-600">Key (used in DB — no spaces)</span>
                <input value={newKey} onChange={e => setNewKey(e.target.value.replace(/\s/g, ""))}
                  placeholder="e.g. Health"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-500" />
              </label>
              <label>
                <span className="text-xs font-medium text-stone-600">Display label</span>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  placeholder="e.g. Health & Nutrition"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500" />
              </label>
              <label className="sm:col-span-2">
                <span className="text-xs font-medium text-stone-600">Description (shown in budget creation form)</span>
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                  placeholder="e.g. Health camps, nutrition surveys"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
              <label>
                <span className="text-xs font-medium text-stone-600">Beneficiary label</span>
                <input value={newBenefLabel} onChange={e => setNewBenefLabel(e.target.value)}
                  placeholder="e.g. Beneficiaries"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
              <label>
                <span className="text-xs font-medium text-stone-600">Beneficiary variable</span>
                <input list="benef-var-list" value={newBenefVar} onChange={e => setNewBenefVar(e.target.value)}
                  placeholder="e.g. nHealthWorkers (new or existing)"
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-500" />
              </label>
              <label>
                <span className="text-xs font-medium text-stone-600">Multiplier</span>
                <input type="number" value={newBenefMult} onChange={e => setNewBenefMult(e.target.value)}
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm focus:outline-none" />
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setAdding(false)} className="text-sm text-stone-500 hover:text-stone-800 px-3 py-1.5">Cancel</button>
              <button onClick={handleAdd} disabled={pending || !newKey.trim() || !newLabel.trim()}
                className="text-sm bg-sky-600 text-white px-4 py-1.5 rounded-lg hover:bg-sky-700 disabled:opacity-50">
                {pending ? "Adding…" : "Add domain"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            className="text-sm text-sky-600 hover:text-sky-800 border border-dashed border-sky-300 rounded-lg px-4 py-2 hover:bg-sky-50 w-full">
            + Add domain
          </button>
        )}
      </div>

      <p className="mt-4 text-xs text-stone-400">
        Domain keys are stored directly in line templates and budget lines. Renaming a key requires a data migration. Add new domains freely.
        If you enter a new beneficiary variable name, an <span className="font-mono">inp.*</span> cost registry entry is created automatically.
      </p>

      <datalist id="benef-var-list">
        {progInputKeys.map(k => {
          const v = k.replace(/^inp\./, "");
          return <option key={k} value={v}>{k}</option>;
        })}
      </datalist>
    </>
  );
}

// ─── Root client component ────────────────────────────────────────────────────

type CompareBudget = {
  id: string;
  name: string;
  createdAt: string;
  domains: string[];
  horizonMonths: number;
};

export default function AdminClient({
  costs, isSeeded, city, templates, domains, zones, needsDomains, cityBudgets = [], budgetAdminOnly = false, componentsByKey = {},
}: {
  costs: CostRow[];
  isSeeded: boolean;
  city: string;
  templates: LineTemplate[];
  domains: BudgetDomainConfig[];
  zones: GeoItem[];
  needsDomains: { domain: string; label: string | null }[];
  cityBudgets?: CompareBudget[];
  budgetAdminOnly?: boolean;
  componentsByKey?: Record<string, ComponentItem[]>;
}) {
  const [activeTab, setActiveTab] = useState<"registry" | "templates" | "analysis" | "domains">(budgetAdminOnly ? "analysis" : "registry");

  // Build lookup maps from domain configs
  const domainOrder: (string | null)[] = [...domains.map(d => d.key), null];
  const domainLabels: Record<string, string> = Object.fromEntries(domains.map(d => [d.key, d.label]));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Budget Configuration</h1>
          <p className="text-sm text-stone-500 mt-0.5">Costs, ratios, line templates, and domains used when generating budgets.</p>
        </div>
      </div>

      {/* City tabs */}
      <div className="flex gap-1 mb-5 border-b border-stone-200 pb-3">
        {CITIES.map(c => (
          <a key={c} href={`/admin?city=${c}`}
            className={`text-sm px-4 py-1.5 rounded-lg transition-all ${city === c ? "bg-stone-800 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
            {c}
          </a>
        ))}
      </div>

      {/* Section tabs */}
      <div className="overflow-x-auto mb-6 pb-1">
        <div className="flex gap-1 bg-stone-100 rounded-lg p-1 w-fit min-w-full sm:min-w-0">
          {!budgetAdminOnly && (
            <button onClick={() => setActiveTab("registry")}
              className={`text-sm px-4 py-1.5 rounded-md transition-all whitespace-nowrap ${activeTab === "registry" ? "bg-white shadow-sm text-stone-900 font-medium" : "text-stone-500 hover:text-stone-800"}`}>
              Cost Registry
            </button>
          )}
          {!budgetAdminOnly && (
            <button onClick={() => setActiveTab("templates")}
              className={`text-sm px-4 py-1.5 rounded-md transition-all whitespace-nowrap ${activeTab === "templates" ? "bg-white shadow-sm text-stone-900 font-medium" : "text-stone-500 hover:text-stone-800"}`}>
              Line Templates
              <span className="ml-1.5 text-xs text-stone-400">{templates.length}</span>
            </button>
          )}
          <button onClick={() => setActiveTab("analysis")}
            className={`text-sm px-4 py-1.5 rounded-md transition-all whitespace-nowrap ${activeTab === "analysis" ? "bg-white shadow-sm text-stone-900 font-medium" : "text-stone-500 hover:text-stone-800"}`}>
            Cost Analysis
          </button>
          {!budgetAdminOnly && (
            <button onClick={() => setActiveTab("domains")}
              className={`text-sm px-4 py-1.5 rounded-md transition-all whitespace-nowrap ${activeTab === "domains" ? "bg-white shadow-sm text-stone-900 font-medium" : "text-stone-500 hover:text-stone-800"}`}>
              Domains
              <span className="ml-1.5 text-xs text-stone-400">{domains.length}</span>
            </button>
          )}
        </div>
      </div>

      {activeTab === "registry"  && <CostRegistryTab costs={costs} isSeeded={isSeeded} city={city} domainOrder={domainOrder} domainLabels={domainLabels} needsDomains={needsDomains} componentsByKey={componentsByKey} />}
      {activeTab === "templates" && <LineTemplatesTab templates={templates} city={city} registryKeys={costs.map(c => c.itemKey)} costs={costs} domains={domains} />}
      {activeTab === "analysis"  && <CostAnalysisTab templates={templates} costs={costs} domains={domains} city={city} zones={zones} cityBudgets={cityBudgets} />}
      {activeTab === "domains"   && <DomainsTab domains={domains} city={city} progInputKeys={costs.filter(c => c.itemKey.startsWith("inp.")).map(c => c.itemKey)} />}
    </div>
  );
}
