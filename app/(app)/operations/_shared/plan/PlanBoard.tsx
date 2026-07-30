"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Flag, User } from "lucide-react";
import { progressTagColor } from "@/lib/progressTags";
import type { CentrePlan, PlanNode } from "@/lib/operations/plan";
import { StatusIcon, subItemStatus } from "./statusIcon";

/**
 * Clean vertical WBS outline (the launch-plan mock's shape): workstream sections stacked top→bottom,
 * node cards with sub-items inside, a distinct milestone gate at the foot. Dependencies are drawn as
 * a LEFT-GUTTER arrow overlay (SVG rails routed down the left margin so lines never cross cards) —
 * this handles real cross-workstream / convergence dependencies that a pure vertical connector can't.
 * Critical-path edges are red. Recomputed on resize / sub-item expansion via ResizeObserver.
 */
export function PlanBoard({ plan, onOpen }: { plan: CentrePlan; onOpen: (pitstopId: string) => void }) {
  const allNodes = plan.workstreams.flatMap((w) => w.nodes);
  const wbsById = new Map(allNodes.map((n) => [n.pitstopId, n.wbs]));
  const onPath = new Set(allNodes.filter((n) => n.onCriticalPath).map((n) => n.pitstopId));
  const milestones = plan.workstreams.flatMap((w) => w.nodes.filter((n) => n.isMilestone));

  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [paths, setPaths] = useState<{ d: string; critical: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const setNodeRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    const compute = () => {
      const cont = containerRef.current;
      if (!cont) return;
      const cb = cont.getBoundingClientRect();
      setSize({ w: cont.clientWidth, h: cont.clientHeight });
      const out: { d: string; critical: boolean }[] = [];
      plan.edges.forEach((e, i) => {
        const from = nodeRefs.current.get(e.from);
        const to = nodeRefs.current.get(e.to);
        if (!from || !to) return;
        const fr = from.getBoundingClientRect();
        const tr = to.getBoundingClientRect();
        const x1 = fr.left - cb.left;
        const y1 = fr.top - cb.top + fr.height / 2;
        const x2 = tr.left - cb.left;
        const y2 = tr.top - cb.top + tr.height / 2;
        const gx = 10 + (i % 5) * 5; // stagger rails so parallel edges don't overlap
        const d = `M ${x1} ${y1} L ${gx} ${y1} L ${gx} ${y2} L ${x2} ${y2}`;
        out.push({ d, critical: onPath.has(e.from) && onPath.has(e.to) });
      });
      setPaths(out);
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", compute);
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); };
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} className="relative max-w-2xl mx-auto pl-9">
      {/* Dependency rails */}
      <svg className="absolute inset-0 pointer-events-none" width={size.w} height={size.h} style={{ overflow: "visible" }}>
        <defs>
          <marker id="wbs-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#a8a29e" />
          </marker>
          <marker id="wbs-arrow-cp" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#ef4444" />
          </marker>
        </defs>
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill="none" stroke={p.critical ? "#ef4444" : "#d6d3d1"} strokeWidth={p.critical ? 2 : 1.5} markerEnd={`url(#${p.critical ? "wbs-arrow-cp" : "wbs-arrow"})`} />
        ))}
      </svg>

      <div className="space-y-6">
        {plan.workstreams.map((w) => {
          const nodes = w.nodes.filter((n) => !n.isMilestone);
          if (nodes.length === 0) return null;
          return (
            <section key={w.tag}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2.5 h-2.5 rounded-full ${progressTagColor(w.tag).filled}`} />
                <h3 className="text-sm font-bold text-stone-800 tracking-tight">{w.index}. {w.label.toUpperCase()}</h3>
              </div>
              <div className="space-y-2.5">
                {nodes.map((n) => (
                  <NodeCard key={n.pitstopId} node={n} wbsById={wbsById} innerRef={setNodeRef(n.pitstopId)} onOpen={onOpen} />
                ))}
              </div>
            </section>
          );
        })}

        {milestones.length > 0 && (
          <div className="flex flex-col items-center gap-2 pt-1">
            {milestones.map((m) => (
              <button
                key={m.pitstopId}
                ref={setNodeRef(m.pitstopId)}
                onClick={() => onOpen(m.pitstopId)}
                className={`inline-flex items-center gap-2 rounded-lg border-2 px-6 py-2.5 font-bold uppercase tracking-wide text-sm ${
                  m.status === "done" ? "bg-emerald-500 border-emerald-600 text-white" : "bg-white border-stone-800 text-stone-900"
                }`}
              >
                <Flag className="w-4 h-4" /> {m.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NodeCard({ node, wbsById, innerRef, onOpen }: {
  node: PlanNode; wbsById: Map<string, string>; innerRef: (el: HTMLElement | null) => void; onOpen: (id: string) => void;
}) {
  return (
    <button
      ref={innerRef}
      onClick={() => onOpen(node.pitstopId)}
      className={`w-full text-left rounded-xl bg-white border px-3.5 py-2.5 hover:shadow-sm transition-shadow ${
        node.onCriticalPath ? "border-red-300 ring-1 ring-red-100" : "border-stone-200"
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={node.status} className="w-4 h-4" />
        <span className="text-[11px] font-semibold text-stone-400 tabular-nums">{node.wbs}</span>
        <span className={`text-sm font-medium flex-1 min-w-0 ${node.status === "done" ? "text-stone-400 line-through" : "text-stone-800"}`}>{node.title}</span>
        {node.onCriticalPath && <span className="text-[9px] font-bold uppercase text-red-500 tracking-wide shrink-0">critical</span>}
      </div>

      {node.subItems.length > 0 && (
        <div className="mt-1.5 pl-6 space-y-0.5">
          {node.subItems.map((s) => (
            <div key={s.checklistId} className="flex items-center gap-1.5">
              <StatusIcon status={subItemStatus(s.status, s.doneCount, s.totalCount)} className="w-3 h-3" />
              <span className="text-[11px] text-stone-500 truncate flex-1">{s.text}</span>
              {s.totalCount > 1 && <span className="text-[9px] text-stone-400 tabular-nums shrink-0">{s.doneCount}/{s.totalCount}</span>}
            </div>
          ))}
        </div>
      )}

      {(node.blockedBy.length > 0 || node.ownerName || node.targetDate) && (
        <div className="mt-1.5 pl-6 flex items-center gap-2 flex-wrap text-[10px] text-stone-400">
          {node.blockedBy.length > 0 && <span className="text-stone-500">needs {node.blockedBy.map((id) => wbsById.get(id) ?? "?").join(", ")}</span>}
          {node.ownerName && <span className="inline-flex items-center gap-0.5"><User className="w-2.5 h-2.5" />{node.ownerName}</span>}
          {node.targetDate && <span className="ml-auto tabular-nums">{new Date(node.targetDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
        </div>
      )}
    </button>
  );
}
