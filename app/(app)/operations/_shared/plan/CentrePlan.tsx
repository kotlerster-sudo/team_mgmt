"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow, Background, Controls, MarkerType, type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { progressTagColor } from "@/lib/progressTags";
import type { CentrePlan as CentrePlanData } from "@/lib/operations/plan";
import { PlanNode } from "./PlanNode";
import { PlanOutline } from "./PlanOutline";
import { ThisWeekPanel } from "./ThisWeekPanel";

const nodeTypes = { plan: PlanNode };
const COL_W = 300;
const ROW_H = 150;

/**
 * The setup-centre WBS one-page plan. Desktop: a react-flow canvas — workstreams as columns,
 * nodes stacked by order, dependency arrows across, critical path in red. Mobile / SSR: an indented
 * outline (same data). ThisWeekPanel on top mirrors the mock's critical-path summary.
 */
export function CentrePlan({ plan }: { plan: CentrePlanData }) {
  const router = useRouter();
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setIsWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Slice 3: clicking a node opens the existing pitstop detail (inline sheet lands in slice 4).
  const onOpen = useCallback((pitstopId: string) => {
    router.push(`/goals/${plan.goalId}/pitstops/${pitstopId}`);
  }, [router, plan.goalId]);

  const { rfNodes, rfEdges } = useMemo(() => {
    const laneCount = Math.max(1, plan.workstreams.length);
    const rowByLane: Record<number, number> = {};
    const nodes: Node[] = [];
    const milestones: { id: string; tag: string; node: import("@/lib/operations/plan").PlanNode }[] = [];

    for (const w of plan.workstreams) {
      for (const n of w.nodes) {
        if (n.isMilestone) { milestones.push({ id: n.pitstopId, tag: w.tag, node: n }); continue; }
        const row = rowByLane[w.index] ?? 0;
        rowByLane[w.index] = row + 1;
        nodes.push({
          id: n.pitstopId,
          type: "plan",
          position: { x: (w.index - 1) * COL_W, y: row * ROW_H },
          data: { node: n, workstreamTag: w.tag, onOpen, editable: false } as unknown as Record<string, unknown>,
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
        data: { node: m.node, workstreamTag: m.tag, onOpen, editable: false } as unknown as Record<string, unknown>,
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

      {/* Workstream legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {plan.workstreams.map((w) => (
          <span key={w.tag} className="inline-flex items-center gap-1.5 text-[11px] text-stone-500">
            <span className={`w-2 h-2 rounded-full ${progressTagColor(w.tag).filled}`} />
            {w.index}. {w.label}
          </span>
        ))}
      </div>

      {isWide ? (
        <div className="h-[600px] rounded-xl border border-stone-200 bg-stone-50/40">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            nodesDraggable={false}
          >
            <Background color="#e7e5e4" gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      ) : (
        <PlanOutline plan={plan} onOpen={onOpen} />
      )}
    </div>
  );
}
