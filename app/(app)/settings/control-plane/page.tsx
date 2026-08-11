"use client";

// Backend Control Plane — a single, navigable graph of the programme configuration
// (templates → checklists → catalog items / indicators / journey outcomes). P1 is read-only and
// surfaces BROKEN string-join edges (orphaned bindings/refs) in red. Later phases make it editable.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ChevronLeft, AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import GraphCanvas, { type GraphNode, type GraphEdge, type NodeStyle } from "@/components/graph/GraphCanvas";
import type { CpGraph, CpNode, CpNodeKind } from "@/lib/controlplane/types";

const KIND_STYLE: Record<CpNodeKind, NodeStyle & { label: string }> = {
  template: { bg: "#ede9fe", border: "#c4b5fd", label: "Goal template" },
  checklist: { bg: "#f1f5f9", border: "#cbd5e1", label: "Checklist item" },
  catalogItem: { bg: "#e0f2fe", border: "#7dd3fc", label: "Catalog item" },
  indicator: { bg: "#dcfce7", border: "#86efac", label: "Facility indicator" },
  journeyOutcome: { bg: "#e0e7ff", border: "#a5b4fc", label: "Journey outcome" },
};

export default function ControlPlanePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super-admin";

  const [graph, setGraph] = useState<CpGraph | null>(null);
  const [domain, setDomain] = useState<string>("");
  const [connectedOnly, setConnectedOnly] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CpNode | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (domain) params.set("domain", domain);
    if (!connectedOnly) params.set("connected", "0");
    const qs = params.toString();
    const res = await fetch(`/api/admin/control-plane/graph${qs ? `?${qs}` : ""}`);
    if (res.ok) setGraph(await res.json());
    setLoading(false);
  }, [domain, connectedOnly]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (session && !isAdmin) router.replace("/settings"); }, [session, isAdmin, router]);
  useEffect(() => { setEditText(selected?.label ?? ""); }, [selected]);

  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);

  const onConnect = useCallback(async (a: string, b: string) => {
    const na = nodeById.get(a); const nb = nodeById.get(b);
    if (!na || !nb) return;
    const ind = [na, nb].find((n) => n.kind === "indicator");
    const anchor = [na, nb].find((n) => n.kind === "checklist" || n.kind === "catalogItem");
    if (!ind || !anchor) { setMsg({ ok: false, text: "Connect a checklist or catalog item to an indicator." }); return; }
    const res = await fetch("/api/admin/control-plane/binding", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ indicatorDefId: ind.id.replace(/^ind:/, ""), anchorNodeId: anchor.id }),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: `Bound "${anchor.label}" → ${ind.label}` } : { ok: false, text: data.error ?? "Failed to bind" });
    await load();
  }, [nodeById, load]);

  const saveNodeText = useCallback(async (nodeId: string, text: string) => {
    const res = await fetch("/api/admin/control-plane/node", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId, text }),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: data.error ?? "Failed to save" });
    if (res.ok) await load();
  }, [load]);

  const onDeleteEdge = useCallback(async (edgeId: string) => {
    if (!edgeId.startsWith("e:bind:")) { setMsg({ ok: false, text: "Only indicator bindings can be removed here." }); return; }
    if (!confirm("Remove this indicator binding?")) return;
    await fetch("/api/admin/control-plane/binding", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bindingId: edgeId.slice("e:bind:".length) }),
    });
    setMsg({ ok: true, text: "Binding removed" });
    await load();
  }, [load]);

  if (!isAdmin) return null;

  const gNodes: GraphNode[] = (graph?.nodes ?? []).map((n) => ({
    id: n.id,
    label: n.label,
    sublabel: n.sublabel,
    kind: n.kind,
    status: KIND_STYLE[n.kind].label,
    broken: n.broken,
  }));
  const gEdges: GraphEdge[] = (graph?.edges ?? []).map((e) => ({ id: e.id, from: e.from, to: e.to, broken: e.broken }));

  return (
    <SurfaceProvider id="settings.index">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/settings" className="text-stone-400 hover:text-stone-600"><ChevronLeft className="w-5 h-5" /></Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-stone-900">Backend Control Plane</h1>
            <p className="text-xs text-stone-400">The live programme graph — templates, checklists, catalog items, indicators & journey outcomes.</p>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-stone-500 cursor-pointer select-none">
            <input type="checkbox" checked={connectedOnly} onChange={(e) => setConnectedOnly(e.target.checked)} className="accent-stone-700" />
            Connected only
          </label>
          <button
            onClick={() => { setEditMode((v) => !v); setMsg(null); }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${editMode ? "bg-stone-900 text-white border-stone-900" : "text-stone-600 border-stone-200 hover:bg-stone-50"}`}
          >
            {editMode ? "Editing" : "Edit"}
          </button>
          <select value={domain} onChange={(e) => setDomain(e.target.value)} className="px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg bg-white">
            <option value="">All domains</option>
            {(graph?.domains ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={load} className="p-2 border border-stone-200 rounded-lg hover:bg-stone-50" title="Refresh"><RefreshCw className={`w-4 h-4 text-stone-500 ${loading ? "animate-spin" : ""}`} /></button>
        </div>

        {editMode && (
          <div className="mb-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            Editing on — drag from a checklist/catalog item&apos;s right handle onto an indicator to bind it; click a binding edge to remove it. Structural edges can&apos;t be changed here.
          </div>
        )}
        {msg && (
          <div className={`mb-2 px-4 py-2 rounded-xl text-sm border ${msg.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>
            {msg.text}
          </div>
        )}
        {graph && graph.brokenCount > 0 && (
          <div className="mb-3 flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span><b>{graph.brokenCount}</b> broken connection{graph.brokenCount === 1 ? "" : "s"} — a binding/ref points at a checklist key that no longer exists. Shown in red.</span>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mb-3 text-[11px] text-stone-500">
          {Object.entries(KIND_STYLE).map(([k, s]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded" style={{ background: s.bg, border: `1.5px solid ${s.border}` }} />
              {s.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded border-[1.5px] border-red-500 bg-red-50" /> broken</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3">
          <GraphCanvas
            nodes={gNodes}
            edges={gEdges}
            nodeStyle={(n) => KIND_STYLE[n.kind as CpNodeKind] ?? { bg: "#fafaf9", border: "#d6d3d1" }}
            onSelectNode={(id) => setSelected(nodeById.get(id) ?? null)}
            selectedId={selected?.id}
            onConnect={editMode ? onConnect : undefined}
            onDeleteEdge={editMode ? onDeleteEdge : undefined}
            minHeight={520}
            hint={editMode ? "Drag a checklist/catalog handle onto an indicator to bind · click a binding edge to remove" : "Click a node to inspect · toggle Edit to wire bindings"}
          />

          {/* Inspector */}
          <div className="border border-stone-200 rounded-xl bg-white p-4 h-fit lg:sticky lg:top-4">
            {selected ? (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-stone-400">{KIND_STYLE[selected.kind].label}</div>
                {editMode ? (
                  <div className="space-y-1.5">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={2}
                      className="w-full px-2 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white resize-none"
                    />
                    <button
                      onClick={() => saveNodeText(selected.id, editText)}
                      disabled={!editText.trim() || editText.trim() === selected.label}
                      className="px-3 py-1 text-xs font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-40"
                    >
                      Save text
                    </button>
                  </div>
                ) : (
                  <div className="text-sm font-medium text-stone-900">{selected.label}</div>
                )}
                {selected.sublabel && <div className="text-xs text-stone-500">{selected.sublabel}</div>}
                {selected.domain && <div className="text-[11px] text-stone-400">domain: {selected.domain}</div>}
                {selected.broken && <div className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Referenced but missing from its template — fix the binding or restore the checklist key.</div>}
                {selected.href && (
                  <a href={selected.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-600 hover:text-sky-800 pt-1">
                    Open editor <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ) : (
              <p className="text-xs text-stone-400">Click a node to inspect it and jump to its editor.</p>
            )}
          </div>
        </div>
      </div>
    </SurfaceProvider>
  );
}
