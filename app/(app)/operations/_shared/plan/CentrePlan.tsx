"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow, Background, Controls, MarkerType, type Node, type Edge, type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Pencil, Plus, Loader2 } from "lucide-react";
import { fetchJson } from "@/lib/fetchJson";
import { PROGRESS_TAGS, progressTagColor } from "@/lib/progressTags";
import type { CentrePlan as CentrePlanData, PlanNode as PlanNodeType } from "@/lib/operations/plan";
import { PlanNode } from "./PlanNode";
import { PlanOutline } from "./PlanOutline";
import { ThisWeekPanel } from "./ThisWeekPanel";
import { NodeSheet } from "./NodeSheet";

const nodeTypes = { plan: PlanNode };
const COL_W = 300;
const ROW_H = 150;

/**
 * The setup-centre WBS one-page plan. Desktop: a react-flow canvas — workstreams as columns, nodes
 * stacked by order, dependency arrows across, critical path in red. Mobile / SSR: an indented outline.
 * Editing (toolbar toggle): add nodes, drag handle→handle to create a dependency, select+delete an
 * edge to remove it; per-node edits (rename / workstream / milestone / sub-items / delete) live in the
 * node sheet. Every mutation reuses an existing route then router.refresh() re-derives the plan.
 */
export function CentrePlan({ plan }: { plan: CentrePlanData }) {
  const router = useRouter();
  const [isWide, setIsWide] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTag, setNewTag] = useState<string>(plan.workstreams[0]?.tag ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setIsWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const refresh = useCallback(() => router.refresh(), [router]);
  const onOpen = useCallback((pitstopId: string) => setSelected(pitstopId), []);

  // Drag handle→handle: source is the predecessor (bottom), target depends on it (top).
  const onConnect = useCallback(async (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    await fetchJson(`/api/pitstops/${c.target}/dependencies`, { method: "POST", body: JSON.stringify({ blockedById: c.source }) }).catch(() => {});
    refresh();
  }, [refresh]);

  const onEdgesDelete = useCallback(async (edges: Edge[]) => {
    for (const e of edges) {
      await fetch(`/api/pitstops/${e.target}/dependencies`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blockedById: e.source }) }).catch(() => {});
    }
    refresh();
  }, [refresh]);

  const addNode = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      await fetchJson(`/api/goals/${plan.goalId}/pitstops`, { method: "POST", body: JSON.stringify({ title, progressTag: newTag || null }) });
      setNewTitle(""); setAdding(false); refresh();
    } finally { setBusy(false); }
  }, [newTitle, newTag, plan.goalId, refresh]);

  const { rfNodes, rfEdges } = useMemo(() => {
    const laneCount = Math.max(1, plan.workstreams.length);
    const rowByLane: Record<number, number> = {};
    const nodes: Node[] = [];
    const milestones: { id: string; tag: string; node: PlanNodeType }[] = [];

    for (const w of plan.workstreams) {
      for (const n of w.nodes) {
        if (n.isMilestone) { milestones.push({ id: n.pitstopId, tag: w.tag, node: n }); continue; }
        const row = rowByLane[w.index] ?? 0;
        rowByLane[w.index] = row + 1;
        nodes.push({
          id: n.pitstopId,
          type: "plan",
          position: { x: (w.index - 1) * COL_W, y: row * ROW_H },
          data: { node: n, workstreamTag: w.tag, onOpen } as unknown as Record<string, unknown>,
          draggable: false,
        });
      }
    }
    const maxRows = Math.max(1, ...Object.values(rowByLane), 1);
    milestones.forEach((m, k) => {
      nodes.push({
        id: m.id,
        type: "plan",
        position: { x: ((laneCount - 1) * COL_W) / 2, y: (maxRows + k) * ROW_H + 20 },
        data: { node: m.node, workstreamTag: m.tag, onOpen } as unknown as Record<string, unknown>,
        draggable: false,
      });
    });

    const onPath = new Set(plan.workstreams.flatMap((w) => w.nodes).filter((n) => n.onCriticalPath).map((n) => n.pitstopId));
    const edges: Edge[] = plan.edges.map((e) => {
      const critical = onPath.has(e.from) && onPath.has(e.to);
      return {
        id: `${e.from}-${e.to}`,
        source: e.from,
        target: e.to,
        markerEnd: { type: MarkerType.ArrowClosed, color: critical ? "#ef4444" : "#a8a29e" },
        style: { stroke: critical ? "#ef4444" : "#d6d3d1", strokeWidth: critical ? 2 : 1.5 },
      };
    });
    return { rfNodes: nodes, rfEdges: edges };
  }, [plan, onOpen]);

  return (
    <div className="space-y-3">
      <ThisWeekPanel plan={plan} />

      {/* Legend + edit toolbar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {plan.workstreams.map((w) => (
          <span key={w.tag} className="inline-flex items-center gap-1.5 text-[11px] text-stone-500">
            <span className={`w-2 h-2 rounded-full ${progressTagColor(w.tag).filled}`} />
            {w.index}. {w.label}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {editMode && (
            adding ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNode(); if (e.key === "Escape") setAdding(false); }} placeholder="Node title…" className="px-2 py-1 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-200" />
                <select value={newTag} onChange={(e) => setNewTag(e.target.value)} className="text-xs border border-stone-200 rounded-lg px-1.5 py-1 text-stone-600">
                  <option value="">Ungrouped</option>
                  {[...new Set([...plan.workstreams.map((w) => w.tag).filter((t) => t !== "Ungrouped"), ...PROGRESS_TAGS])].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={addNode} disabled={busy || !newTitle.trim()} className="px-2 py-1 text-sm bg-stone-900 text-white rounded-lg disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}</button>
                <button onClick={() => setAdding(false)} className="text-xs text-stone-400">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-medium text-stone-700 border border-stone-200 rounded-lg px-2.5 py-1.5 hover:bg-stone-50"><Plus className="w-3.5 h-3.5" /> Node</button>
            )
          )}
          <button onClick={() => setEditMode((v) => !v)} className={`inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2.5 py-1.5 border ${editMode ? "bg-sky-600 text-white border-sky-600" : "text-stone-700 border-stone-200 hover:bg-stone-50"}`}>
            <Pencil className="w-3.5 h-3.5" /> {editMode ? "Editing" : "Edit"}
          </button>
        </div>
      </div>
      {editMode && isWide && <p className="text-[11px] text-stone-400">Drag from a node's bottom dot onto another's top dot to add a dependency · select an arrow and press Delete to remove it · click a node to edit its sub-items.</p>}

      {isWide ? (
        <div className="h-[600px] rounded-xl border border-stone-200 bg-stone-50/40">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={editMode}
            nodesDraggable={false}
            elementsSelectable={editMode}
            edgesFocusable={editMode}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
          >
            <Background color="#e7e5e4" gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      ) : (
        <PlanOutline plan={plan} onOpen={onOpen} />
      )}

      {selected && (
        <NodeSheet pitstopId={selected} editable={editMode} onClose={() => setSelected(null)} onChanged={refresh} />
      )}
    </div>
  );
}
