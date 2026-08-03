"use client";

// One section card: header, the line rows, the expandable working + change-history
// panel, the section footer and the add-line form. Owns only its own UI state —
// which row is being edited, which working panel is open, whether the add form is
// showing. Every write goes back up to the shell, which holds the line array.

import { Fragment, useState } from "react";
import type { BudgetSection, BudgetLineCadence, InflationType } from "@/app/generated/prisma/client";
import { getBudgetLineHistory } from "../../actions";
import type { DraftNote } from "../../partner-draft-actions";
import CadencePicker from "./CadencePicker";
import LineNoteThread, { openQueryCount } from "./LineNoteThread";
import { EditRow, ViewRow } from "./LineRows";
import {
  type Band, type Line, type LineHistRow, type LineWorking, type WorkingComp,
  SECTION_LABELS, fmt, yTotalKey,
} from "./types";

export type NewLineInput = {
  description: string;
  costCategory: InflationType;
  unitType: string;
  domain: string | undefined;
  cadence: BudgetLineCadence;
  plannedMonths: number[];
  y1Units: number;
  y1UnitCost: number;
};

type WRow = { label: string; spec: string; qty: string; unitCost: string };

export default function BudgetLineTable({
  budgetId, section, lines, bands, showAlloc, inflationRate, domains, domainLabels,
  working, pending, canEdit, canDelete, canAdd, showHistory, defaultDomain,
  notesByLine, canComment = false, canResolveNotes = false,
  onSaveLine, onDeleteLine, onAddLine, onSaveWorking,
}: {
  budgetId: string;
  section: BudgetSection;
  lines: Line[];
  bands: Band[];
  showAlloc: boolean;
  inflationRate: Record<InflationType, number>;
  domains: string[];
  domainLabels: Record<string, string>;
  working: Record<string, LineWorking>;
  pending: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canAdd: boolean;
  showHistory: boolean;
  defaultDomain: string;
  /** Query threads keyed by line id. Undefined hides the whole affordance. */
  notesByLine?: Record<string, DraftNote[]>;
  canComment?: boolean;
  canResolveNotes?: boolean;
  onSaveLine: (lineId: string, vals: Partial<Line>) => void;
  onDeleteLine: (lineId: string) => void;
  onAddLine: (section: BudgetSection, input: NewLineInput) => void;
  onSaveWorking: (line: Line, components: WorkingComp[], derivation: string | null) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<Partial<Line>>({});

  const [workLineId, setWorkLineId] = useState<string | null>(null);
  const [histByLine, setHistByLine] = useState<Record<string, LineHistRow[]>>({});
  const [histLoading, setHistLoading] = useState(false);
  const [wEditing, setWEditing] = useState(false);
  const [wRows, setWRows] = useState<WRow[]>([]);
  const [wDeriv, setWDeriv] = useState("");
  const wRollup = Math.round(wRows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.unitCost) || 0), 0));

  const [adding, setAdding] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newCostCat, setNewCostCat] = useState<InflationType>("Other");
  const [newUnitType, setNewUnitType] = useState("Annual");
  const [newUnits, setNewUnits] = useState("");
  const [newUnitCost, setNewUnitCost] = useState("");
  // "" means cross-cutting (domain=null in the DB).
  const [newDomain, setNewDomain] = useState<string>(defaultDomain);
  const [newCadence, setNewCadence] = useState<BudgetLineCadence>("monthly");
  const [newPlannedMonths, setNewPlannedMonths] = useState<number[]>([]);

  const showExtraBands = bands.length > 1;

  function toggleWorking(lineId: string) {
    if (workLineId === lineId) { setWorkLineId(null); setWEditing(false); return; }
    setWorkLineId(lineId); setWEditing(false);
    if (showHistory && !histByLine[lineId]) {
      setHistLoading(true);
      getBudgetLineHistory(lineId).then(rows => setHistByLine(p => ({ ...p, [lineId]: rows }))).finally(() => setHistLoading(false));
    }
  }
  function startWEdit(lineId: string) {
    const w = working[lineId];
    setWRows((w?.components ?? []).map(c => ({ label: c.label, spec: c.spec ?? "", qty: String(c.qty), unitCost: String(c.unitCost) })));
    setWDeriv(w?.derivation ?? "");
    setWEditing(true);
  }
  const addWRow = () => setWRows(p => [...p, { label: "", spec: "", qty: "1", unitCost: "" }]);
  const updateWRow = (idx: number, k: keyof WRow, v: string) => setWRows(p => p.map((r, i) => i === idx ? { ...r, [k]: v } : r));
  const removeWRow = (idx: number) => setWRows(p => p.filter((_, i) => i !== idx));

  const saveWorking = (line: Line) => {
    const comps = wRows
      .map(r => ({ label: r.label, spec: r.spec || null, qty: parseFloat(r.qty) || 0, unitCost: parseFloat(r.unitCost) || 0 }))
      .filter(r => r.label.trim());
    onSaveWorking(line, comps, wDeriv.trim() || null);
    setHistByLine(p => ({ ...p, [line.id]: [] })); // force reload next open
    setWEditing(false);
  };

  const startEdit = (l: Line) => {
    setEditing(l.id);
    setEditVals({
      description: l.description,
      costCategory: l.costCategory,
      domain: l.domain,
      cadence: l.cadence,
      plannedMonths: l.plannedMonths,
      y1Units: l.y1Units, y1UnitCost: l.y1UnitCost, y1AllocPct: l.y1AllocPct,
      y2Units: l.y2Units, y2UnitCost: l.y2UnitCost, y2AllocPct: l.y2AllocPct,
      y3Units: l.y3Units, y3UnitCost: l.y3UnitCost, y3AllocPct: l.y3AllocPct,
      y4Units: l.y4Units, y4UnitCost: l.y4UnitCost, y4AllocPct: l.y4AllocPct,
      y5Units: l.y5Units, y5UnitCost: l.y5UnitCost, y5AllocPct: l.y5AllocPct,
    });
  };

  const saveEdit = (lineId: string) => {
    onSaveLine(lineId, { ...editVals });
    setEditing(null);
  };

  const openAddForm = () => {
    setAdding(true);
    setNewDomain(defaultDomain);
    // Section-default cadence: Capex defaults to one_time month 1. Every other
    // section starts as monthly — camps / TLM get marked by hand.
    if (section === "capex") { setNewCadence("one_time"); setNewPlannedMonths([1]); }
    else { setNewCadence("monthly"); setNewPlannedMonths([]); }
  };

  const submitAdd = () => {
    if (!newDesc.trim()) return;
    // Guardrails matching server-side normaliseCadence — block the click rather
    // than the server throw, so the missing-month problem shows inline.
    if (newCadence === "one_time" && newPlannedMonths.length !== 1) return;
    if (newCadence === "seasonal" && newPlannedMonths.length < 2) return;
    onAddLine(section, {
      description: newDesc.trim(),
      costCategory: newCostCat,
      unitType: newUnitType,
      domain: newDomain || undefined,
      cadence: newCadence,
      plannedMonths: newPlannedMonths,
      y1Units: parseFloat(newUnits) || 0,
      y1UnitCost: parseFloat(newUnitCost) || 0,
    });
    setAdding(false);
    setNewDesc(""); setNewUnits(""); setNewUnitCost("");
    setNewCadence("monthly"); setNewPlannedMonths([]);
  };

  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-stone-50 border-b border-stone-200">
        <span className="text-sm font-semibold text-stone-700">{SECTION_LABELS[section]}</span>
        <span className="text-sm text-stone-500">{fmt(lines.reduce((s, l) => s + l.y1Total, 0))}</span>
      </div>

      <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-stone-100 text-xs text-stone-400">
            <th className="text-left px-4 py-2 w-8">#</th>
            <th className="text-left px-2 py-2">Description</th>
            <th className="text-right px-2 py-2 w-20">Units</th>
            <th className="text-right px-2 py-2 w-28">Unit Cost</th>
            {showAlloc && <th className="text-right px-2 py-2 w-16">Alloc%</th>}
            {bands.map(b => (
              <th key={b.k} className="text-right px-2 py-2 w-28">{b.label}</th>
            ))}
            <th className="w-16 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const w = working[l.id];
            const colSpan = 5 + (showAlloc ? 1 : 0) + bands.length;
            const isWorkOpen = workLineId === l.id;
            const editingThis = wEditing && isWorkOpen;
            const compSum = w ? Math.round(w.components.reduce((s, c) => s + c.qty * c.unitCost, 0)) : 0;
            const reconciles = !w || w.components.length === 0 || compSum === Math.round(l.y1UnitCost);
            const hist = histByLine[l.id];
            const lineNotes = notesByLine?.[l.id];
            return (
              <Fragment key={l.id}>
                {editing === l.id
                  ? <EditRow line={l} vals={editVals} setVals={setEditVals}
                      bands={bands} showAlloc={showAlloc} inflationRate={inflationRate}
                      domains={domains} domainLabels={domainLabels}
                      onSave={() => saveEdit(l.id)} onCancel={() => setEditing(null)} />
                  : <ViewRow line={l} i={i + 1} bands={bands} showAlloc={showAlloc}
                      canEdit={canEdit} canDelete={canDelete}
                      onEdit={() => startEdit(l)} onDelete={() => onDeleteLine(l.id)}
                      onWorking={() => toggleWorking(l.id)} hasWorking={!!w && w.components.length > 0} isOwnWorking={!!w?.customised}
                      queries={lineNotes && { total: lineNotes.length, open: openQueryCount(lineNotes) }}
                      onQueries={() => toggleWorking(l.id)} />
                }
                {isWorkOpen && (
                  <tr className="border-b border-stone-100 bg-stone-50/60">
                    <td colSpan={colSpan} className="px-4 py-3">
                      {editingThis ? (
                        <div className="mb-4">
                          <div className="text-xs font-semibold text-stone-500 mb-1.5">Edit working — components set this line’s unit cost</div>
                          <div className="overflow-x-auto">
                          <table className="w-full min-w-[460px] text-xs max-w-2xl">
                            <thead><tr className="text-stone-400"><th className="text-left py-1 font-medium">Item</th><th className="text-left font-medium">Spec</th><th className="text-right font-medium w-16">Qty</th><th className="text-right font-medium w-24">Unit ₹</th><th className="text-right font-medium w-24">Amount ₹</th><th className="w-6" /></tr></thead>
                            <tbody>
                              {wRows.map((r, idx) => (
                                <tr key={idx} className="border-t border-stone-100">
                                  <td className="py-1"><input value={r.label} onChange={e => updateWRow(idx, "label", e.target.value)} placeholder="Item" className="w-full border border-stone-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500" /></td>
                                  <td><input value={r.spec} onChange={e => updateWRow(idx, "spec", e.target.value)} placeholder="spec" className="w-full border border-stone-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500" /></td>
                                  <td><input type="number" value={r.qty} onChange={e => updateWRow(idx, "qty", e.target.value)} className="w-full border border-stone-200 rounded px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-sky-500" /></td>
                                  <td><input type="number" value={r.unitCost} onChange={e => updateWRow(idx, "unitCost", e.target.value)} className="w-full border border-stone-200 rounded px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-sky-500" /></td>
                                  <td className="text-right text-stone-600">{Math.round((parseFloat(r.qty) || 0) * (parseFloat(r.unitCost) || 0)).toLocaleString("en-IN")}</td>
                                  <td className="text-center"><button onClick={() => removeWRow(idx)} className="text-stone-300 hover:text-red-500">×</button></td>
                                </tr>
                              ))}
                              <tr className="border-t border-stone-200 font-medium text-stone-700">
                                <td className="py-1.5" colSpan={4}><button onClick={addWRow} className="text-xs text-sky-600 hover:text-sky-800">+ Add item</button>{wRows.length > 0 && <span className="ml-3 font-normal text-stone-500">→ unit cost becomes ₹{wRollup.toLocaleString("en-IN")}</span>}</td>
                                <td className="text-right">{wRollup.toLocaleString("en-IN")}</td>
                                <td />
                              </tr>
                            </tbody>
                          </table>
                          </div>
                          <div className="mt-2 max-w-2xl">
                            <label className="text-xs text-stone-500">Derivation note (for rates that aren’t itemised)</label>
                            <textarea value={wDeriv} onChange={e => setWDeriv(e.target.value)} rows={2} placeholder="e.g. average of 3 vendor quotes" className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => saveWorking(l)} disabled={pending} className="text-xs bg-sky-600 text-white px-3 py-1.5 rounded hover:bg-sky-700 disabled:opacity-50">{pending ? "Saving…" : "Save working"}</button>
                            <button onClick={() => setWEditing(false)} className="text-xs text-stone-400 hover:text-stone-700">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="mb-4">
                          {w && w.components.length > 0 ? (
                            <>
                              <div className="text-xs font-semibold text-stone-500 mb-1.5">Working — how ₹{l.y1UnitCost.toLocaleString("en-IN")} is derived <span className="text-stone-400">{w.customised ? "(customised for this budget)" : w.frozen ? "(standard — frozen at generation)" : "(standard — from registry)"}</span></div>
                              <div className="overflow-x-auto">
                              <table className="w-full min-w-[420px] text-xs max-w-2xl">
                                <thead><tr className="text-stone-400"><th className="text-left py-1 font-medium">Item</th><th className="text-left font-medium">Spec</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Unit ₹</th><th className="text-right font-medium">Amount ₹</th></tr></thead>
                                <tbody>
                                  {w.components.map((c, idx) => (
                                    <tr key={idx} className="border-t border-stone-100">
                                      <td className="py-1 text-stone-700">{c.label}</td>
                                      <td className="text-stone-400">{c.spec ?? ""}</td>
                                      <td className="text-right text-stone-600">{c.qty}</td>
                                      <td className="text-right text-stone-600">{c.unitCost.toLocaleString("en-IN")}</td>
                                      <td className="text-right text-stone-800">{Math.round(c.qty * c.unitCost).toLocaleString("en-IN")}</td>
                                    </tr>
                                  ))}
                                  <tr className="border-t border-stone-200 font-medium text-stone-700">
                                    <td className="py-1" colSpan={4}>Sub-total{!reconciles && <span className="ml-2 text-red-500 font-normal">⚠ ≠ unit cost ₹{l.y1UnitCost.toLocaleString("en-IN")}</span>}</td>
                                    <td className="text-right">{compSum.toLocaleString("en-IN")}</td>
                                  </tr>
                                </tbody>
                              </table>
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-stone-400">No breakup recorded for this line yet.</div>
                          )}
                          {w?.derivation && <p className="text-xs text-stone-500 mt-2 max-w-2xl"><span className="text-stone-400">Derivation:</span> {w.derivation}</p>}
                          {canEdit && <button onClick={() => startWEdit(l.id)} className="text-xs text-sky-600 hover:text-sky-800 mt-2">{w && (w.components.length > 0 || w.derivation) ? "Edit working" : "Add working"}</button>}
                        </div>
                      )}
                      {showHistory && (
                        <div>
                          <div className="text-xs font-semibold text-stone-500 mb-1.5">Change history</div>
                          {!hist ? <div className="text-xs text-stone-400">{histLoading ? "Loading…" : "—"}</div>
                            : hist.length === 0 ? <div className="text-xs text-stone-400">No changes logged.</div>
                            : (
                              <ul className="space-y-1">
                                {hist.map(h => (
                                  <li key={h.id} className="text-xs text-stone-600 flex flex-wrap gap-x-2">
                                    <span className="text-stone-400 tabular-nums">{new Date(h.changedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                                    <span>{h.oldCost == null ? "—" : `₹${h.oldCost.toLocaleString("en-IN")}`} → {h.newCost == null ? "—" : `₹${h.newCost.toLocaleString("en-IN")}`}</span>
                                    {h.source && <span className="text-stone-400">· {h.source}</span>}
                                    {h.changedBy && <span className="text-stone-400">· {h.changedBy}</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                        </div>
                      )}
                      {notesByLine && (lineNotes?.length || canComment) && (
                        <div className="mt-4">
                          <div className="text-xs font-semibold text-stone-500 mb-1.5">Queries</div>
                          <div className="max-w-2xl">
                            <LineNoteThread
                              budgetId={budgetId} budgetLineId={l.id} notes={lineNotes ?? []}
                              canComment={canComment} canResolve={canResolveNotes} />
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-stone-200 bg-stone-50 font-medium text-stone-700">
            <td className="px-4 py-2" colSpan={4 + (showAlloc ? 1 : 0)}>Section total</td>
            {bands.map(b => (
              <td key={b.k} className="text-right px-2 py-2">
                {fmt(lines.reduce((s, l) => s + l[yTotalKey(b.k)], 0))}
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
      </div>

      {!canAdd ? null : adding ? (
        <div className="px-4 py-3 border-t border-stone-100 space-y-2">
          <div className="flex flex-wrap gap-2 items-end">
            <input
              autoFocus
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Description"
              className="w-full sm:w-auto sm:flex-1 sm:min-w-48 border border-stone-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            <select value={newCostCat} onChange={e => setNewCostCat(e.target.value as InflationType)}
              className="border border-stone-300 rounded px-2 py-1 text-xs focus:outline-none">
              <option value="Salary">Salary inflation (10%)</option>
              <option value="Other">Other inflation (5%)</option>
              <option value="Nil">No inflation</option>
            </select>
            <select value={newDomain} onChange={e => setNewDomain(e.target.value)}
              className="border border-stone-300 rounded px-2 py-1 text-xs focus:outline-none"
              title="Which per-domain card this row belongs to. Cross-cutting = shared admin / travel / shared.">
              <option value="">Cross-cutting</option>
              {domains.map(d => (
                <option key={d} value={d}>{domainLabels[d] ?? d}</option>
              ))}
            </select>
            <input value={newUnitType} onChange={e => setNewUnitType(e.target.value)}
              placeholder="Unit label" className="w-28 border border-stone-300 rounded px-2 py-1 text-xs focus:outline-none" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-stone-400">Cadence</span>
            <CadencePicker
              cadence={newCadence}
              plannedMonths={newPlannedMonths}
              onChange={({ cadence, plannedMonths }) => {
                setNewCadence(cadence);
                setNewPlannedMonths(plannedMonths);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <input type="number" value={newUnits} onChange={e => setNewUnits(e.target.value)}
              placeholder="Units (Y1)" className="w-28 border border-stone-300 rounded px-2 py-1 text-sm focus:outline-none" />
            <input type="number" value={newUnitCost} onChange={e => setNewUnitCost(e.target.value)}
              placeholder="Unit cost ₹ (Y1)" className="w-36 border border-stone-300 rounded px-2 py-1 text-sm focus:outline-none" />
            {newUnits && newUnitCost && (
              <span className="text-xs text-stone-500">
                Y1: ₹{Math.round((parseFloat(newUnits)||0)*(parseFloat(newUnitCost)||0)*bands[0].factor).toLocaleString("en-IN")}
                {showExtraBands && (() => {
                  const rate = inflationRate[newCostCat];
                  const u = parseFloat(newUnits) || 0;
                  const c = parseFloat(newUnitCost) || 0;
                  return bands.slice(1).map(b => {
                    const yc = c * Math.pow(1 + rate, b.k - 1);
                    const yt = Math.round(u * yc * b.factor);
                    return <Fragment key={b.k}> · {b.label}: ₹{yt.toLocaleString("en-IN")}</Fragment>;
                  });
                })()}
              </span>
            )}
            <div className="flex gap-2 ml-auto">
              <button onClick={submitAdd} disabled={!newDesc.trim() || pending}
                className="text-xs bg-sky-600 text-white px-3 py-1.5 rounded hover:bg-sky-700 disabled:opacity-50">Add</button>
              <button onClick={() => setAdding(false)} className="text-xs text-stone-400 hover:text-stone-700">Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={openAddForm}
          className="w-full text-left px-4 py-2 text-xs text-stone-400 hover:text-sky-600 hover:bg-sky-50 border-t border-stone-100 transition-colors">
          + Add line
        </button>
      )}
    </div>
  );
}
