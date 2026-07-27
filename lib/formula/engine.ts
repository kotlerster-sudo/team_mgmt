// Pure formula engine — tokenize + parse + evaluate.
//
// Extracted from lib/models/engine.ts so the same expression language can be
// reused wherever we want parametric formulas (models, budget line templates,
// derived cost-registry keys). No knowledge of ModelTemplate or horizons; the
// caller supplies a `Resolver` that maps bare identifiers to values.
//
// In identifiers, dots are permitted (`inp.wcSeats`, `san.civil_per_sqm_g2`)
// so the resolver receives dotted paths whole — split on `.` inside it.
//
// Built-ins: SUM(vec) | SUM(a, b, ...) | SUM(vec, start, len), MAX/MIN,
// ROUND(x, d), ABS/CEIL/CEILING/FLOOR/TRUNC, IF(cond, then, else),
// IFERROR(expr, fallback), AT(vec, i), SLICE(vec, start, len),
// NPV(rate, vec).

// ─── Tokenizer ───────────────────────────────────────────────────────────────

export type TokKind =
  | "num"
  | "ident"
  | "str"
  | "op"
  | "lparen"
  | "rparen"
  | "lbrack"
  | "rbrack"
  | "comma"
  | "colon"
  | "eof";

export type Token = { kind: TokKind; value: string; pos: number };

export class ParseError extends Error {}
export class EvalError extends Error {}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c >= "0" && c <= "9") {
      const start = i;
      while (i < len && ((src[i] >= "0" && src[i] <= "9") || src[i] === ".")) i++;
      out.push({ kind: "num", value: src.slice(start, i), pos: start });
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      const start = i;
      while (i < len && ((src[i] >= "a" && src[i] <= "z") || (src[i] >= "A" && src[i] <= "Z") || (src[i] >= "0" && src[i] <= "9") || src[i] === "_" || src[i] === ".")) i++;
      out.push({ kind: "ident", value: src.slice(start, i), pos: start });
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c; const start = i; i++;
      while (i < len && src[i] !== quote) i++;
      if (i >= len) throw new ParseError(`unterminated string at ${start}`);
      out.push({ kind: "str", value: src.slice(start + 1, i), pos: start });
      i++; continue;
    }
    if (c === "(") { out.push({ kind: "lparen", value: c, pos: i++ }); continue; }
    if (c === ")") { out.push({ kind: "rparen", value: c, pos: i++ }); continue; }
    if (c === "[") { out.push({ kind: "lbrack", value: c, pos: i++ }); continue; }
    if (c === "]") { out.push({ kind: "rbrack", value: c, pos: i++ }); continue; }
    if (c === ",") { out.push({ kind: "comma", value: c, pos: i++ }); continue; }
    if (c === ":") { out.push({ kind: "colon", value: c, pos: i++ }); continue; }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "==" || two === "!=" || two === "&&" || two === "||") {
      out.push({ kind: "op", value: two, pos: i }); i += 2; continue;
    }
    if ("+-*/%<>=!^".includes(c)) {
      out.push({ kind: "op", value: c, pos: i++ }); continue;
    }
    throw new ParseError(`unexpected '${c}' at ${i}`);
  }
  out.push({ kind: "eof", value: "", pos: len });
  return out;
}

// ─── AST ─────────────────────────────────────────────────────────────────────

export type Expr =
  | { type: "num"; v: number }
  | { type: "str"; v: string }
  | { type: "ref"; name: string }
  | { type: "index"; target: Expr; idx: Expr }
  | { type: "slice"; target: Expr; start: Expr; end: Expr | null }
  | { type: "call"; name: string; args: Expr[] }
  | { type: "unop"; op: string; rhs: Expr }
  | { type: "binop"; op: string; lhs: Expr; rhs: Expr };

// ─── Parser (Pratt) ──────────────────────────────────────────────────────────

const BINOP_PREC: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3,
  "+": 4, "-": 4,
  "*": 5, "/": 5, "%": 5,
  "^": 6,
};

