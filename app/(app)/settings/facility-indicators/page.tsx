"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, Plus, Pencil, Trash2, Check, X, Activity, Cloud, User, ChevronDown, ChevronRight, Star, ListChecks } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

type CaptureSource = "MIS_API" | "RP_ACTIVITY" | "MANUAL_ADMIN";
type Frequency = "Daily" | "Weekly" | "Monthly" | "Quarterly";

type TargetFormula =
  | { type: "fixed"; value: number }
  | { type: "settlement_field"; field: string; multiplier: number }
  | { type: "facility_count"; multiplier: number }
  | { type: "scheme_baseline"; multiplier: number }
  | null;

interface IndicatorDef {
  id: string;
  key: string;
  label: string;
  description: string | null;
  domain: string;
  facilityLayerKey: string | null;
  schemeId: string | null;
  unit: string | null;
  frequency: Frequency;
  color: string;
  targetFormula: TargetFormula;
  captureSource: CaptureSource;
  misProviderId: string | null;
  misFetchConfig: Record<string, unknown> | null;
  staleYellowDays: number;
  staleRedDays: number;
  sortOrder: number;
  isActive: boolean;
}

interface DomainOption { domain: string; label: string; color: string }
interface FacilityLayerOption { id: string; layerKey: string; label: string }
interface SchemeOption { id: string; name: string }
interface ProviderOption { id: string; key: string; label: string }

const POP_FIELDS = [
  { value: "children6m3yr",   label: "Children 6m–3yr" },
  { value: "children4to14",   label: "Children 4–14yr" },
  { value: "youth15to21",     label: "Youth 15–21yr" },
  { value: "elderly60plus",   label: "Elderly 60+" },
  { value: "totalHouseholds", label: "Total Households" },
];

const UNIT_SUGGESTIONS = ["%", "count", "litres", "₹", "days", "households", "meals", "cards"];

const inputCls = "px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white";
const labelCls = "block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5";

const emptyDraft = (): IndicatorDef => ({
  id: "",
  key: "",
  label: "",
  description: "",
  domain: "",
  facilityLayerKey: null,
  schemeId: null,
  unit: "",
  frequency: "Monthly",
  color: "#6366f1",
  targetFormula: null,
  captureSource: "RP_ACTIVITY",
  misProviderId: null,
  misFetchConfig: null,
  staleYellowDays: 45,
  staleRedDays: 90,
  sortOrder: 0,
  isActive: true,
});

const slugifyKey = (label: string) =>
  label.trim().toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

