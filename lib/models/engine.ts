// Operating Models — model-shaped wrapper around lib/formula/engine.
//
// The pure tokenize/parse/evaluate lives in lib/formula/engine.ts and is
// reused by lib/budget-generator.ts for parametric LineTemplates. This file
// keeps only the model-specific pieces: node topology, horizons/vectors, T,
// input override materialisation, sensitivity grids.

import {
  EvalError,
  ParseError,
  evaluate,
  parse,
  refsInFormula,
  type Value,
} from "@/lib/formula/engine";

import type {
  ComputeResult,
  Horizon,
  InstanceInputs,
  ModelNode,
  ModelTemplate,
  NodeShape,
  NodeValue,
} from "./types";

// Re-export for callers that reach into the engine.
export { refsInFormula, ParseError, EvalError };

// ─── Topological sort + validation ──────────────────────────────────────────

export type ValidationError = { nodeKey: string; message: string };

/**
 * Validates a template: parseable formulas, refs resolve, no cycles, horizons
 * exist. Returns errors; empty array = valid.
 */
export function validateTemplate(t: ModelTemplate): ValidationError[] {
  const errs: ValidationError[] = [];
  const byKey = new Map(t.nodes.map(n => [n.key, n] as const));
  const horizonKeys = new Set(t.horizons.map(h => h.key));

  for (const n of t.nodes) {
    if (n.shape.kind === "vector" && !horizonKeys.has(n.shape.horizon)) {
      errs.push({ nodeKey: n.key, message: `unknown horizon '${n.shape.horizon}'` });
    }
    if (n.kind === "formula") {
      if (!n.formula) { errs.push({ nodeKey: n.key, message: "formula node has no formula" }); continue; }
      try {
        const refs = refsInFormula(n.formula);
        for (const r of refs) {
          if (!byKey.has(r)) errs.push({ nodeKey: n.key, message: `unknown ref '${r}'` });
        }
      } catch (e) {
        errs.push({ nodeKey: n.key, message: `parse error: ${(e as Error).message}` });
      }
    }
  }

  // Cycle check via DFS with three-color marking.
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const dfs = (key: string): boolean => {
    const c = color.get(key) ?? 0;
    if (c === 2) return true;
    if (c === 1) {
      const cycle = [...stack.slice(stack.indexOf(key)), key].join(" → ");
      errs.push({ nodeKey: key, message: `cycle: ${cycle}` });
      return false;
    }
    color.set(key, 1); stack.push(key);
    const n = byKey.get(key);
    if (n?.kind === "formula" && n.formula) {
      for (const dep of refsInFormula(n.formula)) {
        if (byKey.has(dep)) if (!dfs(dep)) { stack.pop(); color.set(key, 2); return false; }
      }
    }
    stack.pop(); color.set(key, 2);
    return true;
  };
  for (const n of t.nodes) if ((color.get(n.key) ?? 0) === 0) dfs(n.key);

  return errs;
}

/** Returns node keys in evaluation order. Throws on cycle. */
export function topoOrder(t: ModelTemplate): string[] {
  const byKey = new Map(t.nodes.map(n => [n.key, n] as const));
  const order: string[] = [];
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const dfs = (key: string) => {
    const c = color.get(key) ?? 0;
    if (c === 2) return;
    if (c === 1) throw new EvalError(`cycle through ${[...stack, key].join(" → ")}`);
    color.set(key, 1); stack.push(key);
    const n = byKey.get(key);
    if (n?.kind === "formula" && n.formula) {
      for (const dep of refsInFormula(n.formula)) {
        if (byKey.has(dep)) dfs(dep);
      }
    }
    stack.pop(); color.set(key, 2);
    order.push(key);
  };
  for (const n of t.nodes) dfs(n.key);
  return order;
}

// ─── Model-shaped evaluator ─────────────────────────────────────────────────

type Ctx = {
  template: ModelTemplate;
  byKey: Map<string, ModelNode>;
  horizonByKey: Map<string, Horizon>;
  values: Record<string, NodeValue>;
  currentHorizon?: string;
  t?: number;
};

function asNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) throw new EvalError("expected scalar, got vector");
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isNaN(n)) throw new EvalError(`cannot coerce '${v}' to number`);
    return n;
  }
  throw new EvalError(`cannot coerce ${typeof v} to number`);
}

/**
 * Model resolver: T inside vector formulas + node lookup with same-horizon
 * vector element access at the current period.
 */
