"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ChevronLeft, Plus, Trash2, ChevronUp, ChevronDown, GripVertical, Save,
  AlertTriangle, CheckCircle, ChevronRight,
} from "lucide-react";
import { slugifyChecklistText } from "@/lib/templateDb";
import type { CatalogCategory, CatalogItem } from "@/lib/catalogDb";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

const COMPLETION_TYPES = [
  { value: "", label: "Checkbox" },
  { value: "Activity", label: "Activity" },
  { value: "Voice", label: "Voice note" },
  { value: "Upload", label: "Upload" },
];
const CADENCE_PERIODS = [
  { value: "", label: "— none —" },
  { value: "month", label: "per month" },
  { value: "week", label: "per week" },
];

const inputCls =
  "w-full px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white";

function move<T>(arr: T[], from: number, to: number): T[] {
  const out = [...arr];
  const [el] = out.splice(from, 1);
  out.splice(to, 0, el);
  return out;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function blankItem(): CatalogItem {
  return { key: "", text: "", completionType: "Activity", blocksSignoff: true };
}
function blankCategory(): CatalogCategory {
  return { key: "", label: "New category", items: [] };
}

type CatalogState = {
  id?: string;
  slug: string;
  name: string;
  needsDomain: string | null;
  categories: CatalogCategory[];
  defaultCadenceCount: number | null;
  defaultCadencePeriod: string | null;
  isActive: boolean;
};

// ── Category editor ──────────────────────────────────────────────────────────

function CategoryEditor({
  category, index, total, onChange, onRemove, onMove,
}: {
  category: CatalogCategory;
  index: number;
  total: number;
  onChange: (c: CatalogCategory) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(true);
  const update = (patch: Partial<CatalogCategory>) => onChange({ ...category, ...patch });
  const items = category.items ?? [];

  const addItem = () => update({ items: [...items, blankItem()] });
  const removeItem = (i: number) => update({ items: items.filter((_, idx) => idx !== i) });
  const updateItem = (i: number, patch: Partial<CatalogItem>) =>
    update({ items: items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  const moveItem = (i: number, dir: -1 | 1) => update({ items: move(items, i, i + dir) });

  const mandatoryCount = items.filter((i) => i.blocksSignoff).length;

  return (
    <div className="border border-stone-200 rounded-xl bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <GripVertical className="w-4 h-4 text-stone-300 shrink-0" />
        <button className="flex-1 text-left min-w-0" onClick={() => setOpen((v) => !v)}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-stone-800 truncate">{category.label || "Untitled"}</span>
            <span className="text-xs text-stone-400 shrink-0 ml-auto">
              {items.length} items{mandatoryCount > 0 ? ` · ${mandatoryCount} required` : ""}
            </span>
          </div>
        </button>
        <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1 hover:bg-stone-100 rounded disabled:opacity-30">
          <ChevronUp className="w-3.5 h-3.5 text-stone-400" />
        </button>
        <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1 hover:bg-stone-100 rounded disabled:opacity-30">
          <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
        </button>
        <button onClick={onRemove} className="p-1 hover:bg-red-50 rounded text-stone-400 hover:text-red-500 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setOpen((v) => !v)} className="p-1 hover:bg-stone-100 rounded">
          <ChevronRight className={`w-3.5 h-3.5 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="border-t border-stone-100 px-4 pb-4 pt-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Category label">
                <input className={inputCls} value={category.label} onChange={(e) => update({ label: e.target.value })} />
              </Field>
            </div>
            <div className="flex items-end">
              <div className="flex items-center gap-1.5 w-full">
                <span className="text-[10px] uppercase tracking-wider text-stone-400 shrink-0">Key</span>
                <input
                  className="flex-1 px-2 py-1 text-[11px] font-mono border border-stone-200 rounded bg-white text-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-300"
                  value={category.key ?? ""}
                  onChange={(e) => update({ key: e.target.value.replace(/\s/g, "") })}
                  placeholder={slugifyChecklistText(category.label) || "auto"}
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-stone-500">Items</span>
              <button onClick={addItem} className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 transition-colors">
                <Plus className="w-3 h-3" /> Add item
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="border border-stone-200 rounded-lg bg-stone-50 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => moveItem(i, -1)} disabled={i === 0} className="p-0.5 hover:bg-stone-200 rounded disabled:opacity-30 shrink-0">
                      <ChevronUp className="w-3 h-3 text-stone-400" />
                    </button>
                    <button onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} className="p-0.5 hover:bg-stone-200 rounded disabled:opacity-30 shrink-0">
                      <ChevronDown className="w-3 h-3 text-stone-400" />
                    </button>
                    <input
                      className="flex-1 px-2.5 py-1 text-sm border border-stone-200 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white"
                      value={item.text}
                      onChange={(e) => updateItem(i, { text: e.target.value })}
                      placeholder="What the RP does (e.g. Check attendance register)"
                    />
                    <select
                      className="px-1.5 py-1 text-xs border border-stone-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-stone-300 shrink-0"
                      value={item.completionType}
                      onChange={(e) => updateItem(i, { completionType: e.target.value })}
                    >
                      {COMPLETION_TYPES.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
                    </select>
                    <button onClick={() => removeItem(i)} className="p-1 hover:bg-red-50 rounded text-stone-400 hover:text-red-500 transition-colors shrink-0">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 pl-10">
                    <label className="flex items-center gap-1.5 text-[11px] text-stone-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={item.blocksSignoff}
                        onChange={(e) => updateItem(i, { blocksSignoff: e.target.checked })}
                        className="accent-stone-700"
                      />
                      Mandatory to close the visit
                    </label>
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span className="text-[9px] uppercase tracking-wider text-stone-400 shrink-0">Key</span>
                      <input
                        className="flex-1 px-2 py-0.5 text-[10px] font-mono border border-stone-200 rounded bg-white text-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-300"
                        value={item.key ?? ""}
                        onChange={(e) => updateItem(i, { key: e.target.value.replace(/\s/g, "") })}
                        placeholder={slugifyChecklistText(item.text) || "auto"}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {items.length === 0 && <p className="text-xs text-stone-400 italic">No items yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function CatalogEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "new";

  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super-admin";

  const [cat, setCat] = useState<CatalogState>({
    slug: "",
    name: "",
    needsDomain: null,
    categories: [],
    defaultCadenceCount: null,
    defaultCadencePeriod: null,
    isActive: true,
  });
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [needsDomains, setNeedsDomains] = useState<{ domain: string; label: string }[]>([]);

  useEffect(() => {
    fetch("/api/needs/formulas")
      .then((r) => r.json())
      .then((rows: { domain: string; label: string }[]) => setNeedsDomains(rows))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    const res = await fetch(`/api/admin/catalogs/${id}`);
    if (res.ok) setCat(await res.json());
    setLoading(false);
  }, [id, isNew]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (session && !isAdmin) router.replace("/settings"); }, [session, isAdmin, router]);
  if (!isAdmin) return null;

  const categories = cat.categories ?? [];
  const updateCategory = (i: number, c: CatalogCategory) =>
    setCat((s) => ({ ...s, categories: categories.map((x, idx) => (idx === i ? c : x)) }));
  const removeCategory = (i: number) =>
    setCat((s) => ({ ...s, categories: categories.filter((_, idx) => idx !== i) }));
  const moveCategory = (i: number, dir: -1 | 1) =>
    setCat((s) => ({ ...s, categories: move(categories, i, i + dir) }));
  const addCategory = () =>
    setCat((s) => ({ ...s, categories: [...categories, blankCategory()] }));

  const handleSave = async () => {
    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch(isNew ? "/api/admin/catalogs" : `/api/admin/catalogs/${id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cat),
      });
      if (res.ok) {
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 3000);
        if (isNew) {
          const data = await res.json();
          router.replace(`/settings/catalogs/${data.id}`);
        }
      } else {
        let msg = `Failed to save (HTTP ${res.status})`;
        try { const d = await res.json(); if (d?.error) msg = d.error; } catch {}
        setErrorMsg(msg);
        setStatus("error");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? `Network error: ${err.message}` : "Network error");
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-10 text-sm text-stone-400 text-center">Loading…</div>;
  }

  return (
    <SurfaceProvider id="settings.catalog_detail">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/settings/catalogs" className="text-stone-400 hover:text-stone-600 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-stone-900 truncate">
              {isNew ? "New Catalog" : cat.name || "Edit Catalog"}
            </h1>
            {!isNew && cat.slug && <p className="text-xs text-stone-400 font-mono">{cat.slug}</p>}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : status === "saved" ? <CheckCircle className="w-4 h-4 text-emerald-300" />
              : <Save className="w-4 h-4" />}
            {saving ? "Saving…" : status === "saved" ? "Saved" : "Save"}
          </button>
        </div>

        {status === "error" && (
          <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {errorMsg}
          </div>
        )}

        {/* Info */}
        <div className="space-y-4 mb-8">
          <Field label="Name">
            <input
              className={inputCls}
              value={cat.name}
              onChange={(e) => setCat((s) => ({ ...s, name: e.target.value }))}
              placeholder="e.g. Creche visit catalog"
            />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Programme domain">
              <select
                className={inputCls}
                value={cat.needsDomain ?? ""}
                onChange={(e) => setCat((s) => ({ ...s, needsDomain: e.target.value || null }))}
              >
                <option value="">— none —</option>
                {needsDomains.map((d) => <option key={d.domain} value={d.domain}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="Default cadence — count">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={cat.defaultCadenceCount ?? ""}
                onChange={(e) => setCat((s) => ({ ...s, defaultCadenceCount: e.target.value ? Number(e.target.value) : null }))}
                placeholder="e.g. 1"
              />
            </Field>
            <Field label="Default cadence — period">
              <select
                className={inputCls}
                value={cat.defaultCadencePeriod ?? ""}
                onChange={(e) => setCat((s) => ({ ...s, defaultCadencePeriod: e.target.value || null }))}
              >
                {CADENCE_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
          </div>
          <p className="text-xs text-stone-400 -mt-2">
            Cadence = how many visits a live centre needs per period. Seeded onto the centre at go-live; overridable per centre.
          </p>

          {isNew && (
            <Field label="Slug (URL-safe, unique)">
              <input
                className={inputCls + " font-mono"}
                value={cat.slug}
                onChange={(e) => setCat((s) => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
                placeholder="e.g. creche-visit-catalog"
              />
              <p className="text-xs text-stone-400 mt-1">Cannot be changed after creation.</p>
            </Field>
          )}
        </div>

        {/* Categories */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">Categories</span>
            <span className="text-xs text-stone-400">{categories.length} total</span>
          </div>
          {categories.map((c, i) => (
            <CategoryEditor
              key={i}
              category={c}
              index={i}
              total={categories.length}
              onChange={(updated) => updateCategory(i, updated)}
              onRemove={() => removeCategory(i)}
              onMove={(dir) => moveCategory(i, dir)}
            />
          ))}
          {categories.length === 0 && (
            <p className="text-sm text-stone-400 italic text-center py-8">No categories yet. Add one below.</p>
          )}
          <button
            onClick={addCategory}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-stone-200 rounded-xl text-sm text-stone-500 hover:border-stone-300 hover:text-stone-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add category
          </button>
        </div>
      </div>
    </SurfaceProvider>
  );
}