export function parse(src: string): Expr {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];
  const expect = (k: TokKind, val?: string) => {
    const t = eat();
    if (t.kind !== k || (val !== undefined && t.value !== val)) {
      throw new ParseError(`expected ${val ?? k}, got '${t.value}' (${t.kind}) at ${t.pos}`);
    }
    return t;
  };

  function parsePrimary(): Expr {
    const t = peek();
    if (t.kind === "num") { eat(); return { type: "num", v: Number(t.value) }; }
    if (t.kind === "str") { eat(); return { type: "str", v: t.value }; }
    if (t.kind === "op" && (t.value === "-" || t.value === "+" || t.value === "!")) {
      eat(); const rhs = parseUnary(); return { type: "unop", op: t.value, rhs };
    }
    if (t.kind === "lparen") {
      eat(); const e = parseExpr(0); expect("rparen"); return e;
    }
    if (t.kind === "ident") {
      eat();
      if (peek().kind === "lparen") {
        eat();
        const args: Expr[] = [];
        if (peek().kind !== "rparen") {
          args.push(parseExpr(0));
          while (peek().kind === "comma") { eat(); args.push(parseExpr(0)); }
        }
        expect("rparen");
        return { type: "call", name: t.value, args };
      }
      return { type: "ref", name: t.value };
    }
    throw new ParseError(`unexpected '${t.value}' at ${t.pos}`);
  }

  function parsePostfix(e: Expr): Expr {
    while (peek().kind === "lbrack") {
      eat();
      const start = parseExpr(0);
      if (peek().kind === "colon") {
        eat();
        const end = peek().kind === "rbrack" ? null : parseExpr(0);
        expect("rbrack");
        e = { type: "slice", target: e, start, end };
      } else {
        expect("rbrack");
        e = { type: "index", target: e, idx: start };
      }
    }
    return e;
  }

  function parseUnary(): Expr {
    return parsePostfix(parsePrimary());
  }

  function parseExpr(minPrec: number): Expr {
    let lhs = parseUnary();
    while (true) {
      const t = peek();
      if (t.kind !== "op") break;
      const prec = BINOP_PREC[t.value];
      if (prec === undefined || prec < minPrec) break;
      eat();
      const rightAssoc = t.value === "^";
      const rhs = parseExpr(rightAssoc ? prec : prec + 1);
      lhs = { type: "binop", op: t.value, lhs, rhs };
    }
    return lhs;
  }

  const e = parseExpr(0);
  if (peek().kind !== "eof") throw new ParseError(`trailing tokens at ${peek().pos}`);
  return e;
}

/** Returns bare identifiers referenced in `src`. Silent on parse failure. */
export function refsInFormula(src: string): string[] {
  const refs = new Set<string>();
  let expr: Expr;
  try { expr = parse(src); } catch { return []; }
  const walk = (e: Expr) => {
    switch (e.type) {
      case "ref":
        if (e.name !== "T" && e.name !== "true" && e.name !== "false") refs.add(e.name);
        break;
      case "index": walk(e.target); walk(e.idx); break;
      case "slice": walk(e.target); walk(e.start); if (e.end) walk(e.end); break;
      case "call": e.args.forEach(walk); break;
      case "unop": walk(e.rhs); break;
      case "binop": walk(e.lhs); walk(e.rhs); break;
    }
  };
  walk(expr);
  return [...refs];
}

// ─── Evaluator ───────────────────────────────────────────────────────────────

export type Value = number | boolean | string | number[];

/**
 * Resolver for bare identifiers. Return `undefined` to signal "unknown ref"
 * (the evaluator throws EvalError). `true` and `false` are handled by the
 * evaluator itself; `T` is not — pass it in the resolver if you need vector
 * semantics.
 */
export type Resolver = (name: string) => Value | undefined;

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

function asArray(v: unknown): number[] {
  if (Array.isArray(v)) return v;
  throw new EvalError("expected array");
}

export function evaluate(expr: Expr, resolver: Resolver): Value {
  return evalExpr(expr, resolver);
}

/** Convenience: parse + evaluate in one call. */
export function evaluateString(src: string, resolver: Resolver): Value {
  return evalExpr(parse(src), resolver);
}

function evalExpr(e: Expr, resolver: Resolver): Value {
  switch (e.type) {
    case "num": return e.v;
    case "str": return e.v;
    case "ref": {
      if (e.name === "true") return true;
      if (e.name === "false") return false;
      const v = resolver(e.name);
      if (v === undefined) throw new EvalError(`unknown ref '${e.name}'`);
      return v;
    }
    case "unop": {
      const r = evalExpr(e.rhs, resolver);
      if (e.op === "-") return -asNumber(r);
      if (e.op === "+") return asNumber(r);
      if (e.op === "!") return !asNumber(r);
      throw new EvalError(`unknown unop ${e.op}`);
    }
    case "binop": return evalBinop(e.op, evalExpr(e.lhs, resolver), evalExpr(e.rhs, resolver));
    case "index": {
      const arr = asArray(evalExpr(e.target, resolver));
      const i = Math.trunc(asNumber(evalExpr(e.idx, resolver)));
      if (i < 0 || i >= arr.length) throw new EvalError(`index ${i} out of bounds (len ${arr.length})`);
      return arr[i];
    }
    case "slice": {
      const arr = asArray(evalExpr(e.target, resolver));
      const s = Math.trunc(asNumber(evalExpr(e.start, resolver)));
      const eIdx = e.end ? Math.trunc(asNumber(evalExpr(e.end, resolver))) : arr.length;
      return arr.slice(s, eIdx);
    }
    case "call": return callBuiltin(e.name, e.args, resolver);
  }
}

