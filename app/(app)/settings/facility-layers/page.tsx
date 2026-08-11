"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

interface FacilityLayer {
  id: string;
  layerKey: string;
  label: string;
  color: string;
  needsDomain: string | null;
  sortOrder: number;
  centreTypes: string[];
}

type EditState = {
  id?: string;
  layerKey: string;
  label: string;
  color: string;
  needsDomain: string;
  sortOrder: number;
  centreTypes: string; // comma-separated in the form
} | null;

const inputCls = "px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white";
const selectCls = inputCls;

export default function FacilityLayersPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super-admin";

  const [layers, setLayers] = useState<FacilityLayer[]>([]);
  const [needsDomains, setNeedsDomains] = useState<{ domain: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<EditState>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/facility-layers");
    if (res.ok) setLayers(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    fetch("/api/needs/formulas")
      .then(r => r.json())
      .then((rows: { domain: string; label: string }[]) => setNeedsDomains(rows))
      .catch(() => {});
  }, [load]);

  useEffect(() => {
    if (session && !isAdmin) router.replace("/settings");
  }, [session, isAdmin, router]);

  if (!isAdmin) return null;

  const handleSave = async () => {
    if (!edit) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        layerKey: edit.layerKey,
        label: edit.label,
        color: edit.color || "#6366f1",
        needsDomain: edit.needsDomain || null,
        sortOrder: edit.sortOrder,
        centreTypes: edit.centreTypes.split(",").map((s) => s.trim()).filter(Boolean),
      };
      const res = edit.id
        ? await fetch(`/api/admin/facility-layers/${edit.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/facility-layers", {
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
    if (!confirm(`Remove "${label}"? Templates using this layer key will still work, but it won't appear in new dropdowns.`)) return;
    await fetch(`/api/admin/facility-layers/${id}`, { method: "DELETE" });
    load();
  };

  function DomainBadge({ domain }: { domain: string | null }) {
    if (!domain) return <span className="text-xs text-stone-300 italic">—</span>;
    const found = needsDomains.find(d => d.domain === domain);
    return <span className="text-xs text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">{found?.label ?? domain}</span>;
  }

  function EditRow({ isNew = false }: { isNew?: boolean }) {
    if (!edit) return null;
    return (
      <div className={`flex items-start gap-2 px-4 py-3 border rounded-xl ${isNew ? "bg-sky-50 border-sky-200" : "bg-stone-50 border-stone-200"}`}>
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5">Layer Key</label>
              <input
                autoFocus={isNew}
                className={inputCls + " w-40 font-mono text-xs"}
                value={edit.layerKey}
                onChange={e => setEdit({ ...edit, layerKey: e.target.value.replace(/\s/g, "_").toLowerCase() })}
                placeholder="layer_key"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5">Display Label</label>
              <input
                autoFocus={!isNew}
                className={inputCls + " w-full"}
                value={edit.label}
                onChange={e => setEdit({ ...edit, label: e.target.value })}
                placeholder="Display label"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5">Colour</label>
              <input
                type="color"
                className="h-[34px] w-10 rounded-lg border border-stone-200 cursor-pointer p-0.5 bg-white"
                value={edit.color || "#6366f1"}
                onChange={e => setEdit({ ...edit, color: e.target.value })}
              />
            </div>
            <div className="w-16">
              <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5">Order</label>
              <input
                type="number"
                className={inputCls + " w-full text-center"}
                value={edit.sortOrder}
                onChange={e => setEdit({ ...edit, sortOrder: Number(e.target.value) })}
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5">Needs Domain (links this facility type to a field-coverage domain)</label>
            <select
              className={selectCls + " w-full"}
              value={edit.needsDomain}
              onChange={e => setEdit({ ...edit, needsDomain: e.target.value })}
            >
              <option value="">— None —</option>
              {needsDomains.map(d => (
                <option key={d.domain} value={d.domain}>{d.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5">Centre-type suggestions (comma-separated — shown in the facility form)</label>
            <input
              className={inputCls + " w-full"}
              value={edit.centreTypes}
              onChange={e => setEdit({ ...edit, centreTypes: e.target.value })}
              placeholder="e.g. Creche, Mini Creche"
            />
          </div>
        </div>
        {error && <span className="text-xs text-red-500 self-center">{error}</span>}
        <div className="flex flex-col gap-1 shrink-0 self-center">
          <button
            onClick={handleSave}
            disabled={saving || !edit.layerKey || !edit.label}
            className="p-1.5 hover:bg-emerald-50 rounded text-emerald-600 disabled:opacity-40 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setEdit(null); setError(""); }}
            className="p-1.5 hover:bg-stone-100 rounded text-stone-400 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <SurfaceProvider id="settings.facility_layers">
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" className="text-stone-400 hover:text-stone-600 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold text-stone-900">Facility Layer Types</h1>
      </div>

      <p className="text-sm text-stone-500 mb-6 leading-relaxed">
        These facility types appear in the template builder&apos;s &ldquo;Linked facility type&rdquo; dropdown,
        the goal creation wizard, and the{" "}
        <Link href="/settings/map-features" className="text-sky-600 hover:underline">Map Features</Link>{" "}
        layer picker. Set a <strong>Needs Domain</strong> to tie a facility to a field-coverage gap
        (e.g. Children Centre → ChildrenCentre domain) so goal counts can be reconciled with assessments.
        The <strong>Layer Key</strong> must match the{" "}
        <code className="bg-stone-100 px-1 rounded text-xs">layerKey</code> values in Map Features.
      </p>

      {loading ? (
        <p className="text-sm text-stone-400 text-center py-8">Loading…</p>
      ) : (
        <div className="space-y-2 mb-4">
          {layers.map((layer) => (
            <div key={layer.id}>
              {edit?.id === layer.id ? (
                <EditRow />
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: layer.color || "#6366f1" }} />
                  <code className="text-xs text-stone-500 font-mono w-36 shrink-0">{layer.layerKey}</code>
                  <span className="text-sm font-medium text-stone-800 flex-1">{layer.label}</span>
                  <DomainBadge domain={layer.needsDomain} />
                  <span className="text-xs text-stone-300 w-8 text-center">{layer.sortOrder}</span>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => setEdit({
                        id: layer.id,
                        layerKey: layer.layerKey,
                        label: layer.label,
                        color: layer.color || "#6366f1",
                        needsDomain: layer.needsDomain ?? "",
                        sortOrder: layer.sortOrder,
                        centreTypes: (layer.centreTypes ?? []).join(", "),
                      })}
                      className="p-1.5 hover:bg-stone-50 rounded text-stone-400 hover:text-stone-600 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(layer.id, layer.label)}
                      className="p-1.5 hover:bg-red-50 rounded text-stone-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {layers.length === 0 && !edit && (
            <p className="text-sm text-stone-400 italic text-center py-8">No facility types yet.</p>
          )}
        </div>
      )}

      {edit && !edit.id ? (
        <EditRow isNew />
      ) : (
        <button
          onClick={() => setEdit({ layerKey: "", label: "", color: "#6366f1", needsDomain: "", sortOrder: layers.length, centreTypes: "" })}
          className="flex items-center gap-2 w-full px-4 py-3 border-2 border-dashed border-stone-200 rounded-xl text-sm text-stone-500 hover:border-stone-300 hover:text-stone-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add facility type
        </button>
      )}
    </div>
    </SurfaceProvider>
  );
}
