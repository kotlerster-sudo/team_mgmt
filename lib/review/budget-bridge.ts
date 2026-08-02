// Cross-DB bridge: pulls a Budget from the main app's Prisma store
// (DATABASE_URL) and returns a comparison snapshot — per-unit cost, sections
// (one-time / annual recurring / supervisory / management / other), with
// deviation against the live CostRegistry standard.
//
// Generic across budget domains. Domain shape (template prefix, divisor input
// field, unit noun) is resolved at runtime from BudgetDomainConfig so adding a
// new domain in /admin → Budgets is enough — no review-portal code change.
//
// Called from review-portal pages (same Next.js runtime, NextAuth session
// available). Snapshot is persisted into grant_note_metadata.budget_comparison
// at note-create time so the note doesn't drift if the budget is later edited.

import prisma from "@/lib/prisma";
import { resolveRegistryMap } from "@/lib/budget/costRegistry";
import {
  generateBudgetLines,
  activeYearBands,
} from "@/lib/budget-generator";
import type { BudgetInputs } from "@/app/generated/prisma/client";
import type { BudgetSection } from "@/app/generated/prisma/client";

export type DeviationRow = {
  templateKey: string;
  description: string;
  perUnitProposed: number;
  perUnitStandard: number;
  perUnitDelta: number;
  pct: number | null;
};

export type DeviationGroup = {
  label: string;
  rows: DeviationRow[];
  subtotalProposed: number;
  subtotalStandard: number;
  subtotalDelta: number;
  subtotalPct: number | null;
};

export type BudgetComparisonSnapshot = {
  budgetId: string;
  budgetName: string;
  city: string;
  domain: string;
  unitLabel: string;        // singular noun, e.g. "creche" / "centre" / "CLC"
  unitLabelPlural: string;  // pluralised — used in headers
  unitCount: number;        // divisor used to compute per-unit
  groups: DeviationGroup[];
  // 5-col HTML table in the docs' format, ready to drop into a section.
  tableHtml: string;
  generatedAt: string;
};

const SECTION_TO_GROUP: Record<BudgetSection, string> = {
  capex:        "1. One-time setup",
  programme:    "2. Annual recurring operating cost",
  salary:       "3. Supervisory and support cost",
  travel:       "3. Supervisory and support cost",
  admin_salary: "4. Management cost",
  admin_other:  "4. Management cost",
  additional:   "5. Other cost",
};

const GROUP_ORDER = [
  "1. One-time setup",
  "2. Annual recurring operating cost",
  "3. Supervisory and support cost",
  "4. Management cost",
  "5. Other cost",
];

function fmtRs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function fmtPct(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  if (Math.abs(p) < 0.5) return "0%";
  return (p > 0 ? "+" : "") + Math.round(p) + "%";
}

function pluralise(noun: string, n: number): string {
  if (n === 1) return noun;
  if (noun.endsWith("s")) return noun;
  return noun + "s";
}

type DomainContext = {
  key: string;
  unitLabel: string;
  templatePrefix: string;
  unitCount: number;
};

async function resolveDomainContext(
  domainKey: string,
  city: string,
  inputs: BudgetInputs | null,
): Promise<DomainContext> {
  const cfg = await prisma.budgetDomainConfig.findUnique({
    where: { city_key: { city, key: domainKey } },
  });

  // Unit noun: derive from the human-facing beneficiaryLabel if set
  // (lowercased, singularised), else fall back to the domain key.
  const beneficiaryLabel = cfg?.beneficiaryLabel?.trim();
  const unitLabel = beneficiaryLabel
    ? beneficiaryLabel.toLowerCase().replace(/s$/, "")
    : domainKey.toLowerCase();

  // Divisor: read inputs[beneficiaryVar] (or extraInputs[beneficiaryVar]) and
  // multiply by beneficiaryMult. Clamp ≥ 1 to avoid divide-by-zero / NaN.
  const beneficiaryVar = cfg?.beneficiaryVar ?? null;
  const beneficiaryMult = cfg?.beneficiaryMult ?? 1;
  let unitCount = 1;
  if (inputs && beneficiaryVar) {
    const flat = inputs as unknown as Record<string, unknown>;
    const extra = (inputs.extraInputs ?? {}) as Record<string, unknown>;
    const raw = flat[beneficiaryVar] ?? extra[beneficiaryVar] ?? 0;
    const n = Math.round(Number(raw) * beneficiaryMult);
    if (Number.isFinite(n) && n > 0) unitCount = n;
  }

  // Template-key prefix follows the codebase convention ("domain lowercase + .")
  // — see lib/budget-costs.ts:2.
  return {
    key: domainKey,
    unitLabel,
    templatePrefix: domainKey.toLowerCase() + ".",
    unitCount,
  };
}

