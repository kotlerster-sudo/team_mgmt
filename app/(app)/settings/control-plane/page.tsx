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
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CpNode | null>(null);

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

  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);

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
          <select value={domain} onChange={(e) => setDomain(e.target.value)} className="px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg bg-white">
            <option value="">All domains</option>
            {(graph?.domains ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={load} className="p-2 border border-stone-200 rounded-lg hover:bg-stone-50" title="Refresh"><RefreshCw className={`w-4 h-4 text-stone-500 ${loading ? "animate-spin" : ""}`} /></button>
        </div>

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
            minHeight={520}
            hint="Read-only · click a node to inspect · editing arrives in the next phase"
          />

          {/* Inspector */}
          <div className="border border-stone-200 rounded-xl bg-white p-4 h-fit lg:sticky lg:top-4">
            {selected ? (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-stone-400">{KIND_STYLE[selected.kind].label}</div>
                <div className="text-sm font-medium text-stone-900">{selected.label}</div>
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
