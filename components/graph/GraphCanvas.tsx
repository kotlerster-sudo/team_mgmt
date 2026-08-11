"use client";

// Generic SVG DAG canvas, generalized from programmes/[id]/PhaseCanvas.tsx.
// - Nodes carry a `kind` (drives colour) + optional `status`, `sublabel`, `broken`.
// - All mutation is via injected handlers; omit them for a read-only canvas:
//     onMoveNode  → node dragging + position persistence   (omit → nodes fixed)
//     onConnect   → drag-the-handle to create an edge       (omit → no handle)
//     onDeleteEdge→ click an edge to remove it              (omit → edges inert)
//     onSelectNode→ click a node (that wasn't a drag)        (omit → nodes inert)
// No external graph lib — consistent with the rest of the codebase.

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { autoLayout } from "./autoLayout";

export type GraphNode = {
  id: string;
  label: string;
  sublabel?: string | null;
  kind: string;
  status?: string | null;
  canvasX?: number | null;
  canvasY?: number | null;
  broken?: boolean;
};
export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label?: string | null;
  broken?: boolean;
};
export type NodeStyle = { bg: string; border: string };

const NODE_W = 180;
const NODE_H = 64;
const PADDING = 24;

const DEFAULT_STYLE: NodeStyle = { bg: "#fafaf9", border: "#d6d3d1" };
const BROKEN_STYLE: NodeStyle = { bg: "#fef2f2", border: "#ef4444" };

const DRAG_THRESHOLD = 4; // px moved before a mousedown counts as a drag, not a click