export async function loadBudgetSnapshot(
  budgetId: string,
  viewerUserId: string,
  /** When omitted, falls back to the budget's first domain. */
  domainKey?: string,
): Promise<BudgetComparisonSnapshot> {
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: {
      id: true, name: true, city: true, partnerId: true, domains: true,
      inputs: true, costSnapshot: true, costOverrides: true,
      lines: {
        select: {
          templateKey: true, section: true, description: true,
          y1Total: true,
        },
      },
    },
  });
  if (!budget) throw new Error("Budget not found");
  if (budget.partnerId !== viewerUserId) {
    // Main app's RBAC layer will gate non-owner reads upstream; bridge stays strict.
    throw new Error("Not authorised to read this budget");
  }

  // Resolve the domain: explicit wins; otherwise the budget's first domain.
  const resolvedDomain = (domainKey ?? '').trim() || budget.domains[0];
  if (!resolvedDomain) {
    throw new Error("Budget has no domains; cannot build a comparison snapshot");
  }
  if (!budget.domains.includes(resolvedDomain)) {
    throw new Error(`Budget does not include the ${resolvedDomain} domain`);
  }

  const ctx = await resolveDomainContext(resolvedDomain, budget.city, budget.inputs);

  // Programme inputs the generator expects. Flat fields the model exposes,
  // plus everything in extraInputs — generators read whatever key they ask for.
  const raw = budget.inputs;
  const programmeInputs: Record<string, number> = {};
  if (raw) {
    programmeInputs.nSettlements              = raw.nSettlements;
    programmeInputs.nClusters                 = raw.nClusters;
    programmeInputs.nCLCs                     = raw.nCLCs;
    programmeInputs.nCreches                  = raw.nCreches;
    programmeInputs.crecheRentPerMonth        = raw.crecheRentPerMonth;
    Object.assign(programmeInputs, (raw.extraInputs ?? {}) as Record<string, number>);
  }

  // Generate "standard" lines from the snapshot+templates using the same
  // inputs the budget was created with. Snapshot wins over the live registry
  // because that's what the partner saw at create time.
  const [liveRegistry, templates] = await Promise.all([
    resolveRegistryMap(budget.city),
    prisma.lineTemplate.findMany({ where: { city: budget.city }, orderBy: { position: "asc" } }),
  ]);
  const snapshot = (budget.costSnapshot ?? {}) as Record<string, number>;
  const standardRegistry = { ...liveRegistry, ...snapshot };
  const horizonMonths = 36;
  const stdLines = generateBudgetLines(
    budget.domains,
    programmeInputs,
    { horizonMonths, applyInflation: true },
    standardRegistry,
    templates.filter(t => t.domain === null || budget.domains.includes(t.domain!)),
  );

  // Yours: saved BudgetLine rows (authoritative — captures salary stub fill-ins
  // and manual edits). Drop non-domain lines from both sides.
  const matchesDomain = (k: string | null) => !!k && k.startsWith(ctx.templatePrefix);

  const yoursByKey = new Map<string, { total: number; section: BudgetSection; description: string }>();
  for (const l of budget.lines) {
    if (!matchesDomain(l.templateKey)) continue;
    yoursByKey.set(l.templateKey!, {
      total: l.y1Total,
      section: l.section,
      description: l.description,
    });
  }
  const stdByKey = new Map<string, { total: number; section: BudgetSection; description: string }>();
  for (const l of stdLines) {
    if (!matchesDomain(l.templateKey)) continue;
    stdByKey.set(l.templateKey, {
      total: l.y1Total,
      section: l.section as BudgetSection,
      description: l.description,
    });
  }

  // Union of all templateKeys — rows present in only one side become a
  // single-sided deviation (std=0 or yours=0), which is what the docs show
  // when a partner adds a line absent from the standard.
  const allKeys = new Set<string>([...yoursByKey.keys(), ...stdByKey.keys()]);

  const groupsByLabel = new Map<string, DeviationRow[]>();
  for (const key of allKeys) {
    const y = yoursByKey.get(key);
    const s = stdByKey.get(key);
    const description = y?.description ?? s?.description ?? key;
    const section = (y?.section ?? s?.section) as BudgetSection;
    const label = SECTION_TO_GROUP[section] ?? "5. Other cost";
    const yoursTotal = y?.total ?? 0;
    const stdTotal = s?.total ?? 0;
    const perUnitProposed = Math.round(yoursTotal / ctx.unitCount);
    const perUnitStandard = Math.round(stdTotal / ctx.unitCount);
    const perUnitDelta = perUnitProposed - perUnitStandard;
    const pct = perUnitStandard > 0
      ? (perUnitDelta / perUnitStandard) * 100
      : (perUnitProposed > 0 ? null : 0);
    const row: DeviationRow = {
      templateKey: key,
      description,
      perUnitProposed,
      perUnitStandard,
      perUnitDelta,
      pct,
    };
    const arr = groupsByLabel.get(label) ?? [];
    arr.push(row);
    groupsByLabel.set(label, arr);
  }

  const groups: DeviationGroup[] = GROUP_ORDER
    .filter(label => groupsByLabel.has(label))
    .map(label => {
      const rows = groupsByLabel.get(label)!
        .sort((a, b) => a.description.localeCompare(b.description));
      const subtotalProposed = rows.reduce((s, r) => s + r.perUnitProposed, 0);
      const subtotalStandard = rows.reduce((s, r) => s + r.perUnitStandard, 0);
      const subtotalDelta = subtotalProposed - subtotalStandard;
      const subtotalPct = subtotalStandard > 0
        ? (subtotalDelta / subtotalStandard) * 100
        : (subtotalProposed > 0 ? null : 0);
      return { label, rows, subtotalProposed, subtotalStandard, subtotalDelta, subtotalPct };
    });

  const unitLabelPlural = pluralise(ctx.unitLabel, ctx.unitCount);
  const tableHtml = renderDeviationTableHtml(groups, ctx.unitCount, ctx.unitLabel, unitLabelPlural);

  return {
    budgetId: budget.id,
    budgetName: budget.name,
    city: budget.city,
    domain: ctx.key,
    unitLabel: ctx.unitLabel,
    unitLabelPlural,
    unitCount: ctx.unitCount,
    groups,
    tableHtml,
    generatedAt: new Date().toISOString(),
  };
}