function modelResolver(ctx: Ctx): (name: string) => Value | undefined {
  return (name: string): Value | undefined => {
    if (name === "T") {
      if (ctx.t === undefined) throw new EvalError("T only valid inside a vector formula");
      return ctx.t;
    }
    const node = ctx.byKey.get(name);
    if (!node) return undefined;
    if (!(name in ctx.values)) throw new EvalError(`'${name}' has no value yet (topo bug?)`);
    const v = ctx.values[name];
    if (Array.isArray(v) && ctx.currentHorizon && node.shape.kind === "vector" && node.shape.horizon === ctx.currentHorizon) {
      return v[ctx.t!];
    }
    return v as Value;
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute every node in a template, given a sparse set of input overrides.
 * Returns final values and per-node errors. Never throws on bad formulas — the
 * error is recorded against the node and downstream dependents fail with a
 * propagated message.
 */
export function compute(template: ModelTemplate, inputs: InstanceInputs): ComputeResult {
  const byKey = new Map(template.nodes.map(n => [n.key, n] as const));
  const horizonByKey = new Map(template.horizons.map(h => [h.key, h] as const));
  const values: Record<string, NodeValue> = {};
  const errors: Record<string, string> = {};

  let order: string[];
  try { order = topoOrder(template); } catch (e) {
    const msg = (e as Error).message;
    for (const n of template.nodes) errors[n.key] = msg;
    return { values, errors };
  }

  for (const key of order) {
    const node = byKey.get(key)!;
    try {
      values[key] = computeNode(node, { template, byKey, horizonByKey, values }, inputs);
    } catch (e) {
      errors[key] = (e as Error).message;
    }
  }
  return { values, errors };
}

function computeNode(node: ModelNode, ctx: Ctx, inputs: InstanceInputs): NodeValue {
  if (node.kind === "input" || node.kind === "constant") {
    const override = inputs[node.key];
    const raw = override !== undefined ? override : node.default;
    return materializeStatic(node, raw, ctx);
  }

  if (!node.formula) throw new EvalError("formula node missing formula");
  const expr = parse(node.formula);

  if (node.shape.kind === "scalar") {
    return evaluate(expr, modelResolver(ctx)) as NodeValue;
  }

  const horizon = ctx.horizonByKey.get(node.shape.horizon);
  if (!horizon) throw new EvalError(`unknown horizon '${node.shape.horizon}'`);
  const out: number[] = [];
  for (let t = 0; t < horizon.length; t++) {
    const stepCtx: Ctx = { ...ctx, currentHorizon: node.shape.horizon, t };
    const v = evaluate(expr, modelResolver(stepCtx));
    out.push(asNumber(v));
  }
  return out;
}

function materializeStatic(node: ModelNode, raw: NodeValue | undefined, ctx: Ctx): NodeValue {
  if (raw === undefined || raw === null) {
    return shapeZero(node.shape, ctx);
  }
  if (node.shape.kind === "scalar") {
    if (Array.isArray(raw)) throw new EvalError(`'${node.key}' is scalar but default is array`);
    return raw;
  }
  const horizon = ctx.horizonByKey.get(node.shape.horizon);
  if (!horizon) throw new EvalError(`unknown horizon '${node.shape.horizon}'`);
  if (Array.isArray(raw)) {
    if (raw.length === horizon.length) return raw;
    if (raw.length === 0) return Array(horizon.length).fill(0);
    const out = raw.slice(0, horizon.length);
    while (out.length < horizon.length) out.push(raw[raw.length - 1]);
    return out;
  }
  const n = typeof raw === "boolean" ? (raw ? 1 : 0) : asNumber(raw);
  return Array(horizon.length).fill(n);
}

function shapeZero(shape: NodeShape, ctx: Ctx): NodeValue {
  if (shape.kind === "scalar") return 0;
  const horizon = ctx.horizonByKey.get(shape.horizon);
  if (!horizon) return 0;
  return Array(horizon.length).fill(0);
}

/**
 * Run the engine `xValues.length * yValues.length` times, varying two input
 * nodes across the grid, and pull a single scalar value from `resultNode` at
 * each cell. Used by sensitivity output kind.
 *
 * If resultNode is a vector, pick `resultIndex` (defaults to 0).
 */
export function computeSensitivity(
  template: ModelTemplate,
  baseInputs: InstanceInputs,
  config: {
    xNode: string; xValues: number[];
    yNode: string; yValues: number[];
    resultNode: string; resultIndex?: number;
  },
): { grid: (number | null)[][]; min: number; max: number } {
  const grid: (number | null)[][] = [];
  let min = Infinity, max = -Infinity;
  for (let yi = 0; yi < config.yValues.length; yi++) {
    const row: (number | null)[] = [];
    for (let xi = 0; xi < config.xValues.length; xi++) {
      const overrides: InstanceInputs = { ...baseInputs, [config.xNode]: config.xValues[xi], [config.yNode]: config.yValues[yi] };
      const r = compute(template, overrides);
      const v = r.values[config.resultNode];
      let scalar: number | null = null;
      if (typeof v === "number") scalar = v;
      else if (Array.isArray(v)) scalar = v[config.resultIndex ?? 0] ?? null;
      if (scalar !== null && Number.isFinite(scalar)) {
        if (scalar < min) min = scalar;
        if (scalar > max) max = scalar;
      }
      row.push(scalar);
    }
    grid.push(row);
  }
  return { grid, min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
}

// Re-export for tests (existing engine.test.ts uses these).
export { parse as _parseForTests, tokenize as _tokenizeForTests } from "@/lib/formula/engine";
