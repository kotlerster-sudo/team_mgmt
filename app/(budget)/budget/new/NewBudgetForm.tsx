"use client";

import { useState, useTransition, useMemo } from "react";
import { createBudget, createGrantPartner } from "../actions";
import type { DomainOption, DomainInputField, CostItem } from "./page";
import type { EnumPicker } from "@/lib/budget/inputEnumOptions";
import { expandEnum, inferEnumValue } from "@/lib/budget/inputEnumOptions";

const FALLBACK_DOMAINS: DomainOption[] = [
  { key: "Children",     label: "Children",                    description: "CLCs, after-school, camps",            city: "Bangalore", inputs: [] },
  { key: "Youth",        label: "Youth",                       description: "YRCs, Yuva Adda, sports",              city: "Bangalore", inputs: [] },
  { key: "Elderly",      label: "Elderly + Community Kitchen", description: "Day care, nutrition, community kitchen", city: "Bangalore", inputs: [] },
  { key: "WelfareRights",label: "Welfare Rights",              description: "Entitlement & collectivization",        city: "Bangalore", inputs: [] },
  { key: "Creche",       label: "Creche",                      description: "0–3 yr children, standard model",  city: "Bangalore", inputs: [] },
];

// Fallback only used when CostRegistry hasn't been seeded yet. requiredByDomains
// is set to settlement-driven domains so a CLC-only fallback still hides them.
const FALLBACK_CROSS_CUTTING: DomainInputField[] = [
  { key: "nSettlements", label: "No. of settlements", unit: "count", defaultValue: 0, isRent: false, requiredByDomains: ["WelfareRights"] },
  { key: "nClusters",    label: "No. of clusters",    unit: "count", defaultValue: 0, isRent: false, requiredByDomains: ["WelfareRights"] },
];

function initInputs(crossCutting: DomainInputField[], allDomains: DomainOption[], enumPickers: EnumPicker[] = []): Record<string, number> {
  const init: Record<string, number> = {};
  for (const f of crossCutting) init[f.key] = f.defaultValue;
  for (const d of allDomains) for (const f of d.inputs) { init[f.key] ??= f.defaultValue; }
  // Seed enum-managed sentinel keys from each picker's defaultValue so
  // formulas evaluate correctly even if the user never touches the picker.
  for (const p of enumPickers) {
    const patch = expandEnum(p.pickerKey, p.defaultValue);
    for (const [k, v] of Object.entries(patch)) init[k] ??= v;
  }
  return init;
}

type CityName = "Bangalore" | "Chennai" | "Others";
const CITY_NAMES: CityName[] = ["Bangalore", "Chennai", "Others"];