function evalBinop(op: string, lhs: Value, rhs: Value): Value {
  switch (op) {
    case "+": return asNumber(lhs) + asNumber(rhs);
    case "-": return asNumber(lhs) - asNumber(rhs);
    case "*": return asNumber(lhs) * asNumber(rhs);
    case "/": {
      const d = asNumber(rhs);
      if (d === 0) throw new EvalError("division by zero");
      return asNumber(lhs) / d;
    }
    case "%": return asNumber(lhs) % asNumber(rhs);
    case "^": return Math.pow(asNumber(lhs), asNumber(rhs));
    case "==": return asNumber(lhs) === asNumber(rhs);
    case "!=": return asNumber(lhs) !== asNumber(rhs);
    case "<": return asNumber(lhs) < asNumber(rhs);
    case "<=": return asNumber(lhs) <= asNumber(rhs);
    case ">": return asNumber(lhs) > asNumber(rhs);
    case ">=": return asNumber(lhs) >= asNumber(rhs);
    case "&&": return Boolean(asNumber(lhs)) && Boolean(asNumber(rhs));
    case "||": return Boolean(asNumber(lhs)) || Boolean(asNumber(rhs));
  }
  throw new EvalError(`unknown binop ${op}`);
}

function callBuiltin(name: string, args: Expr[], resolver: Resolver): Value {
  const upper = name.toUpperCase();
  switch (upper) {
    case "SUM": {
      if (args.length === 1) {
        const v = evalExpr(args[0], resolver);
        if (Array.isArray(v)) return v.reduce((a, b) => a + b, 0);
        return asNumber(v);
      }
      if (args.length === 3) {
        const first = evalExpr(args[0], resolver);
        if (Array.isArray(first)) {
          const start = Math.trunc(asNumber(evalExpr(args[1], resolver)));
          const len = Math.trunc(asNumber(evalExpr(args[2], resolver)));
          return first.slice(start, start + len).reduce((a, b) => a + b, 0);
        }
      }
      let total = 0;
      for (const a of args) {
        const v = evalExpr(a, resolver);
        if (Array.isArray(v)) total += v.reduce((s, x) => s + x, 0);
        else total += asNumber(v);
      }
      return total;
    }
    case "MAX":
    case "MIN": {
      const vals: number[] = [];
      for (const a of args) {
        const v = evalExpr(a, resolver);
        if (Array.isArray(v)) vals.push(...v);
        else vals.push(asNumber(v));
      }
      if (vals.length === 0) throw new EvalError(`${upper} needs at least one value`);
      return upper === "MAX" ? Math.max(...vals) : Math.min(...vals);
    }
    case "ABS": return Math.abs(asNumber(evalExpr(args[0], resolver)));
    case "CEIL":
    case "CEILING": return Math.ceil(asNumber(evalExpr(args[0], resolver)));
    case "FLOOR": return Math.floor(asNumber(evalExpr(args[0], resolver)));
    case "TRUNC": return Math.trunc(asNumber(evalExpr(args[0], resolver)));
    case "ROUND": {
      const x = asNumber(evalExpr(args[0], resolver));
      const d = args[1] ? Math.trunc(asNumber(evalExpr(args[1], resolver))) : 0;
      const m = Math.pow(10, d);
      return Math.round(x * m) / m;
    }
    case "IF": {
      const cond = asNumber(evalExpr(args[0], resolver));
      return cond ? evalExpr(args[1], resolver) : evalExpr(args[2], resolver);
    }
    case "IFERROR": {
      try { return evalExpr(args[0], resolver); } catch { return evalExpr(args[1], resolver); }
    }
    case "AT": {
      const arr = asArray(evalExpr(args[0], resolver));
      const i = Math.trunc(asNumber(evalExpr(args[1], resolver)));
      if (i < 0 || i >= arr.length) throw new EvalError(`AT index ${i} out of bounds`);
      return arr[i];
    }
    case "SLICE": {
      const arr = asArray(evalExpr(args[0], resolver));
      const s = Math.trunc(asNumber(evalExpr(args[1], resolver)));
      const len = Math.trunc(asNumber(evalExpr(args[2], resolver)));
      return arr.slice(s, s + len);
    }
    case "NPV": {
      const rate = asNumber(evalExpr(args[0], resolver));
      const vec = asArray(evalExpr(args[1], resolver));
      let total = 0;
      for (let i = 0; i < vec.length; i++) total += vec[i] / Math.pow(1 + rate, i + 1);
      return total;
    }
  }
  throw new EvalError(`unknown function ${name}`);
}
