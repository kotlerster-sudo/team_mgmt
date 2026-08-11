"use client";

// Thin wrapper over the shared <GraphCanvas>. Maps programme phases/edges to the generic
// node/edge shape and wires the programme-specific persistence endpoints. All canvas mechanics
// (auto-layout, drag, connect, edge-delete, bezier) live in components/graph/GraphCanvas.tsx.

import { useCallback } from "react";
import GraphCanvas, { type GraphNode, type GraphEdge, type NodeStyle } from "@/components/graph/GraphCanvas";

export type CanvasPhase = {
  id: string;
  label: string;
  goalId: string | null;
  goalTitle: string | null;
  goalStatus: string | null;
  status: string;
  canvasX: number | null;
  canvasY: number | null;
};
export type CanvasEdge = { id: string; fromPhaseId: string; toPhaseId: string; label: string | null };

const STATUS_STYLE: Record<string, NodeStyle> = {
  Planned: { bg: "#f5f5f4", border: "#d6d3d1" },
  Active: { bg: "#e0f2fe", border: "#7dd3fc" },
  Done: { bg: "#dcfce7", border: "#86efac" },
  Skipped: { bg: "#f5f5f4", border: "#d6d3d1" },
};

export default function PhaseCanvas({
  journeyId,
  phases,
  edges,
  onChanged,
}: {
  journeyId: string;
  phases: CanvasPhase[];
  edges: CanvasEdge[];
  onChanged: () => void;
}) {
  const nodes: GraphNode[] = phases.map((p) => ({
    id: p.id,
    label: p.label,
    sublabel: p.goalTitle,
    kind: "phase",
    status: p.status,
    canvasX: p.canvasX,
    canvasY: p.canvasY,
  }));
  const graphEdges: GraphEdge[] = edges.map((e) => ({ id: e.id, from: e.fromPhaseId, to: e.toPhaseId, label: e.label }));

  const onMoveNode = useCallback(async (id: string, x: number, y: number) => {
    await fetch(`/api/programmes/${journeyId}/phases/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canvasX: x, canvasY: y }),
    });
  }, [journeyId]);

  const onConnect = useCallback(async (fromId: string, toId: string) => {
    await fetch(`/api/programmes/${journeyId}/edges`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPhaseId: fromId, toPhaseId: toId }),
    });
    onChanged();
  }, [journeyId, onChanged]);

  const onDeleteEdge = useCallback(async (edgeId: string) => {
    await fetch(`/api/programmes/${journeyId}/edges/${edgeId}`, { method: "DELETE" });
    onChanged();
  }, [journeyId, onChanged]);

  return (
    <GraphCanvas
      nodes={nodes}
      edges={graphEdges}
      nodeStyle={(n) => STATUS_STYLE[n.status ?? ""] ?? { bg: "#fafaf9", border: "#d6d3d1" }}
      onMoveNode={onMoveNode}
      onConnect={onConnect}
      onDeleteEdge={onDeleteEdge}
      hint="Drag nodes to reposition · drag the right handle to connect · click an edge to remove"
    />
  );
}