function renderDeviationTableHtml(
  groups: DeviationGroup[],
  unitCount: number,
  unitLabel: string,
  unitLabelPlural: string,
): string {
  const parts: string[] = [];
  parts.push(`<p><em>Deviation from the standard budget — per ${unitLabel}, ${unitCount} ${unitLabelPlural}.</em></p>`);
  parts.push(`<table class="data-table">`);
  parts.push(
    `<thead><tr>` +
    `<th>Sl. No</th><th>Budget Item</th>` +
    `<th style="text-align:right">Proposed (₹)</th>` +
    `<th style="text-align:right">Standard (₹)</th>` +
    `<th style="text-align:right">Deviation (₹)</th>` +
    `<th style="text-align:right">%</th>` +
    `</tr></thead>`,
  );
  parts.push(`<tbody>`);
  for (const g of groups) {
    parts.push(
      `<tr><td colspan="6"><strong>${escapeHtml(g.label)}</strong></td></tr>`,
    );
    g.rows.forEach((r, i) => {
      const sl = String.fromCharCode(65 + i); // A, B, C…
      parts.push(
        `<tr>` +
        `<td>${sl}</td>` +
        `<td>${escapeHtml(r.description)}</td>` +
        `<td style="text-align:right">${fmtRs(r.perUnitProposed)}</td>` +
        `<td style="text-align:right">${fmtRs(r.perUnitStandard)}</td>` +
        `<td style="text-align:right">${fmtRs(r.perUnitDelta)}</td>` +
        `<td style="text-align:right">${fmtPct(r.pct)}</td>` +
        `</tr>`,
      );
    });
    parts.push(
      `<tr>` +
      `<td></td>` +
      `<td><strong>Sub-total</strong></td>` +
      `<td style="text-align:right"><strong>${fmtRs(g.subtotalProposed)}</strong></td>` +
      `<td style="text-align:right"><strong>${fmtRs(g.subtotalStandard)}</strong></td>` +
      `<td style="text-align:right"><strong>${fmtRs(g.subtotalDelta)}</strong></td>` +
      `<td style="text-align:right"><strong>${fmtPct(g.subtotalPct)}</strong></td>` +
      `</tr>`,
    );
  }
  parts.push(`</tbody></table>`);
  return parts.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Light list for the budget_picker dropdown — id + label only. Pass a domain
// to filter to that domain's budgets; omit to return all the user's budgets.
export async function listUserBudgets(
  viewerUserId: string,
  domainKey?: string,
): Promise<Array<{ id: string; name: string; city: string }>> {
  const rows = await prisma.budget.findMany({
    where: {
      partnerId: viewerUserId,
      ...(domainKey ? { domains: { has: domainKey } } : {}),
    },
    select: { id: true, name: true, city: true },
    orderBy: { createdAt: "desc" },
  });
  return rows;
}

// ── Back-compat shims ──────────────────────────────────────────────────────
// Thin aliases for callers that haven't migrated yet — point at the generic
// implementations with the Creche domain hard-coded.

export const loadCrecheBudgetSnapshot = (budgetId: string, viewerUserId: string) =>
  loadBudgetSnapshot(budgetId, viewerUserId, "Creche");

export const listUserCrecheBudgets = (viewerUserId: string) =>
  listUserBudgets(viewerUserId, "Creche");

// activeYearBands is imported only to keep the unused-import linter happy when
// generator opts shift; not part of the runtime surface.
void activeYearBands;