export default function FacilityIndicatorsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super-admin";

  const [indicators, setIndicators] = useState<IndicatorDef[]>([]);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [layers, setLayers] = useState<FacilityLayerOption[]>([]);
  const [schemes, setSchemes] = useState<SchemeOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<IndicatorDef | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filterDomain, setFilterDomain] = useState<string>("");
  const [expandedHelp, setExpandedHelp] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/facility-indicators?all=1");
    if (res.ok) setIndicators(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (session && !isAdmin) router.replace("/settings");
  }, [session, isAdmin, router]);

  useEffect(() => {
    load();
    fetch("/api/needs/formulas").then(r => r.json()).then(setDomains).catch(() => {});
    fetch("/api/admin/facility-layers").then(r => r.json()).then(setLayers).catch(() => {});
    fetch("/api/needs/schemes").then(r => r.ok ? r.json() : []).then(setSchemes).catch(() => {});
    fetch("/api/admin/mis-providers").then(r => r.ok ? r.json() : []).then(setProviders).catch(() => {});
  }, [load]);

  if (!isAdmin) return null;

  const handleSave = async () => {
    if (!edit) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        ...edit,
        key: edit.key || slugifyKey(edit.label),
        unit: edit.unit || null,
        description: edit.description || null,
      };
      const res = edit.id
        ? await fetch(`/api/admin/facility-indicators/${edit.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/facility-indicators", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (res.ok) {
        setEdit(null);
        load();
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to save");
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Deactivate "${label}"? Historical data points are kept.`)) return;
    await fetch(`/api/admin/facility-indicators/${id}`, { method: "DELETE" });
    load();
  };

  const filtered = filterDomain ? indicators.filter(i => i.domain === filterDomain) : indicators;
  const domainsInUse = new Set(indicators.map(i => i.domain));

  return (
    <SurfaceProvider id="settings.facility_indicators">
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/settings" className="text-stone-400 hover:text-stone-600 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold text-stone-900">Layer 2: Facility Indicators</h1>
      </div>

      <button
        onClick={() => setExpandedHelp(v => !v)}
        className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 mb-3"
      >
        {expandedHelp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        About facility indicators
      </button>
      {expandedHelp && (
        <div className="text-xs text-stone-500 mb-6 leading-relaxed bg-stone-50 border border-stone-100 rounded-lg p-3 space-y-2">
          <p>
            Indicators track <strong>state of facilities</strong> (enrollment %, attendance, downtime, saturation)
            over time — separate from Layer 1 (which tracks needs remaining as goals complete).
          </p>
          <p>
            Each indicator is captured from one of three sources: <strong>MIS API</strong> (auto-pulled from
            external systems like Frappe Creche MIS), <strong>RP activity</strong> (recorded when an RP completes
            a specific checklist item), or <strong>manual admin</strong> entry.
          </p>
          <p>
            <strong>Targets</strong> can be a fixed number, a settlement-population formula (e.g. <code>children6m3yr × 0.9</code>),
            or a facility-count formula. Trend-only indicators (e.g. complaint count) need no target.
          </p>
        </div>
      )}

      {/* Domain filter pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setFilterDomain("")}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${!filterDomain ? "bg-stone-800 text-white border-stone-800" : "border-stone-200 text-stone-600 hover:border-stone-300"}`}
        >
          All ({indicators.length})
        </button>
        {domains.filter(d => domainsInUse.has(d.domain)).map(d => (
          <button
            key={d.domain}
            onClick={() => setFilterDomain(d.domain === filterDomain ? "" : d.domain)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors flex items-center gap-1.5 ${filterDomain === d.domain ? "text-white border-transparent" : "border-stone-200 text-stone-600 hover:border-stone-300"}`}
            style={filterDomain === d.domain ? { background: d.color, borderColor: d.color } : {}}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: filterDomain === d.domain ? "white" : d.color }} />
            {d.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-stone-400 text-center py-8">Loading…</p>
      ) : (
        <div className="space-y-2 mb-4">
          {filtered.map((ind) => (
            <div key={ind.id}>
              {edit?.id === ind.id ? (
                <IndicatorForm
                  draft={edit}
                  setDraft={setEdit}
                  domains={domains}
                  layers={layers}
                  schemes={schemes}
                  providers={providers}
                  onSave={handleSave}
                  onCancel={() => { setEdit(null); setError(""); }}
                  saving={saving}
                  error={error}
                />
              ) : (
                <IndicatorRow
                  indicator={ind}
                  domains={domains}
                  providers={providers}
                  onEdit={() => setEdit({ ...ind })}
                  onDelete={() => handleDelete(ind.id, ind.label)}
                />
              )}
            </div>
          ))}
          {filtered.length === 0 && !edit && (
            <p className="text-sm text-stone-400 italic text-center py-8">
              {indicators.length === 0 ? "No indicators yet." : "No indicators in this domain."}
            </p>
          )}
        </div>
      )}

      {edit && !edit.id ? (
        <IndicatorForm
          draft={edit}
          setDraft={setEdit}
          domains={domains}
          layers={layers}
          schemes={schemes}
          providers={providers}
          onSave={handleSave}
          onCancel={() => { setEdit(null); setError(""); }}
          saving={saving}
          error={error}
          isNew
        />
      ) : (
        <button
          onClick={() => {
            const draft = emptyDraft();
            draft.sortOrder = indicators.length;
            if (filterDomain) draft.domain = filterDomain;
            setEdit(draft);
          }}
          className="flex items-center gap-2 w-full px-4 py-3 border-2 border-dashed border-stone-200 rounded-xl text-sm text-stone-500 hover:border-stone-300 hover:text-stone-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add indicator
        </button>
      )}
    </div>
    </SurfaceProvider>
  );
}

// ── Row (collapsed display) ──────────────────────────────────────────────────

function SourceBadge({ source }: { source: CaptureSource }) {
  if (source === "MIS_API") return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-sky-50 text-sky-700"><Cloud className="w-2.5 h-2.5" /> MIS</span>;
  if (source === "RP_ACTIVITY") return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700"><Activity className="w-2.5 h-2.5" /> RP</span>;
  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-50 text-amber-700"><User className="w-2.5 h-2.5" /> Manual</span>;
}

function IndicatorRow({
  indicator, domains, providers, onEdit, onDelete,
}: {
  indicator: IndicatorDef;
  domains: DomainOption[];
  providers: ProviderOption[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const domain = domains.find(d => d.domain === indicator.domain);
  const provider = providers.find(p => p.id === indicator.misProviderId);
  return (
    <div className={`flex items-start gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl ${!indicator.isActive ? "opacity-50" : ""}`}>
      <span className="w-3 h-3 rounded-full flex-shrink-0 mt-1" style={{ background: indicator.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-stone-800">{indicator.label}</span>
          {indicator.unit && <span className="text-[10px] text-stone-400">{indicator.unit}</span>}
          <SourceBadge source={indicator.captureSource} />
          {provider && <span className="text-[10px] text-sky-600">{provider.label}</span>}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <code className="text-[10px] text-stone-400 font-mono">{indicator.key}</code>
          {domain && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${domain.color}15`, color: domain.color }}>
              {domain.label}
            </span>
          )}
          <span className="text-[10px] text-stone-400">{indicator.frequency}</span>
          {indicator.targetFormula && (
            <span className="text-[10px] text-stone-500">target: {describeFormula(indicator.targetFormula)}</span>
          )}
        </div>
        {indicator.description && (
          <p className="text-[11px] text-stone-500 mt-1">{indicator.description}</p>
        )}
      </div>
      <div className="flex gap-1 shrink-0">
        <button
          onClick={onEdit}
          className="p-1.5 hover:bg-stone-50 rounded text-stone-400 hover:text-stone-600 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 hover:bg-red-50 rounded text-stone-400 hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function describeFormula(f: TargetFormula): string {
  if (!f) return "—";
  if (f.type === "fixed") return `${f.value}`;
  if (f.type === "settlement_field") return `${f.field} × ${f.multiplier}`;
  if (f.type === "facility_count") return `facilities × ${f.multiplier}`;
  if (f.type === "scheme_baseline") return `scheme × ${f.multiplier}`;
  return "—";
}

// ── Form (edit/new) ──────────────────────────────────────────────────────────

function IndicatorForm({
  draft, setDraft, domains, layers, schemes, providers, onSave, onCancel, saving, error, isNew = false,
}: {
  draft: IndicatorDef;
  setDraft: (d: IndicatorDef) => void;
  domains: DomainOption[];
  layers: FacilityLayerOption[];
  schemes: SchemeOption[];
  providers: ProviderOption[];
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
  isNew?: boolean;
}) {
  const formula = draft.targetFormula;
  const formulaType = formula?.type ?? "none";

  // Editable capture-source labels (de-hardcoded via EnumLabelConfig; fallback to built-ins).
  const [sourceLabels, setSourceLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/enum-labels?enumKey=FacilityIndicatorSource")
      .then((r) => r.json())
      .then((rows: { code: string; label: string }[]) => setSourceLabels(Object.fromEntries((rows ?? []).map((r) => [r.code, r.label]))))
      .catch(() => {});
  }, []);
  const sourceLabel = (s: string) => sourceLabels[s] ?? (s === "MIS_API" ? "MIS API" : s === "RP_ACTIVITY" ? "RP Activity" : "Manual Admin");

  const setFormulaType = (t: string) => {
    if (t === "none") setDraft({ ...draft, targetFormula: null });
    else if (t === "fixed") setDraft({ ...draft, targetFormula: { type: "fixed", value: 0 } });
    else if (t === "settlement_field") setDraft({ ...draft, targetFormula: { type: "settlement_field", field: "children6m3yr", multiplier: 1 } });
    else if (t === "facility_count") setDraft({ ...draft, targetFormula: { type: "facility_count", multiplier: 1 } });
    else if (t === "scheme_baseline") setDraft({ ...draft, targetFormula: { type: "scheme_baseline", multiplier: 1 } });
  };

  return (
    <div className={`border rounded-xl p-4 space-y-3 ${isNew ? "bg-sky-50 border-sky-200" : "bg-stone-50 border-stone-200"}`}>
      {/* Top row: label + key + color */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className={labelCls}>Label</label>
          <input
            autoFocus
            className={inputCls + " w-full"}
            value={draft.label}
            onChange={e => {
              const newLabel = e.target.value;
              const autoKey = slugifyKey(newLabel);
              setDraft({ ...draft, label: newLabel, key: draft.key && !isNew ? draft.key : autoKey });
            }}
            placeholder="e.g. Creche enrollment %"
          />
        </div>
        <div className="w-48">
          <label className={labelCls}>Key</label>
          <input
            className={inputCls + " w-full font-mono text-xs"}
            value={draft.key}
            onChange={e => setDraft({ ...draft, key: e.target.value.replace(/[^a-z0-9_]/g, "_").toLowerCase() })}
            placeholder="creche_enrollment_pct"
          />
        </div>
        <div>
          <label className={labelCls}>Color</label>
          <input
            type="color"
            className="h-[34px] w-10 rounded-lg border border-stone-200 cursor-pointer p-0.5 bg-white"
            value={draft.color}
            onChange={e => setDraft({ ...draft, color: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Description (optional)</label>
        <input
          className={inputCls + " w-full"}
          value={draft.description ?? ""}
          onChange={e => setDraft({ ...draft, description: e.target.value })}
          placeholder="What this indicator measures and why it matters"
        />
      </div>

      {/* Domain + facility layer + scheme + unit + frequency */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className={labelCls}>Needs Domain *</label>
          <select
            className={inputCls + " w-full"}
            value={draft.domain}
            onChange={e => setDraft({ ...draft, domain: e.target.value })}
          >
            <option value="">— Select —</option>
            {domains.map(d => <option key={d.domain} value={d.domain}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Facility Layer</label>
          <select
            className={inputCls + " w-full"}
            value={draft.facilityLayerKey ?? ""}
            onChange={e => setDraft({ ...draft, facilityLayerKey: e.target.value || null })}
          >
            <option value="">— Any —</option>
            {layers.map(l => <option key={l.layerKey} value={l.layerKey}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Unit</label>
          <input
            className={inputCls + " w-full"}
            value={draft.unit ?? ""}
            onChange={e => setDraft({ ...draft, unit: e.target.value })}
            placeholder="%"
            list="indicator-units"
          />
          <datalist id="indicator-units">
            {UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}
          </datalist>
        </div>
        <div>
          <label className={labelCls}>Frequency</label>
          <select
            className={inputCls + " w-full"}
            value={draft.frequency}
            onChange={e => setDraft({ ...draft, frequency: e.target.value as Frequency })}
          >
            <option value="Daily">Daily</option>
            <option value="Weekly">Weekly</option>
            <option value="Monthly">Monthly</option>
            <option value="Quarterly">Quarterly</option>
          </select>
        </div>
      </div>

      {/* Target formula */}
      <div className="border border-stone-200 rounded-lg p-3 bg-white space-y-2">
        <label className={labelCls}>Target Formula</label>
        <div className="flex flex-wrap gap-1.5">
          {(["none", "fixed", "settlement_field", "facility_count", "scheme_baseline"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setFormulaType(t)}
              className={`px-2.5 py-1 text-xs rounded-full border ${formulaType === t ? "bg-stone-800 text-white border-stone-800" : "border-stone-200 text-stone-600 hover:border-stone-300"}`}
            >
              {t === "none" ? "Trend only" : t === "fixed" ? "Fixed number" : t === "settlement_field" ? "Settlement population" : t === "facility_count" ? "Facility count" : "Scheme baseline"}
            </button>
          ))}
        </div>
        {formula?.type === "fixed" && (
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className={labelCls}>Value</label>
              <input
                type="number"
                className={inputCls + " w-full"}
                value={formula.value}
                onChange={e => setDraft({ ...draft, targetFormula: { type: "fixed", value: Number(e.target.value) } })}
              />
            </div>
          </div>
        )}
        {formula?.type === "settlement_field" && (
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className={labelCls}>Population field</label>
              <select
                className={inputCls + " w-full"}
                value={formula.field}
                onChange={e => setDraft({ ...draft, targetFormula: { ...formula, field: e.target.value } })}
              >
                {POP_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="w-32">
              <label className={labelCls}>× Multiplier</label>
              <input
                type="number"
                step="0.01"
                className={inputCls + " w-full"}
                value={formula.multiplier}
                onChange={e => setDraft({ ...draft, targetFormula: { ...formula, multiplier: Number(e.target.value) } })}
              />
            </div>
          </div>
        )}
        {(formula?.type === "facility_count" || formula?.type === "scheme_baseline") && (
          <div className="flex gap-2 items-end">
            <div className="w-32">
              <label className={labelCls}>× Multiplier</label>
              <input
                type="number"
                step="0.01"
                className={inputCls + " w-full"}
                value={formula.multiplier}
                onChange={e => setDraft({ ...draft, targetFormula: { ...formula, multiplier: Number(e.target.value) } })}
              />
            </div>
            <p className="text-[10px] text-stone-400 leading-tight">
              {formula.type === "facility_count" ? "Multiplies count of linked facilities in the settlement." : "Multiplies the per-settlement scheme baseline."}
            </p>
          </div>
        )}
      </div>

      {/* Capture source */}
      <div className="border border-stone-200 rounded-lg p-3 bg-white space-y-2">
        <label className={labelCls}>Capture Source</label>
        <div className="flex flex-wrap gap-1.5">
          {(["MIS_API", "RP_ACTIVITY", "MANUAL_ADMIN"] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setDraft({ ...draft, captureSource: s, misProviderId: s === "MIS_API" ? draft.misProviderId : null })}
              className={`px-2.5 py-1 text-xs rounded-full border flex items-center gap-1 ${draft.captureSource === s ? "bg-stone-800 text-white border-stone-800" : "border-stone-200 text-stone-600 hover:border-stone-300"}`}
            >
              {s === "MIS_API" && <Cloud className="w-3 h-3" />}
              {s === "RP_ACTIVITY" && <Activity className="w-3 h-3" />}
              {s === "MANUAL_ADMIN" && <User className="w-3 h-3" />}
              {sourceLabel(s)}
            </button>
          ))}
        </div>
        {draft.captureSource === "MIS_API" && (
          <div className="space-y-2 pt-1">
            <div>
              <label className={labelCls}>MIS Provider</label>
              <select
                className={inputCls + " w-full"}
                value={draft.misProviderId ?? ""}
                onChange={e => setDraft({ ...draft, misProviderId: e.target.value || null })}
              >
                <option value="">— Select provider —</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {providers.length === 0 && (
                <p className="text-[10px] text-amber-600 mt-1">
                  No providers configured. <Link href="/settings/mis-providers" className="underline">Add one →</Link>
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>Fetch Config (JSON)</label>
              <textarea
                className={inputCls + " w-full font-mono text-xs"}
                rows={3}
                value={draft.misFetchConfig ? JSON.stringify(draft.misFetchConfig, null, 2) : ""}
                onChange={e => {
                  try {
                    setDraft({ ...draft, misFetchConfig: e.target.value ? JSON.parse(e.target.value) : null });
                  } catch {
                    /* parse error — keep raw text in input but don't update draft */
                  }
                }}
                placeholder={`{ "endpoint": "/api/method/...", "valuePath": "data.enrollment_pct", "settlementCodePath": "data.slum_code" }`}
              />
              <p className="text-[10px] text-stone-400 mt-0.5">
                Provider-specific. Frappe example: <code>endpoint</code>, <code>valuePath</code>, <code>settlementCodePath</code>.
              </p>
            </div>
          </div>
        )}
        {draft.captureSource === "RP_ACTIVITY" && (
          draft.id ? (
            <>
              <BindingsPanel defId={draft.id} />
              <ChecklistItemsPanel defId={draft.id} />
            </>
          ) : (
            <p className="text-[10px] text-stone-400 leading-relaxed">
              Save this indicator first, then add bindings to specific checklist items.
            </p>
          )
        )}
      </div>

      {/* Staleness + scheme + active + order */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className={labelCls}>Stale Yellow (days)</label>
          <input
            type="number"
            className={inputCls + " w-full"}
            value={draft.staleYellowDays}
            onChange={e => setDraft({ ...draft, staleYellowDays: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className={labelCls}>Stale Red (days)</label>
          <input
            type="number"
            className={inputCls + " w-full"}
            value={draft.staleRedDays}
            onChange={e => setDraft({ ...draft, staleRedDays: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className={labelCls}>Linked Scheme</label>
          <select
            className={inputCls + " w-full"}
            value={draft.schemeId ?? ""}
            onChange={e => setDraft({ ...draft, schemeId: e.target.value || null })}
          >
            <option value="">— None —</option>
            {schemes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Sort Order</label>
          <input
            type="number"
            className={inputCls + " w-full"}
            value={draft.sortOrder}
            onChange={e => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="flex justify-between items-center pt-1">
        <label className="flex items-center gap-1.5 text-xs text-stone-600">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={e => setDraft({ ...draft, isActive: e.target.checked })}
          />
          Active
        </label>
        <div className="flex gap-2 items-center">
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-lg text-stone-500 hover:bg-stone-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onSave}
            disabled={saving || !draft.label || !draft.domain}
            className="px-3 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 flex items-center gap-1"
          >
            <Check className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bindings panel (RP_ACTIVITY captures) ────────────────────────────────────

interface Binding {
  id: string;
  defId: string;
  templateSlug: string;
  checklistKey: string;
  numericField: string;
  templateName: string | null;
}

interface TemplateChecklistKeys {
  slug: string;
  name: string;
  domain: string | null;
  items: { key: string; text: string; pitstopTitle: string }[];
}

function BindingsPanel({ defId }: { defId: string }) {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [templates, setTemplates] = useState<TemplateChecklistKeys[]>([]);
  const [pickTemplate, setPickTemplate] = useState("");
  const [pickItem, setPickItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [bRes, tRes] = await Promise.all([
      fetch(`/api/admin/facility-indicators/${defId}/bindings`),
      fetch(`/api/admin/template-checklist-keys`),
    ]);
    if (bRes.ok) setBindings(await bRes.json());
    if (tRes.ok) setTemplates(await tRes.json());
  }, [defId]);

  useEffect(() => { load(); }, [load]);

  const addBinding = async () => {
    if (!pickTemplate || !pickItem) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/facility-indicators/${defId}/bindings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateSlug: pickTemplate, checklistKey: pickItem }),
      });
      if (res.ok) {
        setPickTemplate("");
        setPickItem("");
        load();
      } else {
        const d = await res.json();
        setError(d.error ?? "Failed to add binding");
      }
    } finally {
      setBusy(false);
    }
  };

  const removeBinding = async (bindingId: string) => {
    if (!confirm("Remove this binding? Historical points are kept.")) return;
    await fetch(`/api/admin/facility-indicators/${defId}/bindings/${bindingId}`, { method: "DELETE" });
    load();
  };

  const templateOptions = templates.filter(t => t.items.length > 0);
  const selectedTpl = templates.find(t => t.slug === pickTemplate);
  const availableItems = selectedTpl?.items.filter(
    i => !bindings.some(b => b.templateSlug === pickTemplate && b.checklistKey === i.key),
  ) ?? [];

  return (
    <div className="border border-stone-200 rounded-lg p-3 bg-stone-50 space-y-2">
      <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">
        Activity Bindings ({bindings.length})
      </div>
      <p className="text-[10px] text-stone-500 leading-relaxed">
        When an RP completes a bound checklist item, a numeric input appears on the completion form and the value is captured as an indicator point.
      </p>

      {bindings.length > 0 && (
        <div className="space-y-1">
          {bindings.map((b) => (
            <div key={b.id} className="flex items-center gap-2 px-2 py-1 bg-white border border-stone-200 rounded">
              <Activity className="w-3 h-3 text-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0 text-xs">
                <span className="font-medium text-stone-700">{b.templateName ?? b.templateSlug}</span>
                <span className="text-stone-400 mx-1.5">·</span>
                <code className="text-[10px] font-mono text-stone-500">{b.checklistKey}</code>
              </div>
              <button
                onClick={() => removeBinding(b.id)}
                className="p-1 hover:bg-red-50 rounded text-stone-400 hover:text-red-500 transition-colors shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 items-end pt-1">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[10px] text-stone-400 mb-0.5">Template</label>
          <select
            className={inputCls + " w-full text-xs"}
            value={pickTemplate}
            onChange={e => { setPickTemplate(e.target.value); setPickItem(""); }}
          >
            <option value="">— Select template —</option>
            {templateOptions.map(t => (
              <option key={t.slug} value={t.slug}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] text-stone-400 mb-0.5">Checklist item</label>
          <select
            className={inputCls + " w-full text-xs"}
            value={pickItem}
            onChange={e => setPickItem(e.target.value)}
            disabled={!pickTemplate}
          >
            <option value="">— Select item —</option>
            {availableItems.map(i => (
              <option key={i.key} value={i.key}>{i.pitstopTitle} · {i.text}</option>
            ))}
          </select>
        </div>
        <button
          onClick={addBinding}
          disabled={!pickTemplate || !pickItem || busy}
          className="px-2.5 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 flex items-center gap-1 shrink-0"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {error && <p className="text-[10px] text-red-500">{error}</p>}
      {templateOptions.length === 0 && (
        <p className="text-[10px] text-amber-600">
          No templates have checklist items with stable keys yet. Open a template, save it once to populate keys.
        </p>
      )}
    </div>
  );
}

// ── Scored checklist panel (tick-list defs, e.g. creche 24-point safety) ─────

interface ChecklistItemDefRow {
  id: string;
  defId: string;
  itemKey: string;
  text: string;
  category: string | null;
  nonNegotiable: boolean;
  naAllowed: boolean;
  sortOrder: number;
  isActive: boolean;
}

function ChecklistItemsPanel({ defId }: { defId: string }) {
  const [items, setItems] = useState<ChecklistItemDefRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/facility-indicators/${defId}/checklist-items`);
    if (res.ok) setItems(await res.json());
  }, [defId]);

  useEffect(() => { load(); }, [load]);

  const active = items.filter(i => i.isActive);
  const categories = [...new Set(active.map(i => i.category).filter((c): c is string => !!c))];

  async function saveItem(row: Partial<ChecklistItemDefRow> & { text: string }, itemId?: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        itemId
          ? `/api/admin/facility-indicators/${defId}/checklist-items/${itemId}`
          : `/api/admin/facility-indicators/${defId}/checklist-items`,
        {
          method: itemId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row),
        },
      );
      if (res.ok) {
        setEditingId(null);
        setAdding(false);
        load();
      } else {
        setError((await res.json().catch(() => ({})))?.error ?? "Failed to save item");
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(itemId: string) {
    if (!confirm("Remove this item from the tick-list? Historical answers are kept.")) return;
    await fetch(`/api/admin/facility-indicators/${defId}/checklist-items/${itemId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="border border-stone-200 rounded-lg p-3 bg-stone-50 space-y-2">
      <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1.5">
        <ListChecks className="w-3 h-3" /> Scored checklist ({active.length} items)
      </div>
      <p className="text-[10px] text-stone-500 leading-relaxed">
        When items exist, the RP completion form shows a Yes/No tick-list instead of a number and the
        indicator value = count of compliant items (N/A counts compliant). ★ non-negotiable items
        pre-fill a follow-up action point when failing.
      </p>

      {active.length > 0 && (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {active.map(it =>
            editingId === it.id ? (
              <ChecklistItemEditRow
                key={it.id}
                initial={it}
                categories={categories}
                busy={busy}
                onSave={row => saveItem(row, it.id)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div key={it.id} className="flex items-center gap-2 px-2 py-1 bg-white border border-stone-200 rounded">
                {it.category && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-stone-100 text-stone-500 shrink-0 max-w-[90px] truncate" title={it.category}>
                    {it.category}
                  </span>
                )}
                <span className="flex-1 min-w-0 text-xs text-stone-700 truncate" title={it.text}>{it.text}</span>
                {it.nonNegotiable && <Star className="w-3 h-3 text-amber-500 fill-amber-400 shrink-0" aria-label="Non-negotiable" />}
                {it.naAllowed && <span className="text-[9px] text-stone-400 shrink-0">N/A ok</span>}
                <button
                  onClick={() => { setEditingId(it.id); setAdding(false); }}
                  className="p-1 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-600 transition-colors shrink-0"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => removeItem(it.id)}
                  className="p-1 hover:bg-red-50 rounded text-stone-400 hover:text-red-500 transition-colors shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      {adding ? (
        <ChecklistItemEditRow
          initial={{ text: "", category: active[active.length - 1]?.category ?? null, nonNegotiable: false, naAllowed: false, sortOrder: (active[active.length - 1]?.sortOrder ?? 0) + 1 }}
          categories={categories}
          busy={busy}
          onSave={row => saveItem(row)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          onClick={() => { setAdding(true); setEditingId(null); }}
          className="px-2.5 py-1.5 text-xs rounded-lg text-stone-500 hover:text-stone-700 hover:bg-stone-100 border border-dashed border-stone-300 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add item
        </button>
      )}
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}

function ChecklistItemEditRow({
  initial,
  categories,
  busy,
  onSave,
  onCancel,
}: {
  initial: Partial<ChecklistItemDefRow>;
  categories: string[];
  busy: boolean;
  onSave: (row: { text: string; category: string | null; nonNegotiable: boolean; naAllowed: boolean; sortOrder: number }) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial.text ?? "");
  const [category, setCategory] = useState(initial.category ?? "");
  const [nonNegotiable, setNonNegotiable] = useState(initial.nonNegotiable ?? false);
  const [naAllowed, setNaAllowed] = useState(initial.naAllowed ?? false);
  const [sortOrder, setSortOrder] = useState(initial.sortOrder ?? 0);

  return (
    <div className="px-2 py-2 bg-white border border-sky-200 rounded space-y-1.5">
      <input
        className={inputCls + " w-full text-xs"}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Item text (ticked = compliant)"
        autoFocus
      />
      <div className="flex flex-wrap gap-2 items-center">
        <input
          className={inputCls + " text-xs w-40"}
          value={category}
          onChange={e => setCategory(e.target.value)}
          placeholder="Category"
          list="checklist-item-categories"
        />
        <datalist id="checklist-item-categories">
          {categories.map(c => <option key={c} value={c} />)}
        </datalist>
        <label className="flex items-center gap-1 text-[10px] text-stone-600">
          <input type="checkbox" checked={nonNegotiable} onChange={e => setNonNegotiable(e.target.checked)} />
          ★ non-negotiable
        </label>
        <label className="flex items-center gap-1 text-[10px] text-stone-600">
          <input type="checkbox" checked={naAllowed} onChange={e => setNaAllowed(e.target.checked)} />
          N/A allowed
        </label>
        <label className="flex items-center gap-1 text-[10px] text-stone-600">
          Order
          <input
            type="number"
            className={inputCls + " text-xs w-14"}
            value={sortOrder}
            onChange={e => setSortOrder(Number(e.target.value))}
          />
        </label>
        <div className="flex gap-1 ml-auto">
          <button onClick={onCancel} className="p-1.5 text-xs rounded-lg text-stone-500 hover:bg-stone-100">
            <X className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onSave({ text: text.trim(), category: category.trim() || null, nonNegotiable, naAllowed, sortOrder })}
            disabled={busy || !text.trim()}
            className="px-2 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 flex items-center gap-1"
          >
            <Check className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
