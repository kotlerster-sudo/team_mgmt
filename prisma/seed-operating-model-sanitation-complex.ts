// Sanitation Complex (multi-service) — operating-model template.
// Translated from /Users/vishnuharikumar/Downloads/Sanitation_Complex_Financial_Model_2.xlsx
// (11 sheets: README, Summary, Cost_Recovery, Inputs, Capex, Opex, Revenue,
// PnL_Monthly, PnL_Annual, Scenarios, Sensitivity).
//
// Run:  npx tsx prisma/seed-operating-model-sanitation-complex.ts

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DEFAULT_COMPLEX_CONSTANTS, DEFAULT_COMPLEX_PRESENTATION } from "../lib/models/simConfig";
import { SANITATION_RATES } from "../lib/sanitation/rates";

// Strip the "san." prefix so ModelNode keys stay local to this template's namespace.
const RATE_KEY = (k: string) => k.replace(/^san\./, "");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TEMPLATE_KEY = "sanitation_complex";

async function main() {
  // Additive upsert — preserves ModelInstances (user scenarios) + publicSlug
  // across re-seeds. Historical destructive re-seed lost the "ISC" scenario
  // and the /models-public/sanitation-complex slug 2026-07-27.
  const template = await prisma.modelTemplate.upsert({
    where: { key: TEMPLATE_KEY },
    create: {
      key: TEMPLATE_KEY,
      name: "Sanitation Complex (multi-service)",
      description:
        "Multi-service community sanitation complex: toilet, bath, laundry, RO water, monthly pass.",
      horizons: [
        { key: "monthly", length: 60 },
        { key: "annual", length: 5 },
      ],
      sortOrder: 20,
    },
    update: {
      name: "Sanitation Complex (multi-service)",
      description:
        "Multi-service community sanitation complex: toilet, bath, laundry, RO water, monthly pass.",
      horizons: [
        { key: "monthly", length: 60 },
        { key: "annual", length: 5 },
      ],
      sortOrder: 20,
    },
  });

  const groupDefs = [
    ["site", "Site & Population"],
    ["capacity", "Service Capacity"],
    ["usage", "Service Usage"],
    ["adoption", "Adoption Curve"],
    ["pricing", "Pricing per Service"],
    ["capex_in", "Capital Expenditure"],
    ["opex_in", "Operating Expenses"],
    ["equity", "Equity & Social Access"],
    ["financial", "Financial Parameters"],
    ["capex", "Capex (derived)"],
    ["opex", "Opex (derived)"],
    ["revenue", "Revenue (derived)"],
    ["pnl", "P&L (derived)"],
    ["cost_recovery", "Cost Recovery"],
    ["ops", "Operations (sim)"],
  ] as const;
  // Capex/financial inputs are finance-only (vanish on the sim tab); ops is
  // sim-only; everything else shows on both.
  const groupSurface: Record<string, "finance" | "sim" | "both"> = {
    capex_in: "finance", financial: "finance", ops: "sim",
  };
  const groups: Record<string, string> = {};
  const seedGroupKeys = new Set<string>();
  for (let i = 0; i < groupDefs.length; i++) {
    const [key, label] = groupDefs[i];
    seedGroupKeys.add(key);
    const g = await prisma.modelGroup.upsert({
      where: { templateId_key: { templateId: template.id, key } },
      create: { templateId: template.id, key, label, order: i, surface: groupSurface[key] ?? "both" },
      update: { label, order: i, surface: groupSurface[key] ?? "both" },
    });
    groups[key] = g.id;
  }
  // Prune groups no longer in the seed (their nodes cascade via templateId FK
  // on ModelNode.groupId? no — nodes don't cascade on groupId. Delete stale
  // nodes first, then the stale group.).
  const staleGroups = await prisma.modelGroup.findMany({
    where: { templateId: template.id, key: { notIn: [...seedGroupKeys] } },
    select: { id: true, key: true },
  });
  if (staleGroups.length > 0) {
    await prisma.modelNode.deleteMany({ where: { groupId: { in: staleGroups.map(g => g.id) } } });
    await prisma.modelGroup.deleteMany({ where: { id: { in: staleGroups.map(g => g.id) } } });
    console.log(`  pruned ${staleGroups.length} stale group(s): ${staleGroups.map(g => g.key).join(", ")}`);
  }

  type NodeIn = {
    key: string; label: string; kind: "input" | "formula" | "constant";
    dataType: "number" | "percent" | "currency" | "int" | "boolean" | "enum";
    shape?: { kind: "scalar" } | { kind: "vector"; horizon: string };
    defaultJson?: number | number[] | string | boolean;
    formula?: string;
    unit?: string;
    notes?: string;
    group: string;
    surface?: "finance" | "sim" | "both";
    tier?: "basic" | "advanced";
    ui?: { min?: number; max?: number; step?: number };
  };

  const nodes: NodeIn[] = [
    // ── 1. Site & Population ───────────────────────────────────────────────
    { group: "site", key: "hh_count", label: "Households in service area", kind: "input", dataType: "int", defaultJson: 420, unit: "HH", ui: { min: 100, max: 800, step: 10 } },
    { group: "site", key: "persons_per_hh", label: "Persons per household", kind: "input", dataType: "number", defaultJson: 5, unit: "persons", ui: { min: 3, max: 8, step: 0.5 } },
    { group: "site", key: "daily_users_estimate", label: "Daily users (estimated)", kind: "input", dataType: "int", defaultJson: 500, unit: "users/day", notes: "At steady state", surface: "finance" },

    // ── 2. Service Capacity ────────────────────────────────────────────────
    { group: "capacity", key: "wc_seats", label: "Total WC seats (M+F+DA)", kind: "input", dataType: "int", defaultJson: 52, unit: "seats", notes: "Total toilet pans across men's, women's, and disabled-access blocks.", ui: { min: 6, max: 80, step: 2 } },
    { group: "capacity", key: "bath_cubicles", label: "Bathing cubicles", kind: "input", dataType: "int", defaultJson: 20, unit: "cubicles", notes: "Number of enclosed bathing stalls.", ui: { min: 0, max: 24, step: 1 } },
    { group: "capacity", key: "washing_machines", label: "Washing machines", kind: "input", dataType: "int", defaultJson: 10, unit: "machines", notes: "Number of washing machines for the laundry service.", ui: { min: 0, max: 14, step: 1 } },
    { group: "capacity", key: "ro_lph", label: "RO Water ATM capacity", kind: "input", dataType: "int", defaultJson: 1000, unit: "L/hour", notes: "How fast the RO plant can produce drinking water at full tilt.", ui: { min: 250, max: 2000, step: 50 } },
    { group: "capacity", key: "ro_operating_hours", label: "RO plant daily operating hours", kind: "input", dataType: "number", defaultJson: 12, unit: "hours/day", notes: "Hours per day the RO plant runs (starting 6 AM). Off-hours, the dispenser draws from the tank.", ui: { min: 4, max: 24, step: 1 } },
    { group: "capacity", key: "facility_open_hours", label: "Complex open hours", kind: "input", dataType: "number", defaultJson: 16, unit: "hours/day", notes: "Hours per day the complex is open to users (starting 6 AM). Toilet, bath, and laundry only serve during these hours.", ui: { min: 6, max: 24, step: 1 } },
    { group: "capacity", key: "stp_kld", label: "Greywater treatment capacity", kind: "input", dataType: "number", defaultJson: 28, unit: "KL/day", notes: "Daily greywater treatment capacity. Treated water is recycled back as toilet flush + cleaning water — reducing fresh BWSSB draw.", ui: { min: 4, max: 40, step: 1 } },
    // RO buffers — sim-relevant but real spec, so "both".
    { group: "capacity", key: "ro_tank_litres", label: "RO product tank size", kind: "input", dataType: "int", defaultJson: 4000, unit: "L", notes: "Storage tank that banks water produced during quiet hours for the morning rush.", ui: { min: 1000, max: 8000, step: 250 } },
    { group: "capacity", key: "ro_cans_count", label: "RO pre-packed 10 L cans", kind: "input", dataType: "int", defaultJson: 50, unit: "cans", notes: "Pre-filled 10-litre cans held as a backup when the tank runs low.", ui: { min: 0, max: 150, step: 5 } },
    // Physical daily throughput ceilings — demand above these is capped (revenue
    // can't exceed what each service can physically deliver). Uses the same
    // per-hour throughput basis as the sim.
    { group: "capacity", key: "cap_toilet_uses_day", label: "Toilet capacity / day", kind: "formula", dataType: "number", formula: "wc_seats * seat_throughput * facility_open_hours", unit: "uses/day" },
    { group: "capacity", key: "cap_bath_uses_day", label: "Bath capacity / day", kind: "formula", dataType: "number", formula: "bath_cubicles * bath_throughput * facility_open_hours", unit: "baths/day" },
    { group: "capacity", key: "cap_laundry_loads_day", label: "Laundry capacity / day", kind: "formula", dataType: "number", formula: "washing_machines * machine_throughput * facility_open_hours", unit: "loads/day" },
    { group: "capacity", key: "cap_ro_litres_day", label: "RO capacity / day", kind: "formula", dataType: "number", formula: "ro_lph * ro_operating_hours", unit: "L/day" },

    // ── 3. Service Usage Assumptions ───────────────────────────────────────
    { group: "usage", key: "toilet_uses_per_person_per_day", label: "Toilet uses per active person/day", kind: "input", dataType: "number", defaultJson: 3, unit: "uses/day", ui: { min: 1, max: 6, step: 0.5 } },
    { group: "usage", key: "bath_share", label: "% of active users who bathe", kind: "input", dataType: "percent", defaultJson: 0.20, unit: "%", ui: { min: 0.05, max: 0.6, step: 0.05 } },
    { group: "usage", key: "laundry_loads_per_active_hh_per_week", label: "Laundry loads per active HH/week", kind: "input", dataType: "number", defaultJson: 2, unit: "loads/HH/wk", ui: { min: 0.5, max: 5, step: 0.5 } },
    { group: "usage", key: "laundry_loads_per_machine_per_day", label: "Laundry loads per machine per day", kind: "input", dataType: "number", defaultJson: 3.5, unit: "loads/day", surface: "finance" },
    { group: "usage", key: "ro_litres_per_active_hh_per_day", label: "RO litres per active HH/day", kind: "input", dataType: "number", defaultJson: 18, unit: "L/HH/day", ui: { min: 4, max: 25, step: 1 } },

    // ── 4. Adoption Curve ──────────────────────────────────────────────────
    // Ramp months are finance-only; the sim runs at steady adoption_y3.
    { group: "adoption", key: "adoption_m3", label: "Month 3 adoption", kind: "input", dataType: "percent", defaultJson: 0.25, unit: "% of HH", surface: "finance" },
    { group: "adoption", key: "adoption_m6", label: "Month 6 adoption", kind: "input", dataType: "percent", defaultJson: 0.45, unit: "% of HH", surface: "finance" },
    { group: "adoption", key: "adoption_m12", label: "Month 12 adoption", kind: "input", dataType: "percent", defaultJson: 0.65, unit: "% of HH", surface: "finance" },
    { group: "adoption", key: "adoption_y2", label: "Year 2 average adoption", kind: "input", dataType: "percent", defaultJson: 0.75, unit: "% of HH", surface: "finance" },
    { group: "adoption", key: "adoption_y3", label: "Active adoption (% of HH)", kind: "input", dataType: "percent", defaultJson: 0.80, unit: "% of HH", notes: "Share of households in the area who actively use the complex.", ui: { min: 0.2, max: 1, step: 0.05 } },

    // ── 5. Pricing per Service ─────────────────────────────────────────────
    { group: "pricing", key: "price_toilet", label: "Toilet — per use", kind: "input", dataType: "currency", defaultJson: 2, unit: "INR/use", ui: { min: 0, max: 6, step: 0.5 } },
    { group: "pricing", key: "price_bath", label: "Bath — per use", kind: "input", dataType: "currency", defaultJson: 8, unit: "INR/bath", ui: { min: 0, max: 25, step: 1 } },
    { group: "pricing", key: "price_laundry", label: "Laundry — per load", kind: "input", dataType: "currency", defaultJson: 50, unit: "INR/load", ui: { min: 0, max: 100, step: 5 } },
    { group: "pricing", key: "price_ro_per_litre", label: "RO water — per litre", kind: "input", dataType: "currency", defaultJson: 2, unit: "INR/L", ui: { min: 0, max: 5, step: 0.25 } },
    { group: "pricing", key: "monthly_pass_price", label: "Monthly household pass", kind: "input", dataType: "currency", defaultJson: 150, unit: "INR/HH/mo", ui: { min: 0, max: 400, step: 10 } },
    { group: "pricing", key: "pass_holder_share", label: "% active HH on monthly pass", kind: "input", dataType: "percent", defaultJson: 0.40, unit: "%", ui: { min: 0, max: 0.8, step: 0.05 } },

    // ── 6. Capex — parametric ─────────────────────────────────────────────
    // User-facing capacity inputs. Every capex line derives from these + the
    // per-unit rate constants below (which mirror lib/sanitation/rates.ts and
    // are seeded into CostRegistry too — one source of truth across model + budget).
    { group: "capex_in", key: "structure_is_single", label: "Structure = single floor", kind: "input", dataType: "int", defaultJson: 0, unit: "0/1", notes: "Set to 1 for single-floor block (mutually exclusive with G+1 / G+2)." },
    { group: "capex_in", key: "structure_is_g1", label: "Structure = G + 1", kind: "input", dataType: "int", defaultJson: 0, unit: "0/1" },
    { group: "capex_in", key: "structure_is_g2", label: "Structure = G + 2", kind: "input", dataType: "int", defaultJson: 1, unit: "0/1", notes: "Default. Suvidha-style multi-storey." },
    { group: "capex_in", key: "area_sqm_override", label: "Built-up area override (0 = auto)", kind: "input", dataType: "number", defaultJson: 0, unit: "sqm", notes: "0 lets the model derive area from fixtures. Set to a positive number to force a specific plot size.", surface: "finance", ui: { min: 0, max: 800, step: 10 } },
    { group: "capex_in", key: "solar_kwp", label: "Solar PV capacity", kind: "input", dataType: "number", defaultJson: 5, unit: "kWp", ui: { min: 0, max: 15, step: 0.5 } },
    { group: "capex_in", key: "tank_storage_litres", label: "Water storage (UG + OH)", kind: "input", dataType: "int", defaultJson: 33000, unit: "L", ui: { min: 0, max: 100000, step: 1000 } },

    // Per-unit rate constants — one per SANITATION_RATES entry. Kept in sync
    // with the budget-side CostRegistry via lib/sanitation/rates.ts. Emitted
    // as `constant` so the admin can't accidentally edit them per-scenario;
    // permanent changes to rates go through the shared rates module.
    ...SANITATION_RATES.map((r, i) => ({
      group: "capex_in",
      key: RATE_KEY(r.key),
      label: `Rate — ${r.notes ?? r.key}`,
      kind: "constant" as const,
      dataType: "number" as const,
      defaultJson: r.standardUnitCost,
      unit: r.costUnit,
      notes: r.derivation ?? r.notes,
      surface: "finance" as const,
    })),

    // Structure-type-aware ₹/sqm resolvers (mirror the budget's computed keys).
    { group: "capex_in", key: "civil_rate_per_sqm", label: "Civil rate (₹/sqm, resolved)", kind: "formula", dataType: "currency", formula: "structure_is_g2 * civil_per_sqm_g2 + structure_is_g1 * civil_per_sqm_g1 + structure_is_single * civil_per_sqm_single", unit: "₹/sqm", surface: "finance" },
    { group: "capex_in", key: "electrical_rate_per_sqm", label: "Electrical rate (₹/sqm, resolved)", kind: "formula", dataType: "currency", formula: "structure_is_g2 * electrical_per_sqm_g2 + structure_is_g1 * electrical_per_sqm_g1 + structure_is_single * electrical_per_sqm_single", unit: "₹/sqm", surface: "finance" },

    // Auto-derived area — user's fixtures + service rooms + circulation, or override.
    { group: "capex_in", key: "area_sqm_derived", label: "Built-up area (derived)", kind: "formula", dataType: "number", formula: "IF(area_sqm_override > 0, area_sqm_override, (wc_seats * sqm_per_wc_seat + bath_cubicles * sqm_per_bath + washing_machines * sqm_per_machine + stp_kld * sqm_per_stp_kld + sqm_ro_room_fixed + sqm_service_rooms_fixed) * (1 + sqm_circulation_pct / 100))", unit: "sqm" },

    // Capex lines — each = per-unit rate × capacity (+ fixed).
    { group: "capex_in", key: "capex_civil",             label: "Civil construction",           kind: "formula", dataType: "currency", formula: "area_sqm_derived * civil_rate_per_sqm + civil_shell_fixed", unit: "INR" },
    { group: "capex_in", key: "capex_plumbing",          label: "Plumbing + sanitaryware",      kind: "formula", dataType: "currency", formula: "wc_seats * plumbing_per_wc_seat + bath_cubicles * plumbing_per_bath + washing_machines * plumbing_per_machine + ro_lph * plumbing_per_ro_lph + plumbing_fixed", unit: "INR" },
    { group: "capex_in", key: "capex_washing_machines",  label: "Washing machines + spin dryers", kind: "formula", dataType: "currency", formula: "washing_machines * capex_per_washing_machine", unit: "INR" },
    { group: "capex_in", key: "capex_ro",                label: "RO plant + Water ATM",         kind: "formula", dataType: "currency", formula: "ro_lph * capex_per_ro_lph", unit: "INR" },
    { group: "capex_in", key: "capex_stp",               label: "Greywater MBBR STP",           kind: "formula", dataType: "currency", formula: "stp_kld * capex_stp_per_kld", unit: "INR" },
    { group: "capex_in", key: "capex_biodigester",       label: "Biodigester / septic",         kind: "formula", dataType: "currency", formula: "wc_seats * capex_biodigester_per_seat", unit: "INR" },
    { group: "capex_in", key: "capex_tanks",             label: "Storage tanks (UG + OH)",      kind: "formula", dataType: "currency", formula: "tank_storage_litres * tanks_per_litre + tanks_fixed", unit: "INR" },
    { group: "capex_in", key: "capex_solar",             label: "Solar PV system",              kind: "formula", dataType: "currency", formula: "solar_kwp * solar_per_kwp", unit: "INR" },
    { group: "capex_in", key: "capex_electrical",        label: "Electrical works",             kind: "formula", dataType: "currency", formula: "area_sqm_derived * electrical_rate_per_sqm + electrical_fixed", unit: "INR" },
    { group: "capex_in", key: "capex_iot",               label: "Payment + IoT monitoring",     kind: "formula", dataType: "currency", formula: "wc_seats * iot_per_wc_seat + bath_cubicles * iot_per_bath + iot_fixed", unit: "INR" },
    { group: "capex_in", key: "capex_approval",          label: "Approval fees",                kind: "formula", dataType: "currency", formula: "approval_fixed + wc_seats * approval_per_seat", unit: "INR" },
    { group: "capex_in", key: "capex_signage",           label: "Signage, accessibility, furnishings", kind: "formula", dataType: "currency", formula: "(wc_seats + bath_cubicles + washing_machines) * signage_per_fixture + signage_fixed", unit: "INR" },
    { group: "capex_in", key: "capex_design",            label: "Design + supervision",         kind: "formula", dataType: "currency", formula: "(capex_civil + capex_plumbing + capex_washing_machines + capex_ro + capex_stp + capex_biodigester + capex_tanks + capex_solar + capex_electrical + capex_iot + capex_approval + capex_signage) * design_pct_of_hardware / 100", unit: "INR" },
    { group: "capex_in", key: "capex_contingency_pct", label: "Contingency (fraction, derived from rate)", kind: "formula", dataType: "percent", formula: "contingency_pct_of_subtotal / 100", unit: "%" },
    { group: "capex_in", key: "capex_tax_pct",         label: "GST + taxes (fraction, derived from rate)", kind: "formula", dataType: "percent", formula: "tax_pct_of_subtotal / 100", unit: "%" },

    // ── 7. Opex inputs ─────────────────────────────────────────────────────
    // ── Staffing: headcount × salary per role. Number can move independently of
    // salary — letting the user grow the team without inflating every cost line.
    { group: "opex_in", key: "num_caretakers", label: "Caretakers (headcount)", kind: "input", dataType: "int", defaultJson: 3, unit: "people", notes: "Total caretakers on payroll. Default 3 = one per 8-hour shift × 3 shifts/day.", ui: { min: 1, max: 9, step: 1 } },
    { group: "opex_in", key: "salary_caretaker_per_shift", label: "Caretaker salary", kind: "input", dataType: "currency", defaultJson: 12000, unit: "INR/person/mo" },
    // Plant operator + laundry supervisor now GATE on capacity: 0 headcount
    // when the corresponding service is absent (a toilet-only block doesn't
    // carry these roles). The user's override still applies via the input.
    { group: "opex_in", key: "num_plant_operators_override", label: "Plant operators (override; 0 = auto)", kind: "input", dataType: "int", defaultJson: 0, unit: "people", notes: "0 lets the model auto-gate on capacity (1 if RO or STP > 0, else 0). Positive = force this headcount.", surface: "finance", ui: { min: 0, max: 4, step: 1 } },
    { group: "opex_in", key: "num_plant_operators", label: "Plant operators (headcount, resolved)", kind: "formula", dataType: "int", formula: "IF(num_plant_operators_override > 0, num_plant_operators_override, IF(ro_lph > 0 || stp_kld > 0, 1, 0))", unit: "people" },
    { group: "opex_in", key: "salary_plant_operator", label: "Plant operator salary", kind: "input", dataType: "currency", defaultJson: 10000, unit: "INR/person/mo" },
    { group: "opex_in", key: "num_laundry_supervisors_override", label: "Laundry supervisors (override; 0 = auto)", kind: "input", dataType: "int", defaultJson: 0, unit: "people", notes: "0 lets the model auto-gate (1 if washing machines > 0, else 0).", surface: "finance", ui: { min: 0, max: 3, step: 1 } },
    { group: "opex_in", key: "num_laundry_supervisors", label: "Laundry supervisors (headcount, resolved)", kind: "formula", dataType: "int", formula: "IF(num_laundry_supervisors_override > 0, num_laundry_supervisors_override, IF(washing_machines > 0, 1, 0))", unit: "people" },
    { group: "opex_in", key: "salary_laundry_supervisor", label: "Laundry supervisor salary", kind: "input", dataType: "currency", defaultJson: 8000, unit: "INR/person/mo" },
    { group: "opex_in", key: "num_security_guards", label: "Security guards (headcount)", kind: "input", dataType: "int", defaultJson: 2, unit: "people", notes: "Guards across day and night. Default 2 = day + night cover.", ui: { min: 0, max: 6, step: 1 } },
    { group: "opex_in", key: "salary_security_guard", label: "Security guard salary", kind: "input", dataType: "currency", defaultJson: 10000, unit: "INR/person/mo" },
    { group: "opex_in", key: "num_admin_cashiers", label: "Admin / cashier (headcount)", kind: "input", dataType: "int", defaultJson: 1, unit: "people", notes: "Cashier + records — pass sales and daily accounts.", ui: { min: 0, max: 3, step: 1 } },
    { group: "opex_in", key: "salary_admin_cashier", label: "Admin / cashier salary", kind: "input", dataType: "currency", defaultJson: 12000, unit: "INR/person/mo" },

    // ── Variable opex: per-unit rates. The monthly totals (electricity, water,
    // consumables, desludging) below are now derived from capacity × usage ×
    // these rates, so growing the facility automatically grows its cost-to-serve.
    { group: "opex_in", key: "kwh_per_ro_litre", label: "RO electricity intensity", kind: "input", dataType: "number", defaultJson: 0.004, unit: "kWh/L product", notes: "Pump + booster, per L of product water", ui: { min: 0.001, max: 0.012, step: 0.0005 } },
    { group: "opex_in", key: "kwh_per_laundry_load", label: "Electricity per laundry load", kind: "input", dataType: "number", defaultJson: 0.7, unit: "kWh/load", ui: { min: 0.3, max: 2, step: 0.1 } },
    { group: "opex_in", key: "kwh_per_bath_heating", label: "Electricity per bath (water heating)", kind: "input", dataType: "number", defaultJson: 0.87, unit: "kWh/bath", notes: "25 L at ΔT=30°C ≈ 0.87 kWh. Set to 0 if cold-water bathing or solar-heated", ui: { min: 0, max: 2, step: 0.05 } },
    { group: "opex_in", key: "kwh_lighting_per_open_hour", label: "Lighting + small loads", kind: "input", dataType: "number", defaultJson: 1.5, unit: "kWh/open-hour", notes: "Lights, fans, controls — scales with open hours", ui: { min: 0.5, max: 6, step: 0.25 } },
    { group: "opex_in", key: "electricity_tariff", label: "Electricity tariff", kind: "input", dataType: "currency", defaultJson: 9, unit: "INR/kWh", notes: "BESCOM commercial slab average", ui: { min: 5, max: 18, step: 0.5 } },
    { group: "opex_in", key: "solar_offset_kwh_per_day", label: "Solar offset (avg)", kind: "input", dataType: "number", defaultJson: 22, unit: "kWh/day", notes: "5 kWp default ≈ 22 kWh/day net of cloudy days", ui: { min: 0, max: 80, step: 2 } },
    { group: "opex_in", key: "bwssb_inr_per_kl", label: "BWSSB water tariff", kind: "input", dataType: "currency", defaultJson: 60, unit: "INR/KL", notes: "Commercial slab average", ui: { min: 20, max: 150, step: 5 } },
    { group: "opex_in", key: "cleaning_inr_per_visit", label: "Cleaning consumable per visit", kind: "input", dataType: "currency", defaultJson: 0.05, unit: "INR/visit", notes: "Toilet + bath visits", ui: { min: 0.01, max: 0.4, step: 0.01 } },
    { group: "opex_in", key: "detergent_inr_per_load", label: "Detergent + finisher per load", kind: "input", dataType: "currency", defaultJson: 1.4, unit: "INR/load", ui: { min: 0.5, max: 8, step: 0.1 } },
    { group: "opex_in", key: "ro_consumables_inr_per_kl", label: "RO consumables per KL product", kind: "input", dataType: "currency", defaultJson: 25, unit: "INR/KL", notes: "Membranes, cartridges, antiscalant — amortised", ui: { min: 5, max: 80, step: 1 } },
    { group: "opex_in", key: "stp_consumables_inr_per_kl_treated", label: "STP consumables per KL treated", kind: "input", dataType: "currency", defaultJson: 7, unit: "INR/KL", notes: "Media top-up, blower energy chemicals", ui: { min: 2, max: 25, step: 0.5 } },
    { group: "opex_in", key: "desludging_inr_per_1000_uses", label: "Desludging per 1000 toilet uses", kind: "input", dataType: "currency", defaultJson: 10, unit: "INR/1000 uses", notes: "Septic pump-out amortised", ui: { min: 2, max: 50, step: 1 } },

    // ── Flat reserves: don't scale with usage. AMC + tech are contract fees;
    // lab is per-visit + quarterly schedule.
    { group: "opex_in", key: "amc_pct_annual", label: "AMC / maintenance (% of capex per year)", kind: "input", dataType: "percent", defaultJson: 0.0025, unit: "%", notes: "Maintenance reserve as a share of total capex (scales with facility size)." },
    { group: "opex", key: "amc_monthly", label: "Maintenance / AMC reserve", kind: "formula", dataType: "currency", formula: "capex_total * amc_pct_annual / 12", unit: "INR/mo", notes: "Scales with capex_total" },
    { group: "opex_in", key: "tech_monthly", label: "Technology / monitoring fee", kind: "input", dataType: "currency", defaultJson: 2500, unit: "INR/mo" },
    { group: "opex_in", key: "lab_quarterly", label: "Water quality testing (NABL)", kind: "input", dataType: "currency", defaultJson: 5000, unit: "INR/quarter" },

    // ── 8. Equity & Social Access ──────────────────────────────────────────
    { group: "equity", key: "free_use_quota", label: "Free-use quota (% of capacity)", kind: "input", dataType: "percent", defaultJson: 0.10, unit: "%", notes: "Share of toilet + bath capacity given free to the poorest, elderly, and disabled.", ui: { min: 0, max: 0.4, step: 0.05 } },
    { group: "equity", key: "pilot_free_first_3mo", label: "Year-1 first 3 months free pilot", kind: "input", dataType: "boolean", defaultJson: 1, notes: "1 = first 3 months are free for everyone to drive uptake. 0 = charge from launch.", surface: "finance" },

    // ── 9. Financial Parameters ────────────────────────────────────────────
    { group: "financial", key: "cost_inflation", label: "YoY cost inflation", kind: "input", dataType: "percent", defaultJson: 0.06, unit: "%" },
    { group: "financial", key: "price_increase", label: "YoY price increase", kind: "input", dataType: "percent", defaultJson: 0.05, unit: "%" },
    { group: "financial", key: "grant_share", label: "Capex grant funding share", kind: "input", dataType: "percent", defaultJson: 1.0, unit: "%" },
    { group: "financial", key: "discount_rate", label: "Discount rate (NPV)", kind: "input", dataType: "percent", defaultJson: 0.08, unit: "%" },

    // ── Capex derived ──────────────────────────────────────────────────────
    { group: "capex", key: "capex_subtotal", label: "Capex subtotal", kind: "formula", dataType: "currency",
      formula: "capex_civil + capex_plumbing + capex_washing_machines + capex_ro + capex_stp + capex_biodigester + capex_tanks + capex_solar + capex_electrical + capex_iot + capex_approval + capex_design + capex_signage",
      unit: "INR" },
    { group: "capex", key: "capex_contingency", label: "Contingency", kind: "formula", dataType: "currency", formula: "capex_subtotal * capex_contingency_pct", unit: "INR" },
    { group: "capex", key: "capex_tax", label: "GST + taxes", kind: "formula", dataType: "currency", formula: "capex_subtotal * capex_tax_pct", unit: "INR" },
    { group: "capex", key: "capex_total", label: "TOTAL CAPEX", kind: "formula", dataType: "currency", formula: "capex_subtotal + capex_contingency + capex_tax", unit: "INR" },
    { group: "capex", key: "capex_per_wc_seat", label: "Capex per WC seat", kind: "formula", dataType: "currency", formula: "capex_total / wc_seats", unit: "INR/seat", notes: "SBM benchmark ≈ INR 98K/seat" },
    { group: "capex", key: "capex_per_hh", label: "Capex per household served", kind: "formula", dataType: "currency", formula: "capex_total / hh_count", unit: "INR/HH" },

    // ── Steady-state activity (derived) ────────────────────────────────────
    // Activity at adoption_y3 — the base everything below scales off of.
    { group: "opex", key: "active_hh_steady", label: "Active HH (steady)", kind: "formula", dataType: "number", formula: "hh_count * adoption_y3", unit: "HH" },
    { group: "opex", key: "active_persons_steady", label: "Active persons (steady)", kind: "formula", dataType: "number", formula: "active_hh_steady * persons_per_hh", unit: "persons" },
    { group: "opex", key: "toilet_uses_per_day_steady", label: "Toilet uses/day (steady)", kind: "formula", dataType: "number", formula: "active_persons_steady * toilet_uses_per_person_per_day", unit: "uses/day" },
    { group: "opex", key: "bath_uses_per_day_steady", label: "Baths/day (steady)", kind: "formula", dataType: "number", formula: "active_persons_steady * bath_share", unit: "baths/day" },
    { group: "opex", key: "laundry_loads_per_day_steady", label: "Loads/day (steady)", kind: "formula", dataType: "number", formula: "active_hh_steady * laundry_loads_per_active_hh_per_week / 7", unit: "loads/day" },
    { group: "opex", key: "ro_litres_per_day_steady", label: "RO litres/day (steady)", kind: "formula", dataType: "number", formula: "active_hh_steady * ro_litres_per_active_hh_per_day", unit: "L/day" },
    // Served (capacity-capped) steady throughput — feeds opex + water balance.
    { group: "opex", key: "served_toilet_uses_per_day_steady", label: "Toilet uses/day served (capped)", kind: "formula", dataType: "number", formula: "IF(toilet_uses_per_day_steady < cap_toilet_uses_day, toilet_uses_per_day_steady, cap_toilet_uses_day)", unit: "uses/day" },
    { group: "opex", key: "served_bath_uses_per_day_steady", label: "Baths/day served (capped)", kind: "formula", dataType: "number", formula: "IF(bath_uses_per_day_steady < cap_bath_uses_day, bath_uses_per_day_steady, cap_bath_uses_day)", unit: "baths/day" },
    { group: "opex", key: "served_laundry_loads_per_day_steady", label: "Loads/day served (capped)", kind: "formula", dataType: "number", formula: "IF(laundry_loads_per_day_steady < cap_laundry_loads_day, laundry_loads_per_day_steady, cap_laundry_loads_day)", unit: "loads/day" },
    { group: "opex", key: "served_ro_litres_per_day_steady", label: "RO litres/day served (capped)", kind: "formula", dataType: "number", formula: "IF(ro_litres_per_day_steady < cap_ro_litres_day, ro_litres_per_day_steady, cap_ro_litres_day)", unit: "L/day" },
    { group: "opex", key: "capacity_utilisation_steady", label: "Capacity headroom (tightest service)", kind: "formula", dataType: "percent", formula: "MIN(IFERROR(served_toilet_uses_per_day_steady / toilet_uses_per_day_steady, 1), IFERROR(served_bath_uses_per_day_steady / bath_uses_per_day_steady, 1), IFERROR(served_laundry_loads_per_day_steady / laundry_loads_per_day_steady, 1), IFERROR(served_ro_litres_per_day_steady / ro_litres_per_day_steady, 1))", unit: "%", notes: "Share of steady demand the tightest service can serve (100% = enough capacity everywhere)." },

    // ── Staff totals: headcount × salary ───────────────────────────────────
    { group: "opex", key: "opex_caretakers", label: "Caretakers (total)", kind: "formula", dataType: "currency", formula: "num_caretakers * salary_caretaker_per_shift", unit: "INR/mo" },
    { group: "opex", key: "opex_plant_operators_total", label: "Plant operators (total)", kind: "formula", dataType: "currency", formula: "num_plant_operators * salary_plant_operator", unit: "INR/mo" },
    { group: "opex", key: "opex_laundry_supervisors_total", label: "Laundry supervisors (total)", kind: "formula", dataType: "currency", formula: "num_laundry_supervisors * salary_laundry_supervisor", unit: "INR/mo" },
    { group: "opex", key: "opex_security_total", label: "Security guards (total)", kind: "formula", dataType: "currency", formula: "num_security_guards * salary_security_guard", unit: "INR/mo" },
    { group: "opex", key: "opex_admin_cashier_total", label: "Admin / cashier (total)", kind: "formula", dataType: "currency", formula: "num_admin_cashiers * salary_admin_cashier", unit: "INR/mo" },
    { group: "opex", key: "opex_staff_steady", label: "Staff opex (steady)", kind: "formula", dataType: "currency", formula: "opex_caretakers + opex_plant_operators_total + opex_laundry_supervisors_total + opex_security_total + opex_admin_cashier_total", unit: "INR/mo" },

    // ── Water balance at steady state (mirrors the day-sim engine) ─────────
    // Greywater (bath + laundry + handwash + RO reject) is treated by DEWATS up
    // to its KLD limit; recycled output substitutes for fresh in toilet flush +
    // cleaning. Net BWSSB cost ↑ when greywater exceeds treatment cap.
    { group: "opex", key: "bath_water_l_day", label: "Bath water (L/day)", kind: "formula", dataType: "number", formula: "served_bath_uses_per_day_steady * 25", unit: "L/day", notes: "25 L/bath engineering norm" },
    { group: "opex", key: "laundry_water_l_day", label: "Laundry water (L/day)", kind: "formula", dataType: "number", formula: "served_laundry_loads_per_day_steady * 55", unit: "L/day", notes: "55 L/load" },
    { group: "opex", key: "handwash_water_l_day", label: "Handwash water (L/day)", kind: "formula", dataType: "number", formula: "served_toilet_uses_per_day_steady * 1.5", unit: "L/day", notes: "1.5 L/visit" },
    { group: "opex", key: "ro_feed_l_day", label: "RO feed water (L/day)", kind: "formula", dataType: "number", formula: "served_ro_litres_per_day_steady / ro_recovery_rate", unit: "L/day" },
    { group: "opex", key: "ro_reject_l_day", label: "RO reject (L/day)", kind: "formula", dataType: "number", formula: "ro_feed_l_day - served_ro_litres_per_day_steady", unit: "L/day" },
    { group: "opex", key: "greywater_l_day", label: "Greywater (L/day)", kind: "formula", dataType: "number", formula: "bath_water_l_day + laundry_water_l_day + handwash_water_l_day + ro_reject_l_day", unit: "L/day" },
    { group: "opex", key: "recycle_demand_l_day", label: "Recycle demand (L/day)", kind: "formula", dataType: "number", formula: "served_toilet_uses_per_day_steady * 5 + 150 + wc_seats * 8 + bath_cubicles * 12 + washing_machines * 5", unit: "L/day", notes: "5 L per flush + fixture cleaning (8 L/seat + 12 L/cubicle + 5 L/machine + 150 L common area)" },
    { group: "opex", key: "recycled_used_l_day", label: "Recycled used (L/day)", kind: "formula", dataType: "number", formula: "MIN(MIN(greywater_l_day, stp_kld * 1000), recycle_demand_l_day)", unit: "L/day" },
    { group: "opex", key: "fresh_water_l_day_steady", label: "Fresh BWSSB water (L/day, steady)", kind: "formula", dataType: "number", formula: "bath_water_l_day + laundry_water_l_day + handwash_water_l_day + ro_feed_l_day + MAX(0, recycle_demand_l_day - recycled_used_l_day)", unit: "L/day" },
    { group: "opex", key: "stp_kl_treated_per_day", label: "STP throughput (KL/day)", kind: "formula", dataType: "number", formula: "MIN(greywater_l_day, stp_kld * 1000) / 1000", unit: "KL/day" },

    // ── Electricity load (derived) ─────────────────────────────────────────
    { group: "opex", key: "electricity_ro_kwh_per_day", label: "RO electricity (kWh/day)", kind: "formula", dataType: "number", formula: "served_ro_litres_per_day_steady * kwh_per_ro_litre", unit: "kWh/day" },
    { group: "opex", key: "electricity_laundry_kwh_per_day", label: "Laundry electricity (kWh/day)", kind: "formula", dataType: "number", formula: "served_laundry_loads_per_day_steady * kwh_per_laundry_load", unit: "kWh/day" },
    { group: "opex", key: "electricity_bath_heating_kwh_per_day", label: "Bath water heating (kWh/day)", kind: "formula", dataType: "number", formula: "served_bath_uses_per_day_steady * kwh_per_bath_heating", unit: "kWh/day", notes: "Set kwh_per_bath_heating to 0 if cold-water bathing or solar-heated geyser" },
    { group: "opex", key: "electricity_lighting_kwh_per_day", label: "Lighting + small loads (kWh/day)", kind: "formula", dataType: "number", formula: "facility_open_hours * kwh_lighting_per_open_hour", unit: "kWh/day" },
    { group: "opex", key: "electricity_kwh_net_per_day", label: "Net grid electricity (kWh/day)", kind: "formula", dataType: "number", formula: "MAX(0, electricity_ro_kwh_per_day + electricity_laundry_kwh_per_day + electricity_bath_heating_kwh_per_day + electricity_lighting_kwh_per_day - solar_offset_kwh_per_day)", unit: "kWh/day", notes: "Solar offsets day-time load first" },

    // ── Variable opex monthly totals (capacity × usage × per-unit rate) ────
    { group: "opex", key: "electricity_monthly", label: "Electricity (net of solar)", kind: "formula", dataType: "currency", formula: "electricity_kwh_net_per_day * 30 * electricity_tariff", unit: "INR/mo" },
    { group: "opex", key: "water_bwssb_monthly", label: "Water (BWSSB net of greywater)", kind: "formula", dataType: "currency", formula: "fresh_water_l_day_steady / 1000 * 30 * bwssb_inr_per_kl", unit: "INR/mo" },
    { group: "opex", key: "cleaning_consumables_monthly", label: "Cleaning consumables", kind: "formula", dataType: "currency", formula: "(served_toilet_uses_per_day_steady + served_bath_uses_per_day_steady) * cleaning_inr_per_visit * 30", unit: "INR/mo" },
    { group: "opex", key: "laundry_detergent_monthly", label: "Laundry detergent (bulk)", kind: "formula", dataType: "currency", formula: "served_laundry_loads_per_day_steady * detergent_inr_per_load * 30", unit: "INR/mo" },
    { group: "opex", key: "ro_consumables_monthly", label: "RO consumables", kind: "formula", dataType: "currency", formula: "served_ro_litres_per_day_steady / 1000 * 30 * ro_consumables_inr_per_kl", unit: "INR/mo" },
    { group: "opex", key: "stp_consumables_monthly", label: "STP consumables", kind: "formula", dataType: "currency", formula: "stp_kl_treated_per_day * 30 * stp_consumables_inr_per_kl_treated", unit: "INR/mo" },
    { group: "opex", key: "desludging_monthly_amortised", label: "Septic desludging (amortised)", kind: "formula", dataType: "currency", formula: "served_toilet_uses_per_day_steady / 1000 * 30 * desludging_inr_per_1000_uses", unit: "INR/mo" },

    { group: "opex", key: "opex_lab_monthly", label: "Lab testing (monthly avg)", kind: "formula", dataType: "currency", formula: "lab_quarterly / 3", unit: "INR/mo" },
    { group: "opex", key: "opex_monthly_steady", label: "TOTAL monthly opex (steady)", kind: "formula", dataType: "currency",
      formula: "opex_staff_steady + electricity_monthly + water_bwssb_monthly + cleaning_consumables_monthly + laundry_detergent_monthly + ro_consumables_monthly + stp_consumables_monthly + desludging_monthly_amortised + amc_monthly + tech_monthly + opex_lab_monthly",
      unit: "INR/mo" },
    { group: "opex", key: "opex_annual_steady", label: "Annual opex (steady)", kind: "formula", dataType: "currency", formula: "opex_monthly_steady * 12", unit: "INR/yr" },

    // Per-service direct opex split + shared/overhead residual. Direct costs are
    // attributed by service; the residual (admin/cashier, STP consumables,
    // remaining utilities, AMC, tech, lab) is the shared pool. Σ direct + shared
    // = opex_monthly_steady exactly, so the sim's per-service P&L reconciles.
    { group: "opex", key: "opex_toilet_monthly", label: "Toilet — direct opex (monthly)", kind: "formula", dataType: "currency",
      formula: "opex_caretakers * 0.4 + opex_security_total * 0.25 + cleaning_consumables_monthly * 0.55 + desludging_monthly_amortised + water_bwssb_monthly * 0.3", unit: "INR/mo" },
    { group: "opex", key: "opex_bath_monthly", label: "Bath — direct opex (monthly)", kind: "formula", dataType: "currency",
      formula: "opex_caretakers * 0.25 + opex_security_total * 0.25 + cleaning_consumables_monthly * 0.25 + water_bwssb_monthly * 0.45", unit: "INR/mo" },
    { group: "opex", key: "opex_laundry_monthly", label: "Laundry — direct opex (monthly)", kind: "formula", dataType: "currency",
      formula: "opex_laundry_supervisors_total + opex_security_total * 0.25 + laundry_detergent_monthly + electricity_monthly * 0.25 + water_bwssb_monthly * 0.15", unit: "INR/mo" },
    { group: "opex", key: "opex_ro_monthly", label: "RO water — direct opex (monthly)", kind: "formula", dataType: "currency",
      formula: "opex_plant_operators_total * 0.5 + opex_security_total * 0.25 + ro_consumables_monthly + electricity_monthly * 0.3", unit: "INR/mo" },
    { group: "opex", key: "opex_shared_monthly", label: "Shared / overhead opex (monthly)", kind: "formula", dataType: "currency",
      formula: "opex_monthly_steady - opex_toilet_monthly - opex_bath_monthly - opex_laundry_monthly - opex_ro_monthly", unit: "INR/mo",
      notes: "Residual: admin/cashier, plant op residual, STP consumables, AMC, tech, lab, remaining utilities/cleaning" },

    // ── Monthly adoption curve (60-month vector) ───────────────────────────
    { group: "revenue", key: "adoption_monthly", label: "Adoption (monthly)", kind: "formula", dataType: "percent",
      shape: { kind: "vector", horizon: "monthly" },
      formula:
        "IF(T < 2, 0, " +
        "IF(T <= 5, adoption_m3 + (adoption_m6 - adoption_m3) * (T - 2) / 3, " +
        "IF(T <= 11, adoption_m6 + (adoption_m12 - adoption_m6) * (T - 5) / 6, " +
        "IF(T < 24, adoption_y2, adoption_y3))))",
      unit: "%" },
    { group: "revenue", key: "active_hh_monthly", label: "Active households (monthly)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "adoption_monthly * hh_count", unit: "HH" },
    { group: "revenue", key: "active_persons_monthly", label: "Active persons (monthly)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "active_hh_monthly * persons_per_hh", unit: "persons" },
    // Pilot multiplier: 1 if charging (not in free pilot), 0 if in free pilot.
    // Free pilot covers months 1–3 (T=0,1,2). Excel: IF(AND(pilot=1, month<=3), 0, 1).
    { group: "revenue", key: "pilot_pay_factor", label: "Pilot pay factor (0/1 per month)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "IF(pilot_free_first_3mo == 1 && T < 3, 0, 1)" },

    // Per-stream monthly revenue. Toilet/bath/laundry/RO charge per-use; pass
    // holders covered by their monthly fee (excluded via (1 - pass_share)).
    // Per-service served fraction = min(1, capacity / demand). Multiplied into
    // per-use revenue so under-capacity caps sales.
    { group: "revenue", key: "served_frac_toilet_monthly", label: "Toilet served fraction (monthly)", kind: "formula", dataType: "percent", shape: { kind: "vector", horizon: "monthly" }, formula: "IF(active_persons_monthly * toilet_uses_per_person_per_day <= cap_toilet_uses_day, 1, cap_toilet_uses_day / (active_persons_monthly * toilet_uses_per_person_per_day))", unit: "%" },
    { group: "revenue", key: "served_frac_bath_monthly", label: "Bath served fraction (monthly)", kind: "formula", dataType: "percent", shape: { kind: "vector", horizon: "monthly" }, formula: "IF(active_persons_monthly * bath_share <= cap_bath_uses_day, 1, cap_bath_uses_day / (active_persons_monthly * bath_share))", unit: "%" },
    { group: "revenue", key: "served_frac_laundry_monthly", label: "Laundry served fraction (monthly)", kind: "formula", dataType: "percent", shape: { kind: "vector", horizon: "monthly" }, formula: "IF(active_hh_monthly * laundry_loads_per_active_hh_per_week / 7 <= cap_laundry_loads_day, 1, cap_laundry_loads_day / (active_hh_monthly * laundry_loads_per_active_hh_per_week / 7))", unit: "%" },
    { group: "revenue", key: "served_frac_ro_monthly", label: "RO served fraction (monthly)", kind: "formula", dataType: "percent", shape: { kind: "vector", horizon: "monthly" }, formula: "IF(active_hh_monthly * ro_litres_per_active_hh_per_day <= cap_ro_litres_day, 1, cap_ro_litres_day / (active_hh_monthly * ro_litres_per_active_hh_per_day))", unit: "%" },
    { group: "revenue", key: "rev_toilet_monthly", label: "Toilet revenue (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "active_persons_monthly * toilet_uses_per_person_per_day * 28 * price_toilet * (1 - free_use_quota) * (1 - pass_holder_share) * pilot_pay_factor * served_frac_toilet_monthly",
      unit: "INR/mo" },
    { group: "revenue", key: "rev_bath_monthly", label: "Bath revenue (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "active_persons_monthly * bath_share * 28 * price_bath * (1 - free_use_quota) * (1 - pass_holder_share) * pilot_pay_factor * served_frac_bath_monthly",
      unit: "INR/mo" },
    // active_HH × loads/wk/7 days × 28 days/mo × price × served fraction.
    { group: "revenue", key: "rev_laundry_monthly", label: "Laundry revenue (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "active_hh_monthly * (laundry_loads_per_active_hh_per_week / 7) * 28 * price_laundry * (1 - pass_holder_share) * pilot_pay_factor * served_frac_laundry_monthly",
      unit: "INR/mo" },
    { group: "revenue", key: "rev_ro_monthly", label: "RO water revenue (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "active_hh_monthly * ro_litres_per_active_hh_per_day * 28 * price_ro_per_litre * pilot_pay_factor * served_frac_ro_monthly",
      unit: "INR/mo" },
    { group: "revenue", key: "rev_pass_monthly", label: "Monthly pass revenue", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "active_hh_monthly * pass_holder_share * monthly_pass_price * pilot_pay_factor",
      unit: "INR/mo" },
    { group: "revenue", key: "revenue_monthly", label: "Total revenue (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "rev_toilet_monthly + rev_bath_monthly + rev_laundry_monthly + rev_ro_monthly + rev_pass_monthly",
      unit: "INR/mo" },

    // ── Monthly P&L ────────────────────────────────────────────────────────
    // Fixed opex starts from M3 (T>=2). Pre-launch months no opex except setup costs which are capex.
    { group: "pnl", key: "opex_monthly_actual", label: "Opex (monthly, actual)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula:
        "IF(T < 2, 0, " +
        "opex_staff_steady + electricity_monthly + water_bwssb_monthly + cleaning_consumables_monthly + laundry_detergent_monthly + ro_consumables_monthly + stp_consumables_monthly + desludging_monthly_amortised + amc_monthly + tech_monthly" +
        " + IF(T == 2, lab_quarterly, IF((T - 2) % 3 == 0, lab_quarterly, 0)))",
      unit: "INR/mo" },
    { group: "pnl", key: "ebitda_monthly", label: "EBITDA (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "revenue_monthly - opex_monthly_actual",
      unit: "INR/mo" },

    // ── Annual rollups ─────────────────────────────────────────────────────
    // Y1 uses average adoption from M1-M12; Y2 = adoption_y2; Y3+ = adoption_y3.
    // Adoption ramp Y1 average:
    //   0 + 0 + adoption_m3 + (m3 + (m6-m3)*1/3) + (m3 + (m6-m3)*2/3) + m6
    //   + (m6 + (m12-m6)*1/6) + (m6 + (m12-m6)*2/6) + (m6 + (m12-m6)*3/6)
    //   + (m6 + (m12-m6)*4/6) + (m6 + (m12-m6)*5/6) + m12
    // /12. Algebraic simplification: (3*m3 + 5*m6 + 4*m12) / 12 (the months 1+2 contribute 0).
    // Verify: m1=0, m2=0, m3=m3, m4=m3+(m6-m3)/3, m5=m3+2(m6-m3)/3, m6=m6, m7..m11 ramp m6→m12, m12=m12.
    // Sum: 0+0+m3 + (m3+(m6-m3)/3) + (m3+2(m6-m3)/3) + m6 + sum_{k=1..5}(m6+k(m12-m6)/6) + m12
    //   = 3*m3 + (m6-m3) + m6 + (5*m6 + 15/6*(m12-m6)) + m12
    //   = 3*m3 + (m6-m3) + m6 + 5*m6 + 2.5*(m12-m6) + m12
    //   = 3*m3 - m3 + m6 + m6 + 5*m6 + 2.5*m12 - 2.5*m6 + m12
    //   = 2*m3 + 4.5*m6 + 3.5*m12
    //   /12. Use this closed form to avoid a 12-term formula.
    { group: "pnl", key: "adoption_annual", label: "Adoption (annual avg)", kind: "formula", dataType: "percent",
      shape: { kind: "vector", horizon: "annual" },
      formula: "IF(T == 0, (2 * adoption_m3 + 4.5 * adoption_m6 + 3.5 * adoption_m12) / 12, IF(T == 1, adoption_y2, adoption_y3))",
      unit: "%" },
    { group: "pnl", key: "active_hh_annual", label: "Active households (annual)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "annual" }, formula: "adoption_annual * hh_count" },
    { group: "pnl", key: "active_persons_annual", label: "Active persons (annual)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "annual" }, formula: "active_hh_annual * persons_per_hh" },
    // Annual served fractions (mirror the monthly ones on the annual adoption path).
    { group: "pnl", key: "served_frac_toilet_annual", label: "Toilet served fraction (annual)", kind: "formula", dataType: "percent", shape: { kind: "vector", horizon: "annual" }, formula: "IF(active_persons_annual * toilet_uses_per_person_per_day <= cap_toilet_uses_day, 1, cap_toilet_uses_day / (active_persons_annual * toilet_uses_per_person_per_day))", unit: "%" },
    { group: "pnl", key: "served_frac_bath_annual", label: "Bath served fraction (annual)", kind: "formula", dataType: "percent", shape: { kind: "vector", horizon: "annual" }, formula: "IF(active_persons_annual * bath_share <= cap_bath_uses_day, 1, cap_bath_uses_day / (active_persons_annual * bath_share))", unit: "%" },
    { group: "pnl", key: "served_frac_laundry_annual", label: "Laundry served fraction (annual)", kind: "formula", dataType: "percent", shape: { kind: "vector", horizon: "annual" }, formula: "IF(active_hh_annual * laundry_loads_per_active_hh_per_week / 7 <= cap_laundry_loads_day, 1, cap_laundry_loads_day / (active_hh_annual * laundry_loads_per_active_hh_per_week / 7))", unit: "%" },
    { group: "pnl", key: "served_frac_ro_annual", label: "RO served fraction (annual)", kind: "formula", dataType: "percent", shape: { kind: "vector", horizon: "annual" }, formula: "IF(active_hh_annual * ro_litres_per_active_hh_per_day <= cap_ro_litres_day, 1, cap_ro_litres_day / (active_hh_annual * ro_litres_per_active_hh_per_day))", unit: "%" },

    // Annual revenue per stream — applies price inflation (1+price_increase)^T.
    // Y1 picks up actual monthly sum (which includes pilot freebie); Y2+ uses
    // the steady annual formula (no pilot factor).
    { group: "pnl", key: "rev_toilet_annual", label: "Toilet revenue (annual)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "IF(T == 0, SUM(rev_toilet_monthly, 0, 12), active_persons_annual * toilet_uses_per_person_per_day * 365 * price_toilet * (1 - free_use_quota) * (1 - pass_holder_share) * (1 + price_increase) ^ T * served_frac_toilet_annual)",
      unit: "INR/yr" },
    { group: "pnl", key: "rev_bath_annual", label: "Bath revenue (annual)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "IF(T == 0, SUM(rev_bath_monthly, 0, 12), active_persons_annual * bath_share * 365 * price_bath * (1 - free_use_quota) * (1 - pass_holder_share) * (1 + price_increase) ^ T * served_frac_bath_annual)",
      unit: "INR/yr" },
    { group: "pnl", key: "rev_laundry_annual", label: "Laundry revenue (annual)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "IF(T == 0, SUM(rev_laundry_monthly, 0, 12), active_hh_annual * (laundry_loads_per_active_hh_per_week / 7) * 365 * price_laundry * (1 - pass_holder_share) * (1 + price_increase) ^ T * served_frac_laundry_annual)",
      unit: "INR/yr" },
    { group: "pnl", key: "rev_ro_annual", label: "RO water revenue (annual)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "IF(T == 0, SUM(rev_ro_monthly, 0, 12), active_hh_annual * ro_litres_per_active_hh_per_day * 365 * price_ro_per_litre * (1 + price_increase) ^ T * served_frac_ro_annual)",
      unit: "INR/yr" },
    { group: "pnl", key: "rev_pass_annual", label: "Monthly pass revenue (annual)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "IF(T == 0, SUM(rev_pass_monthly, 0, 12), active_hh_annual * pass_holder_share * monthly_pass_price * 12 * (1 + price_increase) ^ T)",
      unit: "INR/yr" },
    { group: "pnl", key: "revenue_annual", label: "Total revenue (annual)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "rev_toilet_annual + rev_bath_annual + rev_laundry_annual + rev_ro_annual + rev_pass_annual",
      unit: "INR/yr" },

    // Annual opex — Y1 uses 10/12 prorate for staff (commissioning months), Y2+ full.
    { group: "pnl", key: "opex_annual_staff", label: "Annual staff (inflated, Y1 prorated)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "opex_staff_steady * 12 * (1 + cost_inflation) ^ T * IF(T == 0, 10 / 12, 1)",
      unit: "INR/yr" },
    { group: "pnl", key: "opex_annual_utilities", label: "Annual utilities (inflated, Y1 prorated)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "(electricity_monthly + water_bwssb_monthly) * 12 * (1 + cost_inflation) ^ T * IF(T == 0, 10 / 12, 1)",
      unit: "INR/yr" },
    { group: "pnl", key: "opex_annual_consumables", label: "Annual consumables (inflated, Y1 prorated)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "(cleaning_consumables_monthly + laundry_detergent_monthly + ro_consumables_monthly + stp_consumables_monthly + desludging_monthly_amortised) * 12 * (1 + cost_inflation) ^ T * IF(T == 0, 10 / 12, 1)",
      unit: "INR/yr" },
    { group: "pnl", key: "opex_annual_amc_tech", label: "Annual AMC + tech (inflated, Y1 prorated)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "(amc_monthly + tech_monthly) * 12 * (1 + cost_inflation) ^ T * IF(T == 0, 10 / 12, 1)",
      unit: "INR/yr" },
    { group: "pnl", key: "opex_annual_lab", label: "Annual lab testing (Y1 3 visits, then 4)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "lab_quarterly * IF(T == 0, 3, 4) * (1 + cost_inflation) ^ T",
      unit: "INR/yr" },
    { group: "pnl", key: "opex_annual", label: "Total annual opex", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "opex_annual_staff + opex_annual_utilities + opex_annual_consumables + opex_annual_amc_tech + opex_annual_lab",
      unit: "INR/yr" },

    { group: "pnl", key: "ebitda_annual", label: "EBITDA (annual)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "revenue_annual - opex_annual", unit: "INR/yr" },
    { group: "pnl", key: "ebitda_margin_annual", label: "EBITDA margin (annual)", kind: "formula", dataType: "percent",
      shape: { kind: "vector", horizon: "annual" },
      formula: "IFERROR(ebitda_annual / revenue_annual, 0)", unit: "%" },
    { group: "pnl", key: "capex_outflow_y1", label: "Capex outflow (after grant share)", kind: "formula", dataType: "currency",
      formula: "0 - capex_total * (1 - grant_share)", unit: "INR" },
    { group: "pnl", key: "npv_5yr", label: "NPV @ discount rate (5-yr)", kind: "formula", dataType: "currency",
      formula: "NPV(discount_rate, ebitda_annual) + capex_outflow_y1", unit: "INR" },

    // ── Cost Recovery ──────────────────────────────────────────────────────
    { group: "cost_recovery", key: "oss_ratio_annual", label: "Operational Self-Sufficiency (OSS)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "annual" },
      formula: "IFERROR(revenue_annual / opex_annual, 0)",
      notes: "Above 1.0 = self-sustaining; 1.5+ = comfortable; 2.0+ = funder can step back" },
    // Replacement reserves — sanitation has many more assets with varied lifecycles.
    { group: "cost_recovery", key: "replacement_reserve_annual", label: "Annual replacement reserve required", kind: "formula", dataType: "currency",
      formula:
        "capex_civil * 0.1 / 20 + " +        // Civil shell — 10% major refurbishment / 20y
        "capex_plumbing * 0.5 / 10 + " +      // Plumbing — 50% / 10y
        "capex_washing_machines / 7 + " +     // WMs — 100% / 7y
        "capex_ro / 7 + " +                   // RO — 100% / 7y
        "capex_stp / 10 + " +                 // STP — 100% / 10y
        "capex_biodigester / 15 + " +
        "capex_tanks / 15 + " +
        "capex_solar * 0.6 / 10 + " +         // Solar — 60% blended panels+batteries / 10y
        "capex_electrical * 0.3 / 12 + " +
        "capex_iot / 5",
      unit: "INR/yr",
      notes: "Replacement scope × original capex ÷ asset lifecycle" },
    { group: "cost_recovery", key: "community_surplus_annual", label: "Community surplus (EBITDA − reserves)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "ebitda_annual - replacement_reserve_annual" },

    // ── Operations (sim-only) ─────────────────────────────────────────────
    { group: "ops", key: "peak_concentration", label: "Peak concentration", kind: "input", dataType: "number", defaultJson: 100, unit: "", notes: "Higher = sharper morning/evening rush", surface: "sim", ui: { min: 60, max: 200, step: 5 } },
    // Engineering throughput / recovery — advanced tier (hidden until toggled).
    { group: "ops", key: "seat_throughput", label: "WC throughput", kind: "input", dataType: "number", defaultJson: 12, unit: "uses/h/seat", surface: "sim", tier: "advanced", ui: { min: 6, max: 20, step: 1 } },
    { group: "ops", key: "bath_throughput", label: "Cubicle throughput", kind: "input", dataType: "number", defaultJson: 3, unit: "baths/h", surface: "sim", tier: "advanced", ui: { min: 1, max: 8, step: 0.5 } },
    { group: "ops", key: "machine_throughput", label: "Machine throughput", kind: "input", dataType: "number", defaultJson: 1.3, unit: "loads/h", surface: "sim", tier: "advanced", ui: { min: 0.5, max: 3, step: 0.1 } },
    { group: "ops", key: "ro_recovery_rate", label: "RO recovery rate", kind: "input", dataType: "percent", defaultJson: 0.55, unit: "%", surface: "sim", tier: "advanced", ui: { min: 0.3, max: 0.8, step: 0.05 } },
  ];

  const seedNodeKeys = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    seedNodeKeys.add(n.key);
    const payload = {
      groupId: groups[n.group],
      label: n.label, kind: n.kind, dataType: n.dataType,
      shape: n.shape ?? { kind: "scalar" },
      defaultJson: n.defaultJson === undefined ? undefined : (n.defaultJson as never),
      formula: n.formula ?? null,
      unit: n.unit ?? null, notes: n.notes ?? null,
      surface: n.surface ?? "both",
      tier: n.tier ?? "basic",
      uiJson: n.ui === undefined ? undefined : (n.ui as never),
      order: i,
    };
    await prisma.modelNode.upsert({
      where: { templateId_key: { templateId: template.id, key: n.key } },
      create: { templateId: template.id, key: n.key, ...payload },
      update: payload,
    });
  }
  // Prune nodes no longer in the seed.
  const pruned = await prisma.modelNode.deleteMany({
    where: { templateId: template.id, key: { notIn: [...seedNodeKeys] } },
  });
  if (pruned.count > 0) console.log(`  pruned ${pruned.count} stale node(s)`);

  // ── Outputs ─────────────────────────────────────────────────────────────
  type OutputIn = { key: string; label: string; kind: string; config: Record<string, unknown>; order: number };
  const outputs: OutputIn[] = [
    { key: "kpi_total_capex",   label: "Total Capex",           kind: "kpi", order: 0, config: { nodeKey: "capex_total", format: "currency" } },
    { key: "kpi_per_seat",      label: "Capex / WC seat",       kind: "kpi", order: 1, config: { nodeKey: "capex_per_wc_seat", format: "currency" } },
    { key: "kpi_per_hh",        label: "Capex / HH",            kind: "kpi", order: 2, config: { nodeKey: "capex_per_hh", format: "currency" } },
    { key: "kpi_opex_steady",   label: "Monthly Opex (steady)", kind: "kpi", order: 3, config: { nodeKey: "opex_monthly_steady", format: "currency" } },
    { key: "kpi_y1_revenue",    label: "Year-1 Revenue",        kind: "kpi", order: 4, config: { nodeKey: "revenue_annual", index: 0, format: "currency" } },
    { key: "kpi_y3_ebitda",     label: "Year-3 EBITDA",         kind: "kpi", order: 5, config: { nodeKey: "ebitda_annual",  index: 2, format: "currency" } },
    { key: "kpi_y3_oss",        label: "Year-3 OSS ratio",      kind: "kpi", order: 6, config: { nodeKey: "oss_ratio_annual", index: 2, format: "number" } },
    { key: "kpi_demand_met",    label: "Demand met",            kind: "kpi", order: 7, config: { nodeKey: "capacity_utilisation_steady", format: "percent" } },
    { key: "kpi_npv",           label: "5-Year NPV",            kind: "kpi", order: 8, config: { nodeKey: "npv_5yr", format: "currency" } },

    // Revenue vs Opex vs EBITDA on one chart (monthly + annual), OSS standalone.
    { key: "series_pnl_m", label: "Monthly P&L — Revenue vs Opex vs EBITDA", kind: "seriesGroup", order: 10,
      config: {
        horizon: "monthly", format: "currency",
        series: [
          { nodeKey: "revenue_monthly",     label: "Revenue", color: "#10b981" },
          { nodeKey: "opex_monthly_actual", label: "Opex",    color: "#f59e0b" },
          { nodeKey: "ebitda_monthly",      label: "EBITDA",  color: "#2563eb" },
        ],
      },
    },
    { key: "series_pnl_y", label: "Annual P&L — Revenue vs Opex vs EBITDA", kind: "seriesGroup", order: 11,
      config: {
        horizon: "annual", format: "currency",
        series: [
          { nodeKey: "revenue_annual", label: "Revenue", color: "#10b981" },
          { nodeKey: "opex_annual",    label: "Opex",    color: "#f59e0b" },
          { nodeKey: "ebitda_annual",  label: "EBITDA",  color: "#2563eb" },
        ],
      },
    },
    { key: "series_oss_y", label: "OSS Ratio by Year", kind: "series", order: 12, config: { nodeKey: "oss_ratio_annual", horizon: "annual", format: "number" } },

    { key: "sens_ebitda_y3",
      label: "Year-3 EBITDA: Adoption × Toilet price",
      kind: "sensitivity", order: 20,
      config: {
        xNode: "adoption_y3", xValues: [0.5, 0.6, 0.7, 0.8, 0.9],
        yNode: "price_toilet", yValues: [1.0, 1.5, 2.0, 2.5, 3.0],
        resultNode: "ebitda_annual", resultIndex: 2,
        format: "currency",
      } },

    { key: "budget_export_year1", label: "Promote to Budget — Year 1", kind: "budgetExport", order: 30,
      config: {
        domainName: "Sanitation_Complex",
        years: 1,
        // templateKey on each line links the promoted BudgetLine back to a
        // LineTemplate row → the created budget is regenerate-safe and
        // indistinguishable from one created via /budget/new with the same inputs.
        capexLines: [
          { nodeKey: "capex_civil",             description: "Civil construction",             templateKey: "san.cap_civil" },
          { nodeKey: "capex_plumbing",          description: "Plumbing + sanitaryware",         templateKey: "san.cap_plumbing" },
          { nodeKey: "capex_washing_machines",  description: "Washing machines + spin dryers",  templateKey: "san.cap_washing" },
          { nodeKey: "capex_ro",                description: "RO plant + Water ATM",            templateKey: "san.cap_ro" },
          { nodeKey: "capex_stp",               description: "Greywater MBBR STP",              templateKey: "san.cap_stp" },
          { nodeKey: "capex_biodigester",       description: "Biodigester / septic",            templateKey: "san.cap_biodigester" },
          { nodeKey: "capex_tanks",             description: "Storage tanks (UG + OH)",         templateKey: "san.cap_tanks" },
          { nodeKey: "capex_solar",             description: "Solar PV system",                 templateKey: "san.cap_solar" },
          { nodeKey: "capex_electrical",        description: "Electrical works",                templateKey: "san.cap_electrical" },
          { nodeKey: "capex_iot",               description: "Payment + IoT monitoring",        templateKey: "san.cap_iot" },
          { nodeKey: "capex_approval",          description: "Approval fees",                   templateKey: "san.cap_approval" },
          { nodeKey: "capex_design",            description: "Design + supervision",            templateKey: "san.cap_design" },
          { nodeKey: "capex_signage",           description: "Signage, accessibility, furnishings", templateKey: "san.cap_signage" },
          { nodeKey: "capex_contingency",       description: "Contingency",                     templateKey: "san.cap_contingency" },
          { nodeKey: "capex_tax",               description: "GST + taxes",                     templateKey: "san.cap_tax" },
        ],
        opexLines: [
          { nodeKey: "opex_caretakers",                description: "Caretakers",                     costCategory: "Salary", months: 10, templateKey: "san.caretaker" },
          { nodeKey: "opex_plant_operators_total",     description: "Plant operators",                costCategory: "Salary", months: 10, templateKey: "san.plant_operator" },
          { nodeKey: "opex_laundry_supervisors_total", description: "Laundry supervisors",            costCategory: "Salary", months: 10, templateKey: "san.laundry_sup" },
          { nodeKey: "opex_security_total",            description: "Security guards",                costCategory: "Salary", months: 10, templateKey: "san.security" },
          { nodeKey: "opex_admin_cashier_total",       description: "Admin / cashier",                costCategory: "Salary", months: 10, templateKey: "san.admin" },
          { nodeKey: "electricity_monthly",            description: "Electricity (net of solar)",     costCategory: "Other",  months: 10, templateKey: "san.electricity" },
          { nodeKey: "water_bwssb_monthly",            description: "Water (BWSSB)",                  costCategory: "Other",  months: 10, templateKey: "san.water" },
          { nodeKey: "cleaning_consumables_monthly",   description: "Cleaning consumables",           costCategory: "Other",  months: 10, templateKey: "san.cleaning" },
          { nodeKey: "laundry_detergent_monthly",      description: "Laundry detergent",              costCategory: "Other",  months: 10, templateKey: "san.detergent" },
          { nodeKey: "ro_consumables_monthly",         description: "RO consumables",                 costCategory: "Other",  months: 10, templateKey: "san.ro_consum" },
          { nodeKey: "stp_consumables_monthly",        description: "STP consumables",                costCategory: "Other",  months: 10, templateKey: "san.stp_consum" },
          { nodeKey: "desludging_monthly_amortised",   description: "Septic desludging (amortised)",  costCategory: "Other",  months: 10, templateKey: "san.desludging" },
          { nodeKey: "amc_monthly",                    description: "Maintenance / AMC reserve",      costCategory: "Other",  months: 10, templateKey: "san.amc" },
          { nodeKey: "tech_monthly",                   description: "Technology / monitoring",        costCategory: "Other",  months: 10, templateKey: "san.tech" },
          { nodeKey: "opex_lab_monthly",               description: "Water quality testing",          costCategory: "Other",  months: 10, templateKey: "san.lab" },
        ],
        // Model input key → budget inp.* key (drop "inp." prefix in the value).
        // Written into Budget.inputs.extraInputs so regenerate-sanitation-budgets
        // re-derives every line from the same capacity mix.
        inputMapping: {
          wc_seats: "wcSeats",
          bath_cubicles: "bathCubicles",
          washing_machines: "washingMachines",
          ro_lph: "roLph",
          stp_kld: "stpKld",
          solar_kwp: "solarKwp",
          tank_storage_litres: "tankStorageLitres",
          area_sqm_override: "areaSqmOverride",
          structure_is_single: "structureIsSingle",
          structure_is_g1: "structureIsG1",
          structure_is_g2: "structureIsG2",
        },
      } },

    // Operations day-in-the-life sim (multi-service + DEWATS recycling).
    { key: "daysim_ops", label: "Operations — day in the life", kind: "daySim", order: 40,
      config: {
        schematic: "sanitation_complex",
        nodes: {
          hh: "hh_count", personsPerHH: "persons_per_hh", adoption: "adoption_y3", peak: "peak_concentration",
          seats: "wc_seats", baths: "bath_cubicles", machines: "washing_machines", roLph: "ro_lph", dewatsKld: "stp_kld",
          roTankCap: "ro_tank_litres", roCansCount: "ro_cans_count",
          toiletUses: "toilet_uses_per_person_per_day", bathShare: "bath_share", roLitresPerHH: "ro_litres_per_active_hh_per_day",
          laundryLoadsPerHHPerWeek: "laundry_loads_per_active_hh_per_week",
          priceToilet: "price_toilet", priceBath: "price_bath", priceLaundry: "price_laundry", priceRo: "price_ro_per_litre",
          passPrice: "monthly_pass_price", passShare: "pass_holder_share", freeQuota: "free_use_quota",
          opexMonthly: "opex_monthly_steady",
          opexToilet: "opex_toilet_monthly", opexBath: "opex_bath_monthly", opexLaundry: "opex_laundry_monthly",
          opexRo: "opex_ro_monthly", opexShared: "opex_shared_monthly",
          seatThroughput: "seat_throughput", bathThroughput: "bath_throughput", machineThroughput: "machine_throughput", roRecovery: "ro_recovery_rate",
          roOperatingHours: "ro_operating_hours", facilityOpenHours: "facility_open_hours",
          replacementReserveAnnual: "replacement_reserve_annual",
        },
        // Engine constants + presentation live in config (editable in the Sim
        // tab). Seeded from the defaults so the DB is the source of truth.
        constants: DEFAULT_COMPLEX_CONSTANTS,
        presentation: DEFAULT_COMPLEX_PRESENTATION,
      } },
  ];
  const seedOutputKeys = new Set<string>();
  for (const o of outputs) {
    seedOutputKeys.add(o.key);
    const payload = { label: o.label, kind: o.kind, config: o.config as never, order: o.order };
    await prisma.modelOutput.upsert({
      where: { templateId_key: { templateId: template.id, key: o.key } },
      create: { templateId: template.id, key: o.key, ...payload },
      update: payload,
    });
  }
  const outputPruned = await prisma.modelOutput.deleteMany({
    where: { templateId: template.id, key: { notIn: [...seedOutputKeys] } },
  });
  if (outputPruned.count > 0) console.log(`  pruned ${outputPruned.count} stale output(s)`);

  // Ensure at least one Base instance exists — but never overwrite existing
  // instances (user scenarios + published slug survive re-seeds).
  const existingCount = await prisma.modelInstance.count({ where: { templateId: template.id } });
  let instance;
  if (existingCount === 0) {
    instance = await prisma.modelInstance.create({
      data: { templateId: template.id, name: "Sanitation Complex — Base", scenarioName: "Base" },
    });
  }

  console.log(`✔ Template ${template.id} (${TEMPLATE_KEY})`);
  console.log(`  ${nodes.length} nodes, ${outputs.length} outputs`);
  if (instance) {
    console.log(`✔ Instance ${instance.id} (initial Base created)`);
    console.log(`→ Visit /models/${instance.id}`);
  } else {
    console.log(`  ${existingCount} existing instance(s) preserved`);
  }
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