export default function NewBudgetForm({
  domains: allDomains = [],
  crossCuttingInputs: allCrossCutting = [],
  costItems = [],
  initialCity,
  partners = [],
  enumPickers = [],
}: {
  domains?: DomainOption[];
  crossCuttingInputs?: DomainInputField[];
  costItems?: CostItem[];
  initialCity?: string;
  partners?: { id: string; name: string; city: string }[];
  enumPickers?: EnumPicker[];
}) {
  const effectiveDomains     = allDomains.length > 0     ? allDomains     : FALLBACK_DOMAINS;
  const effectiveCrossCutting = allCrossCutting.length > 0 ? allCrossCutting : FALLBACK_CROSS_CUTTING;

  const [step, setStep]       = useState<1 | 2>(1);
  const [city, setCity]       = useState<CityName>(
    (CITY_NAMES as string[]).includes(initialCity ?? "") ? (initialCity as CityName) : "Bangalore",
  );
  const [allPartners, setAllPartners] = useState(partners);
  const [grantPartnerId, setGrantPartnerId] = useState<string>("");
  const [newPartnerName, setNewPartnerName] = useState("");
  const [addingPartner, setAddingPartner] = useState(false);
  const [name, setName]       = useState("");
  // horizonMonths replaces years. Defaults to 12mo; presets cover the typical
  // donor-budget shapes. 60mo is the cap (matches BudgetLine y1..y5 columns).
  const [horizonMonths, setHorizonMonths] = useState<number>(12);
  const [customMonths, setCustomMonths]   = useState<string>("");
  // Where the pro-rated stub sits when the horizon isn't whole years.
  const [partialPosition, setPartialPosition] = useState<"start" | "end">("end");
  const [applyInflation, setApplyInflation] = useState<boolean>(false);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [includeCrossCutting, setIncludeCrossCutting] = useState(true);
  const [programmeInputs, setProgrammeInputs] = useState<Record<string, number>>(() =>
    initInputs(effectiveCrossCutting, effectiveDomains, enumPickers)
  );
  // Multi-partner: split the budget across delivery partners, each with its own
  // inputs and an explicit % of shared costs. partnerList[activePartnerIdx] is
  // the input set the step-2 fields write to when multiPartner is on.
  // grantPartnerId links each delivery-partner tab to the GrantPartner registry
  // (city-scoped, same registry as the top-level grantee). name is a
  // denormalised copy of the picked partner's name at save-time.
  const [multiPartner, setMultiPartner] = useState(false);
  const [partnerList, setPartnerList] = useState<{ name: string; sharedPct: number; grantPartnerId: string | null; inputs: Record<string, number> }[]>([]);
  const [activePartnerIdx, setActivePartnerIdx] = useState(0);
  // Inline "+ New partner" state, per active row.
  const [inlineNewPartnerName, setInlineNewPartnerName] = useState("");
  const [inlineNewPartnerFor, setInlineNewPartnerFor] = useState<number | null>(null);
  const blankInputs = () => initInputs(effectiveCrossCutting, effectiveDomains, enumPickers);
  const enableMultiPartner = (on: boolean) => {
    setMultiPartner(on);
    if (on && partnerList.length === 0) {
      setPartnerList([
        { name: "", sharedPct: 50, grantPartnerId: null, inputs: blankInputs() },
        { name: "", sharedPct: 50, grantPartnerId: null, inputs: blankInputs() },
      ]);
      setActivePartnerIdx(0);
    }
  };
  const addPartner = () => setPartnerList(prev => {
    const next = [...prev, { name: "", sharedPct: 0, grantPartnerId: null, inputs: blankInputs() }];
    setActivePartnerIdx(next.length - 1);
    return next;
  });
  const removePartner = (idx: number) => setPartnerList(prev => {
    const next = prev.filter((_, i) => i !== idx);
    setActivePartnerIdx(i => Math.max(0, Math.min(i, next.length - 1)));
    return next;
  });
  const patchPartner = (idx: number, patch: Partial<{ name: string; sharedPct: number; grantPartnerId: string | null }>) =>
    setPartnerList(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  // When the user picks a registry partner, sync name to match; when unpicked,
  // clear the name so the tab reverts to the "Partner N" placeholder.
  const pickPartner = (idx: number, grantPartnerId: string) => {
    if (!grantPartnerId) { patchPartner(idx, { grantPartnerId: null, name: "" }); return; }
    const gp = allPartners.find(p => p.id === grantPartnerId);
    patchPartner(idx, { grantPartnerId, name: gp?.name ?? "" });
  };
  const createInlinePartner = async (idx: number) => {
    const trimmed = inlineNewPartnerName.trim();
    if (!trimmed) return;
    const gp = await createGrantPartner(city, trimmed);
    setAllPartners(prev => prev.some(p => p.id === gp.id) ? prev : [...prev, { ...gp, city }]);
    patchPartner(idx, { grantPartnerId: gp.id, name: gp.name });
    setInlineNewPartnerName(""); setInlineNewPartnerFor(null);
  };
  const currentInputs = multiPartner ? (partnerList[activePartnerIdx]?.inputs ?? {}) : programmeInputs;
  const sharedPctSum = partnerList.reduce((s, p) => s + (p.sharedPct || 0), 0);
  // "standard" → costOverrides stays empty, generator reads the live registry.
  // "customize" → form shows the per-domain unit-cost + ratio accordion and
  // collects sparse overrides keyed by CostRegistry.itemKey.
  const [costMode, setCostMode]           = useState<"standard" | "customize">("standard");
  const [costOverrides, setCostOverrides] = useState<Record<string, number>>({});
  const [pending, startTransition] = useTransition();

  // "Others" has no domain configs of its own — fall back to Bangalore's set.
  const cityDomains = effectiveDomains.filter(d => d.city === (city === "Others" ? "Bangalore" : city));
  const cityPartners = allPartners.filter(p => p.city === city);

  // Cross-cutting inputs only show when at least one of their consuming domains
  // is selected. null = always show.
  const visibleCrossCutting = effectiveCrossCutting.filter(f =>
    f.requiredByDomains === null
    || f.requiredByDomains.some(d => selectedDomains.has(d))
  );

  const toggle = (key: string) => setSelectedDomains(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const setNum = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value) || 0;
    if (multiPartner) {
      setPartnerList(prev => prev.map((p, i) => i === activePartnerIdx ? { ...p, inputs: { ...p.inputs, [key]: v } } : p));
    } else {
      setProgrammeInputs(prev => ({ ...prev, [key]: v }));
    }
  };

  // Enum pickers: selecting an option folds its sentinel inp.* numerics into
  // the current input record (partner-scoped in multi-partner mode). Managed
  // sentinel keys are hidden from the numeric-field render pass.
  const enumManagedKeys = useMemo(
    () => new Set(enumPickers.flatMap(p => p.managedInputKeys)),
    [enumPickers],
  );
  const setEnum = (pickerKey: string, value: string) => {
    const patch = expandEnum(pickerKey, value);
    if (multiPartner) {
      setPartnerList(prev => prev.map((p, i) => i === activePartnerIdx ? { ...p, inputs: { ...p.inputs, ...patch } } : p));
    } else {
      setProgrammeInputs(prev => ({ ...prev, ...patch }));
    }
  };
  // Only surface pickers whose sentinels are actually referenced by an
  // input on a currently-selected domain (or by cross-cutting), so a Children
  // budget doesn't show the sanitation structureType picker.
  const referencedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const f of visibleCrossCutting) set.add(f.key);
    for (const d of cityDomains) {
      if (!selectedDomains.has(d.key)) continue;
      for (const f of d.inputs) set.add(f.key);
    }
    return set;
  }, [visibleCrossCutting, cityDomains, selectedDomains]);
  const visibleEnumPickers = useMemo(() => {
    // A picker is relevant if a template on a selected domain references any of
    // its managed sentinels. We infer domain relevance by checking whether any
    // discovered inputVar on a selected domain matches — but sentinels aren't
    // themselves in the discovered inputs (we filter them out). Fallback: show
    // the picker whenever the sanitation domain (or any domain whose formulas
    // could use it) is selected — currently only Sanitation_Complex.
    return enumPickers.filter(p =>
      // Heuristic: sanitation structure picker shows when Sanitation_Complex is selected.
      p.pickerKey === "structureType"
        ? selectedDomains.has("Sanitation_Complex")
        : true
    );
  }, [enumPickers, selectedDomains, referencedKeys]);

  const canProceed = name.trim() && selectedDomains.size > 0;

  // A row is valid only when a registry partner is picked (name is derived).
  const validPartners = partnerList.filter(p => p.grantPartnerId && p.name.trim());
  const multiPartnerReady = !multiPartner || validPartners.length >= 2;
  const submit = () => {
    const useMulti = multiPartner && validPartners.length >= 2;
    // Master totals = element-wise sum of partner inputs (server recomputes too).
    const summed: Record<string, number> = {};
    if (useMulti) for (const p of validPartners) for (const [k, v] of Object.entries(p.inputs)) summed[k] = (summed[k] ?? 0) + (Number(v) || 0);
    startTransition(async () => {
      await createBudget({
        name: name.trim(), city, grantPartnerId: grantPartnerId || null,
        domains: Array.from(selectedDomains),
        horizonMonths, partialPosition, applyInflation,
        programmeInputs: useMulti ? summed : programmeInputs,
        includeCrossCutting,
        // Pass only when customising. Server snapshots the full registry either
        // way and merges this delta on top.
        costOverrides: costMode === "customize" ? costOverrides : {},
        deliveryPartners: useMulti
          ? validPartners.map(p => ({ name: p.name.trim(), sharedPct: p.sharedPct, grantPartnerId: p.grantPartnerId, programmeInputs: p.inputs }))
          : undefined,
      });
    });
  };

  // Customise accordion: group costItems by domain (selected ones + cross-cutting),
  // then split each domain into cost vs ratio rows. Recomputes when selection
  // changes so the accordion only ever exposes relevant lines.
  const customisableGroups = useMemo(() => {
    if (costMode !== "customize") return [];
    type Group = { label: string; domain: string | null; costs: CostItem[]; ratios: CostItem[] };
    const groups: Group[] = [];
    for (const d of cityDomains) {
      if (!selectedDomains.has(d.key)) continue;
      const items = costItems.filter(c => c.domain === d.key);
      if (items.length === 0) continue;
      groups.push({
        label: d.label, domain: d.key,
        costs:  items.filter(c => c.kind === "cost"),
        ratios: items.filter(c => c.kind === "ratio"),
      });
    }
    if (includeCrossCutting) {
      const items = costItems.filter(c => c.domain === null);
      if (items.length > 0) groups.push({
        label: "Cross-cutting", domain: null,
        costs:  items.filter(c => c.kind === "cost"),
        ratios: items.filter(c => c.kind === "ratio"),
      });
    }
    return groups;
  }, [costMode, cityDomains, selectedDomains, includeCrossCutting, costItems]);

  const overriddenCount = Object.keys(costOverrides).length;
  const setOverride = (key: string, value: number, defaultValue: number) =>
    setCostOverrides(prev => {
      const next = { ...prev };
      // Removing the entry when the user returns to the standard value keeps
      // the persisted overrides sparse — the server merges this onto snapshot.
      if (value === defaultValue) delete next[key];
      else next[key] = value;
      return next;
    });

  const PERIOD_PRESETS = [6, 12, 18, 24, 36, 48, 60] as const;
  const horizonLabel = (m: number) =>
    m % 12 === 0 ? `${m / 12} year${m === 12 ? "" : "s"}` : `${m} months`;

  // Collect domain-specific sections for selected domains, deduping shared keys
  const domainSections = () => {
    const seen = new Set<string>(effectiveCrossCutting.map(f => f.key));
    return cityDomains
      .filter(d => selectedDomains.has(d.key))
      .map(d => ({
        label: d.label,
        inputs: d.inputs.filter(f => { if (seen.has(f.key)) return false; seen.add(f.key); return true; }),
      }))
      .filter(s => s.inputs.length > 0);
  };

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-6">

      {step === 1 && (
        <>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Budget name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. ActionAid FY26-27 Proposal"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">City</label>
            <div className="flex gap-3">
              {CITY_NAMES.map(c => (
                <button key={c} type="button"
                  onClick={() => {
                    setCity(c); setSelectedDomains(new Set()); setGrantPartnerId("");
                    // Wrong-city registry links must be dropped when city flips.
                    setPartnerList(prev => prev.map(p => ({ ...p, grantPartnerId: null, name: "" })));
                    setInlineNewPartnerFor(null); setInlineNewPartnerName("");
                  }}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${city === c ? "border-sky-500 bg-sky-50 text-sky-700" : "border-stone-200 text-stone-700 hover:border-stone-300"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Partner <span className="text-stone-400 font-normal">(grantee org)</span></label>
            {addingPartner ? (
              <div className="flex gap-2">
                <input type="text" value={newPartnerName} onChange={e => setNewPartnerName(e.target.value)}
                  placeholder="New partner name"
                  className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                <button type="button" disabled={!newPartnerName.trim()}
                  onClick={async () => {
                    const gp = await createGrantPartner(city, newPartnerName);
                    setAllPartners(prev => prev.some(p => p.id === gp.id) ? prev : [...prev, { ...gp, city }]);
                    setGrantPartnerId(gp.id); setNewPartnerName(""); setAddingPartner(false);
                  }}
                  className="px-3 py-2 rounded-lg bg-sky-600 text-white text-sm disabled:opacity-40">Add</button>
                <button type="button" onClick={() => { setAddingPartner(false); setNewPartnerName(""); }} className="px-3 py-2 text-sm text-stone-400">Cancel</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select value={grantPartnerId} onChange={e => setGrantPartnerId(e.target.value)}
                  className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  <option value="">Unassigned</option>
                  {cityPartners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button type="button" onClick={() => setAddingPartner(true)} className="px-3 py-2 rounded-lg border border-stone-300 text-sm text-stone-700 hover:bg-stone-50">+ New</button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Domains</label>
            <div className="grid grid-cols-1 gap-2">
              {cityDomains.map(d => (
                <button key={d.key} type="button" onClick={() => toggle(d.key)}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${selectedDomains.has(d.key) ? "border-sky-500 bg-sky-50" : "border-stone-200 hover:border-stone-300"}`}>
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${selectedDomains.has(d.key) ? "border-sky-500 bg-sky-500" : "border-stone-300"}`}>
                    {selectedDomains.has(d.key) && <span className="text-white text-xs">✓</span>}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-stone-900">{d.label}</div>
                    {d.description && <div className="text-xs text-stone-500">{d.description}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <button type="button" onClick={() => setIncludeCrossCutting(p => !p)}
              className="flex items-center gap-3 w-full p-3 rounded-lg border text-left transition-all border-stone-200 hover:border-stone-300">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${includeCrossCutting ? "border-sky-500 bg-sky-500" : "border-stone-300"}`}>
                {includeCrossCutting && <span className="text-white text-xs">✓</span>}
              </div>
              <div>
                <div className="text-sm font-medium text-stone-900">Include cross-cutting lines</div>
                <div className="text-xs text-stone-500">Admin, travel, and other shared cost lines. Uncheck if this is a single-domain budget that doesn't need them.</div>
              </div>
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Budget period</label>
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
              {PERIOD_PRESETS.map(m => {
                const active = horizonMonths === m && customMonths === "";
                return (
                  <button key={m} type="button"
                    onClick={() => { setHorizonMonths(m); setCustomMonths(""); }}
                    className={`py-2 rounded-lg border text-xs font-medium transition-all ${active ? "border-sky-500 bg-sky-50 text-sky-700" : "border-stone-200 text-stone-700 hover:border-stone-300"}`}>
                    {horizonLabel(m)}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-stone-500">Custom (months, max 60):</label>
              <input type="number" min={1} max={60} value={customMonths}
                onChange={e => {
                  const v = e.target.value;
                  setCustomMonths(v);
                  const n = Math.min(60, Math.max(1, parseInt(v) || 0));
                  if (n > 0) setHorizonMonths(n);
                }}
                placeholder="e.g. 21"
                className="w-24 border border-stone-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              <span className="text-xs text-stone-400">
                → {horizonLabel(horizonMonths)}
                {horizonMonths % 12 !== 0 && (
                  <> · {partialPosition === "start" ? "first" : "final"} year pro-rated to {((horizonMonths % 12) / 12 * 100).toFixed(0)}%</>
                )}
              </span>
            </div>
            {horizonMonths % 12 !== 0 && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-stone-500">Pro-rated stub:</span>
                {(["end", "start"] as const).map(pos => (
                  <button key={pos} type="button" onClick={() => setPartialPosition(pos)}
                    className={`text-xs rounded-full px-3 py-1 border ${partialPosition === pos
                      ? "border-sky-500 bg-sky-50 text-sky-700"
                      : "border-stone-200 text-stone-500 hover:border-stone-300"}`}>
                    {pos === "end" ? "Final year (default)" : "Year 1 (mid-year start)"}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Inflation</label>
            <button type="button" onClick={() => setApplyInflation(p => !p)}
              className="flex items-center gap-3 w-full p-3 rounded-lg border text-left transition-all border-stone-200 hover:border-stone-300">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${applyInflation ? "border-sky-500 bg-sky-500" : "border-stone-300"}`}>
                {applyInflation && <span className="text-white text-xs">✓</span>}
              </div>
              <div>
                <div className="text-sm font-medium text-stone-900">Apply year-on-year inflation</div>
                <div className="text-xs text-stone-500">Salary 10% · Other 5% · Nil 0% per year. Uncheck to keep all year-band unit costs at Y1.</div>
              </div>
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Unit costs & programme ratios</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(["standard", "customize"] as const).map(m => {
                const active = costMode === m;
                return (
                  <button key={m} type="button" onClick={() => setCostMode(m)}
                    className={`p-3 rounded-lg border text-left transition-all ${active ? "border-sky-500 bg-sky-50" : "border-stone-200 hover:border-stone-300"}`}>
                    <div className="text-sm font-medium text-stone-900">
                      {m === "standard" ? "Standard" : "Customize"}
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {m === "standard"
                        ? "Use the cost registry rates for your city."
                        : "Override selected unit costs or ratios for this budget only. The registry stays untouched."}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <button type="button" disabled={!canProceed} onClick={() => setStep(2)}
            className="w-full bg-sky-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed">
            Next: Enter programme scale →
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <button type="button" onClick={() => setStep(1)} className="text-xs text-stone-400 hover:text-stone-700">← Back</button>

          <p className="text-sm text-stone-500">
            Enter the scale of your programme. Only inputs relevant to your selected domains are shown — pick more domains in step 1 to expand this list. Salary rows will be left blank for you to fill.
          </p>

          {/* Multi-partner toggle + manager */}
          <div className="rounded-xl border border-stone-200 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={multiPartner} onChange={e => enableMultiPartner(e.target.checked)} className="mt-1" />
              <span>
                <span className="text-sm font-medium text-stone-900">Split across delivery partners</span>
                <span className="block text-xs text-stone-500">Enter each partner&apos;s own inputs (their share of centres, settlements, staff). Generates a per-partner sheet + a Master roll-up; shared costs are split by the % you set.</span>
              </span>
            </label>

            {multiPartner && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-1 flex-wrap items-center">
                  {partnerList.map((p, i) => (
                    <button key={i} type="button" onClick={() => setActivePartnerIdx(i)}
                      className={`text-xs px-3 py-1 rounded-full border ${activePartnerIdx === i ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-stone-200 text-stone-500 hover:border-stone-300"}`}>
                      {p.name.trim() || `Partner ${i + 1}`}
                    </button>
                  ))}
                  <button type="button" onClick={addPartner} className="text-xs px-3 py-1 rounded-full border border-dashed border-stone-300 text-stone-500 hover:border-stone-400">+ Add partner</button>
                </div>
                {partnerList[activePartnerIdx] && (() => {
                  // Exclude partners already picked by other rows so the same
                  // GrantPartner isn't assigned to two delivery-partner slots.
                  const takenElsewhere = new Set(
                    partnerList.map((p, i) => i === activePartnerIdx ? null : p.grantPartnerId).filter((x): x is string => !!x)
                  );
                  const options = cityPartners.filter(p => !takenElsewhere.has(p.id));
                  const isAdding = inlineNewPartnerFor === activePartnerIdx;
                  return (
                    <div className="flex flex-wrap items-end gap-3 bg-stone-50 rounded-lg p-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-stone-500">Partner</span>
                        {isAdding ? (
                          <div className="flex gap-1">
                            <input type="text" autoFocus value={inlineNewPartnerName}
                              onChange={e => setInlineNewPartnerName(e.target.value)}
                              placeholder={`New partner (${city})`}
                              className="w-48 border border-stone-300 rounded px-2 py-1 text-sm" />
                            <button type="button" disabled={!inlineNewPartnerName.trim()}
                              onClick={() => createInlinePartner(activePartnerIdx)}
                              className="px-2 py-1 rounded bg-sky-600 text-white text-xs disabled:opacity-40">Add</button>
                            <button type="button"
                              onClick={() => { setInlineNewPartnerFor(null); setInlineNewPartnerName(""); }}
                              className="px-2 py-1 text-xs text-stone-400">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <select value={partnerList[activePartnerIdx].grantPartnerId ?? ""}
                              onChange={e => pickPartner(activePartnerIdx, e.target.value)}
                              className="w-48 border border-stone-300 rounded px-2 py-1 text-sm">
                              <option value="">Select partner…</option>
                              {options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <button type="button"
                              onClick={() => { setInlineNewPartnerFor(activePartnerIdx); setInlineNewPartnerName(""); }}
                              className="px-2 py-1 rounded border border-stone-300 text-xs text-stone-700 hover:bg-stone-50">+ New</button>
                          </div>
                        )}
                      </div>
                      <label className="text-xs text-stone-500">Shared-cost %
                        <input type="number" min={0} max={100} value={partnerList[activePartnerIdx].sharedPct || ""}
                          onChange={e => patchPartner(activePartnerIdx, { sharedPct: parseFloat(e.target.value) || 0 })}
                          className="block mt-0.5 w-24 border border-stone-300 rounded px-2 py-1 text-sm text-right" />
                      </label>
                      {partnerList.length > 2 && (
                        <button type="button" onClick={() => removePartner(activePartnerIdx)} className="text-xs text-red-500 hover:text-red-700 pb-1">Remove</button>
                      )}
                      <span className={`text-xs pb-1 ml-auto ${sharedPctSum === 100 ? "text-stone-400" : "text-amber-600"}`}>Shared % total: {sharedPctSum}%{sharedPctSum !== 100 ? " (normalised)" : ""}</span>
                    </div>
                  );
                })()}
                <p className="text-xs text-emerald-700">Editing inputs for <strong>{partnerList[activePartnerIdx]?.name || "—"}</strong>. The fields below apply to this partner only.</p>
              </div>
            )}
          </div>

          {visibleCrossCutting.length > 0 && (
            <Section title="Programme scale">
              {visibleCrossCutting.filter(f => !enumManagedKeys.has(f.key)).map(f => (
                <Field key={f.key} label={f.label} value={currentInputs[f.key] ?? 0} onChange={setNum(f.key)}
                  hint={f.unit !== "count" ? `Unit: ${f.unit}` : undefined} />
              ))}
            </Section>
          )}

          {domainSections().map(({ label, inputs }) => (
            <Section key={label} title={label}>
              {inputs.filter(f => !enumManagedKeys.has(f.key)).map(f => (
                <Field key={f.key} label={f.label} value={currentInputs[f.key] ?? 0} onChange={setNum(f.key)}
                  hint={f.unit !== "count" ? `Unit: ${f.unit}` : undefined} />
              ))}
              {label === "Sanitation Complex" && visibleEnumPickers.map(p => (
                <label key={p.pickerKey} className="block">
                  <span className="text-sm text-stone-700">{p.label}</span>
                  <select
                    value={inferEnumValue(p.pickerKey, currentInputs)}
                    onChange={e => setEnum(p.pickerKey, e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-md border border-stone-200 text-sm focus:border-sky-400 focus:ring-1 focus:ring-sky-400 outline-none"
                  >
                    {p.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              ))}
            </Section>
          ))}

          {costMode === "customize" && customisableGroups.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Costs &amp; ratios (optional)</h3>
                <div className="flex items-center gap-3">
                  {overriddenCount > 0 && (
                    <span className="text-xs text-amber-600">{overriddenCount} overridden</span>
                  )}
                  {overriddenCount > 0 && (
                    <button type="button" onClick={() => setCostOverrides({})}
                      className="text-xs text-stone-400 hover:text-stone-700">Reset all</button>
                  )}
                </div>
              </div>
              <p className="text-xs text-stone-500 mb-2">
                Leave blank to use the standard rate from the cost registry. Edits apply to this budget only.
              </p>
              <div className="space-y-2">
                {customisableGroups.map(g => (
                  <details key={g.domain ?? "cross"} className="bg-stone-50 rounded-lg border border-stone-200 group">
                    <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-stone-700 flex items-center justify-between">
                      <span>{g.label}</span>
                      <span className="text-xs text-stone-400 group-open:hidden">{g.costs.length + g.ratios.length} items</span>
                    </summary>
                    <div className="px-4 pb-3 pt-1 space-y-3">
                      {g.costs.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-1">Unit costs</p>
                          <div className="space-y-1.5">
                            {g.costs.map(c => (
                              <CostField key={c.itemKey} item={c}
                                value={costOverrides[c.itemKey] ?? c.defaultValue}
                                isOverridden={c.itemKey in costOverrides}
                                onChange={v => setOverride(c.itemKey, v, c.defaultValue)} />
                            ))}
                          </div>
                        </div>
                      )}
                      {g.ratios.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-1">Programme ratios</p>
                          <div className="space-y-1.5">
                            {g.ratios.map(c => (
                              <CostField key={c.itemKey} item={c}
                                value={costOverrides[c.itemKey] ?? c.defaultValue}
                                isOverridden={c.itemKey in costOverrides}
                                onChange={v => setOverride(c.itemKey, v, c.defaultValue)} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          {!multiPartnerReady && (
            <p className="text-xs text-amber-600">Pick a registry partner for at least two rows before generating (city: {city}).</p>
          )}
          <button type="button" onClick={submit} disabled={pending || !multiPartnerReady}
            className="w-full bg-sky-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-60">
            {pending ? "Generating budget…" : "Generate budget →"}
          </button>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">{title}</h3>
      <div className="space-y-3 bg-stone-50 rounded-lg p-4">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, hint }: {
  label: string; value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1">
        <label className="block text-sm text-stone-700">{label}</label>
        {hint && <p className="text-xs text-stone-400">{hint}</p>}
      </div>
      <input type="number" value={value || ""} onChange={onChange} min={0}
        className="w-28 border border-stone-300 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-sky-500"
        placeholder="0" />
    </div>
  );
}

function CostField({ item, value, isOverridden, onChange }: {
  item: CostItem;
  value: number;
  isOverridden: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <label className="block text-sm text-stone-700 truncate">{item.label}</label>
        <p className="text-xs text-stone-400">
          {item.unit} · standard {item.defaultValue.toLocaleString("en-IN")}
        </p>
      </div>
      <input type="number" min={0} value={value || ""}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className={`w-28 border rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-1 ${
          isOverridden
            ? "border-amber-400 bg-amber-50 text-amber-900 focus:ring-amber-500"
            : "border-stone-300 focus:ring-sky-500"
        }`}
        placeholder={String(item.defaultValue)} />
      {isOverridden ? (
        <button type="button" onClick={() => onChange(item.defaultValue)}
          className="text-stone-400 hover:text-stone-700 text-xs w-4 shrink-0" title="Reset to standard">↺</button>
      ) : <span className="w-4 shrink-0" />}
    </div>
  );
}