export default function GraphCanvas({
  nodes,
  edges,
  nodeStyle,
  onMoveNode,
  onConnect,
  onDeleteEdge,
  onSelectNode,
  selectedId,
  nodeWidth = NODE_W,
  nodeHeight = NODE_H,
  minHeight = 400,
  hint,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeStyle?: (n: GraphNode) => NodeStyle;
  onMoveNode?: (id: string, x: number, y: number) => void;
  onConnect?: (fromId: string, toId: string) => void;
  onDeleteEdge?: (id: string) => void;
  onSelectNode?: (id: string) => void;
  selectedId?: string | null;
  nodeWidth?: number;
  nodeHeight?: number;
  minHeight?: number;
  hint?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [dragging, setDragging] = useState<{ id: string; offX: number; offY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const [connecting, setConnecting] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null);

  const styleOf = useCallback(
    (n: GraphNode): NodeStyle => (n.broken ? BROKEN_STYLE : nodeStyle?.(n) ?? DEFAULT_STYLE),
    [nodeStyle],
  );

  // Initialize positions: prefer stored canvasX/Y, else auto-layout.
  useEffect(() => {
    const auto = autoLayout(nodes, edges.map((e) => ({ from: e.from, to: e.to })));
    const next = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      if (n.canvasX != null && n.canvasY != null) next.set(n.id, { x: n.canvasX, y: n.canvasY });
      else next.set(n.id, auto.get(n.id) ?? { x: PADDING, y: PADDING });
    }
    setPositions(next);
  }, [nodes, edges]);

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if ((e.target as HTMLElement).closest(".handle-out")) return;
    if (!onMoveNode && !onSelectNode) return;
    const pos = positions.get(nodeId);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!pos || !rect) return;
    setDragging({ id: nodeId, offX: e.clientX - rect.left - pos.x, offY: e.clientY - rect.top - pos.y, startX: e.clientX, startY: e.clientY, moved: false });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (dragging) {
      const movedNow = Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) > DRAG_THRESHOLD;
      if (movedNow && !dragging.moved) setDragging({ ...dragging, moved: true });
      if (!onMoveNode) return; // select-only node: track moved but don't reposition
      const nx = Math.max(0, e.clientX - rect.left - dragging.offX);
      const ny = Math.max(0, e.clientY - rect.top - dragging.offY);
      setPositions((prev) => new Map(prev).set(dragging.id, { x: nx, y: ny }));
    } else if (connecting) {
      setConnecting({ ...connecting, x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragging) {
      if (!dragging.moved) {
        onSelectNode?.(dragging.id);
      } else if (onMoveNode) {
        const pos = positions.get(dragging.id);
        if (pos) onMoveNode(dragging.id, Math.round(pos.x), Math.round(pos.y));
      }
      setDragging(null);
    }
    if (connecting) {
      const target = (e.target as HTMLElement).closest("[data-node-id]") as HTMLElement | null;
      const targetId = target?.getAttribute("data-node-id");
      if (targetId && targetId !== connecting.fromId) onConnect?.(connecting.fromId, targetId);
      setConnecting(null);
    }
  };

  const handleHandleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConnecting({ fromId: nodeId, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const maxX = Math.max(800, ...Array.from(positions.values()).map((p) => p.x + nodeWidth + PADDING));
  const maxY = Math.max(minHeight - 60, ...Array.from(positions.values()).map((p) => p.y + nodeHeight + PADDING));

  const edgePaths = useMemo(
    () =>
      edges
        .map((ed) => {
          const a = positions.get(ed.from);
          const b = positions.get(ed.to);
          if (!a || !b) return null;
          const x1 = a.x + nodeWidth;
          const y1 = a.y + nodeHeight / 2;
          const x2 = b.x;
          const y2 = b.y + nodeHeight / 2;
          const dx = Math.max(60, (x2 - x1) / 2);
          const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
          return { ...ed, path, midX: (x1 + x2) / 2, midY: (y1 + y2) / 2 };
        })
        .filter(Boolean) as (GraphEdge & { path: string; midX: number; midY: number })[],
    [edges, positions, nodeWidth, nodeHeight],
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { setDragging(null); setConnecting(null); }}
      className="relative border border-stone-200 rounded-xl bg-stone-50 overflow-auto"
      style={{ minHeight, height: maxY + 60, userSelect: dragging || connecting ? "none" : undefined }}
    >
      <svg className="absolute inset-0 pointer-events-none" width={maxX} height={maxY} style={{ overflow: "visible" }}>
        <defs>
          <marker id="gc-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#a8a29e" />
          </marker>
          <marker id="gc-arrow-red" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#ef4444" />
          </marker>
        </defs>
        {edgePaths.map((ed) => {
          const red = ed.broken || hoverEdgeId === ed.id;
          return (
            <g key={ed.id}>
              <path
                d={ed.path}
                stroke={red ? "#ef4444" : "#a8a29e"}
                strokeWidth={red ? 2 : 1.5}
                strokeDasharray={ed.broken ? "5 4" : undefined}
                fill="none"
                markerEnd={red ? "url(#gc-arrow-red)" : "url(#gc-arrow)"}
                style={{ pointerEvents: onDeleteEdge ? "stroke" : "none", cursor: onDeleteEdge ? "pointer" : "default" }}
                onMouseEnter={() => onDeleteEdge && setHoverEdgeId(ed.id)}
                onMouseLeave={() => setHoverEdgeId(null)}
                onClick={() => onDeleteEdge?.(ed.id)}
              />
              {onDeleteEdge && hoverEdgeId === ed.id && (
                <g pointerEvents="none">
                  <circle cx={ed.midX} cy={ed.midY} r="11" fill="#ef4444" />
                  <path
                    d={`M${ed.midX - 4} ${ed.midY - 4} L${ed.midX + 4} ${ed.midY + 4} M${ed.midX + 4} ${ed.midY - 4} L${ed.midX - 4} ${ed.midY + 4}`}
                    stroke="white"
                    strokeWidth="2"
                  />
                </g>
              )}
            </g>
          );
        })}
        {connecting && (
          <line
            x1={(positions.get(connecting.fromId)?.x ?? 0) + nodeWidth}
            y1={(positions.get(connecting.fromId)?.y ?? 0) + nodeHeight / 2}
            x2={connecting.x}
            y2={connecting.y}
            stroke="#7dd3fc"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        )}
      </svg>

      {nodes.map((n) => {
        const pos = positions.get(n.id);
        if (!pos) return null;
        const s = styleOf(n);
        const selected = selectedId === n.id;
        return (
          <div
            key={n.id}
            data-node-id={n.id}
            onMouseDown={(e) => handleNodeMouseDown(e, n.id)}
            className={`absolute select-none rounded-lg shadow-sm transition-shadow hover:shadow-md ${onMoveNode ? "cursor-grab active:cursor-grabbing" : onSelectNode ? "cursor-pointer" : ""}`}
            style={{
              left: pos.x, top: pos.y, width: nodeWidth, height: nodeHeight,
              background: s.bg,
              border: `${selected ? 2 : 1.5}px solid ${selected ? "#0ea5e9" : s.border}`,
              boxShadow: selected ? "0 0 0 3px rgba(14,165,233,0.15)" : undefined,
            }}
          >
            <div className="px-2.5 py-1.5 text-xs font-medium text-stone-800 truncate">{n.label}</div>
            {n.sublabel !== undefined && (
              <div className="px-2.5 text-[10px] text-stone-500 truncate">
                {n.sublabel ?? <span className="italic">—</span>}
              </div>
            )}
            <div className="absolute bottom-1 left-2.5 text-[9px] uppercase tracking-wider text-stone-400">
              {n.status ?? n.kind}
            </div>
            {n.broken && <div className="absolute bottom-1 right-2 text-[9px] font-semibold text-red-500">broken</div>}
            {onConnect && (
              <div
                className="handle-out absolute right-[-7px] top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-sky-400 rounded-full cursor-crosshair hover:bg-sky-100"
                onMouseDown={(e) => handleHandleMouseDown(e, n.id)}
                title="Drag to another node to connect"
              />
            )}
          </div>
        );
      })}

      {nodes.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-stone-400 italic">Nothing to show.</p>
      )}
      {hint && <p className="absolute bottom-2 right-3 text-[10px] text-stone-400">{hint}</p>}
    </div>
  );
}
