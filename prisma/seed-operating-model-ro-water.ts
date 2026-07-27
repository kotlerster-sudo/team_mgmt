// RO Water community plant — operating-model template.
// Translated from /Users/vishnuharikumar/Downloads/RO_Water_Financial_Model_2.xlsx
// (11 sheets: README, Summary, Cost_Recovery, Inputs, Scenarios, Capex, Opex,
// Revenue, PnL_Monthly, PnL_Annual, Sensitivity).
//
// Run:  npx tsx prisma/seed-operating-model-ro-water.ts

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DEFAULT_RO_CONSTANTS, DEFAULT_RO_PRESENTATION } from "../lib/models/simConfig";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TEMPLATE_KEY = "ro_water";

async function main() {
  // Additive upsert — preserves ModelInstances (user scenarios + publicSlug)
  // across re-seeds. Same pattern as the sanitation seed.
  const template = await prisma.modelTemplate.upsert({
    where: { key: TEMPLATE_KEY },
    create: {
      key: TEMPLATE_KEY,
      name: "RO Water Plant (community)",
      description:
        "Funder-facing financial model for a community RO water plant in a Bangalore/Chennai " +
        "urban slum. 60-month / 5-year horizon. Translated from the v2 Excel model.",
      horizons: [
        { key: "monthly", length: 60 },
        { key: "annual", length: 5 },
      ],
      sortOrder: 10,
    },
    update: {
      name: "RO Water Plant (community)",
      description:
        "Funder-facing financial model for a community RO water plant in a Bangalore/Chennai " +
        "urban slum. 60-month / 5-year horizon. Translated from the v2 Excel model.",
      horizons: [
        { key: "monthly", length: 60 },
        { key: "annual", length: 5 },
      ],
      sortOrder: 10,
    },
  });

  const groupDefs = [
    ["site", "Site & Population"],
    ["adoption", "Adoption Curve"],
    ["plant", "Plant Specifications"],
    ["pricing", "Pricing"],
    ["capex_in", "Capital Expenditure"],
    ["opex_in", "Operating Expenses"],
    ["financial", "Financial Parameters"],
    ["capex", "Capex (derived)"],
    ["opex", "Opex (derived)"],
    ["revenue", "Revenue (derived)"],
    ["pnl", "P&L (derived)"],
    ["cost_recovery", "Cost Recovery"],
    ["ops", "Operations (sim)"],
  ] as const;
  // Group → play surface. Capex/financial are finance-only (vanish on the sim
  // tab); the ops group is sim-only; everything else shows on both.
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
    // Surface override (else inherits group). Sim Basic/Advanced tier. Slider range.
    surface?: "finance" | "sim" | "both";
    tier?: "basic" | "advanced";
    ui?: { min?: number; max?: number; step?: number };
  };

  const nodes: NodeIn[] = [
    // ── 1. Site & Population ───────────────────────────────────────────────
    { group: "site", key: "hh_count", label: "Households in service area", kind: "input", dataType: "int", defaultJson: 500, unit: "HH", notes: "Total households expected to benefit", ui: { min: 300, max: 1200, step: 20 } },
    { group: "site", key: "persons_per_hh", label: "Persons per household", kind: "input", dataType: "number", defaultJson: 5, unit: "persons" },
    { group: "site", key: "water_need_lppd", label: "Drinking water need per person", kind: "input", dataType: "number", defaultJson: 4, unit: "L/p/d", notes: "Per WHO and SBM guidelines" },

    // ── 2. Adoption Curve ─────────────────────────────────────────────────
    // The month-by-month ramp is finance-only; the sim runs at a single steady
    // adoption (adoption_y3, kept "both") so it vanishes cleanly on the sim tab.
    { group: "adoption", key: "adoption_m3", label: "Month 3 adoption", kind: "input", dataType: "percent", defaultJson: 0.30, unit: "% of HH", notes: "Early adopters; cards distributed", surface: "finance" },
    { group: "adoption", key: "adoption_m6", label: "Month 6 adoption", kind: "input", dataType: "percent", defaultJson: 0.50, unit: "% of HH", notes: "After community campaign", surface: "finance" },
    { group: "adoption", key: "adoption_m12", label: "Month 12 adoption", kind: "input", dataType: "percent", defaultJson: 0.70, unit: "% of HH", notes: "Steady-state target year 1", surface: "finance" },
    { group: "adoption", key: "adoption_y2", label: "Year 2 average adoption", kind: "input", dataType: "percent", defaultJson: 0.78, unit: "% of HH", notes: "Mature operations", surface: "finance" },
    { group: "adoption", key: "adoption_y3", label: "Year 3+ adoption (steady state)", kind: "input", dataType: "percent", defaultJson: 0.82, unit: "% of HH", notes: "Plateau", ui: { min: 0.2, max: 1, step: 0.05 } },
    { group: "adoption", key: "litres_per_adopting_hh", label: "Litres per adopting HH per day", kind: "input", dataType: "number", defaultJson: 18, unit: "L/HH/day", notes: "Actual purchase per active HH; usually below need", ui: { min: 4, max: 25, step: 1 } },

    // ── 3. Plant Specifications ───────────────────────────────────────────
    { group: "plant", key: "plant_lph", label: "Plant capacity", kind: "input", dataType: "int", defaultJson: 1000, unit: "L/hour", ui: { min: 250, max: 2000, step: 50 } },
    { group: "plant", key: "operating_hours_per_day", label: "Daily operating hours", kind: "input", dataType: "number", defaultJson: 10, unit: "hours/day", ui: { min: 4, max: 24, step: 1 } },
    // Buffers — sim-relevant but real spec, so "both": they show on finance too.
    { group: "plant", key: "tank_litres", label: "Product tank size", kind: "input", dataType: "int", defaultJson: 2000, unit: "L", notes: "Primary buffer between plant and dispensing", ui: { min: 1000, max: 8000, step: 250 } },
    { group: "plant", key: "cans_count", label: "Pre-packed 10 L cans (reserve)", kind: "input", dataType: "int", defaultJson: 50, unit: "cans", notes: "Off-peak reserve drawn down at the rush", ui: { min: 0, max: 150, step: 5 } },
    // Engineering constants — advanced tier (hidden on the sim tab until toggled).
    { group: "plant", key: "ro_recovery_rate", label: "RO recovery rate", kind: "input", dataType: "percent", defaultJson: 0.55, unit: "%", notes: "Litres produced / litres feed water", tier: "advanced", ui: { min: 0.3, max: 0.8, step: 0.05 } },
    { group: "plant", key: "days_per_month", label: "Days operating per month", kind: "input", dataType: "number", defaultJson: 28, unit: "days/month", notes: "Allow for maintenance days", tier: "advanced", ui: { min: 20, max: 31, step: 1 } },
    // Physical throughput ceiling — what the plant can actually produce. Demand
    // above this is capped (revenue can't exceed what the plant makes).
    { group: "plant", key: "capacity_litres_per_month", label: "Plant throughput ceiling / month", kind: "formula", dataType: "number", formula: "plant_lph * operating_hours_per_day * days_per_month", unit: "L/mo", notes: "Most the plant can physically produce in a month" },

    // ── 4. Pricing ────────────────────────────────────────────────────────
    { group: "pricing", key: "price_per_litre", label: "Price per litre", kind: "input", dataType: "currency", defaultJson: 2, unit: "INR/L", notes: "Slum benchmark INR 1–5 per litre", ui: { min: 0, max: 5, step: 0.1 } },
    { group: "pricing", key: "pass_discount", label: "Pass holder discount", kind: "input", dataType: "percent", defaultJson: 0.20, unit: "%" },
    { group: "pricing", key: "pass_holder_share", label: "% adopters on monthly pass", kind: "input", dataType: "percent", defaultJson: 0.40, unit: "%" },
    { group: "pricing", key: "effective_price_per_litre", label: "Effective price per litre", kind: "formula", dataType: "currency", formula: "price_per_litre * (1 - pass_discount * pass_holder_share)", unit: "INR/L" },

    // ── 5. Capex inputs ───────────────────────────────────────────────────
    // RO plant + tanks scale with capacity (per-unit rates below); other capex flat.
    { group: "capex_in", key: "capex_ro_plant_per_lph", label: "RO plant cost per L/hour", kind: "input", dataType: "currency", defaultJson: 600, unit: "INR/LPH", surface: "finance", notes: "RO skid+membranes+UV per L/hour. ×1000 LPH = ₹6L base." },
    { group: "capex", key: "capex_ro_plant", label: "RO plant (skid + membranes + UV)", kind: "formula", dataType: "currency", formula: "plant_lph * capex_ro_plant_per_lph", unit: "INR", notes: "Scales with plant_lph" },
    { group: "capex_in", key: "capex_atm", label: "Water ATM dispensing unit", kind: "input", dataType: "currency", defaultJson: 150000, unit: "INR", notes: "RFID + UPI capable" },
    { group: "capex_in", key: "capex_tanks_per_litre", label: "Storage tank cost per litre", kind: "input", dataType: "currency", defaultJson: 40, unit: "INR/L", surface: "finance", notes: "Raw+product tank per litre of product-tank size." },
    { group: "capex", key: "capex_tanks", label: "Storage tanks (raw + product)", kind: "formula", dataType: "currency", formula: "tank_litres * capex_tanks_per_litre", unit: "INR", notes: "Scales with tank_litres" },
    { group: "capex_in", key: "capex_civil", label: "Civil works (room, foundation)", kind: "input", dataType: "currency", defaultJson: 200000, unit: "INR" },
    { group: "capex_in", key: "capex_plumbing", label: "Plumbing & electrical works", kind: "input", dataType: "currency", defaultJson: 100000, unit: "INR" },
    { group: "capex_in", key: "has_borewell", label: "Include borewell", kind: "input", dataType: "int", defaultJson: 1, unit: "0/1", notes: "1 = includes borewell + source connection; 0 = municipal supply only." },
    { group: "capex_in", key: "capex_borewell_amount", label: "Borewell + source cost", kind: "input", dataType: "currency", defaultJson: 75000, unit: "INR", surface: "finance", notes: "Cost per plant when borewell is included." },
    { group: "capex_in", key: "capex_borewell", label: "Borewell / water source connection", kind: "formula", dataType: "currency", formula: "has_borewell * capex_borewell_amount", unit: "INR" },
    { group: "capex_in", key: "solar_kwp", label: "Solar PV capacity", kind: "input", dataType: "number", defaultJson: 2.5, unit: "kWp", ui: { min: 0, max: 10, step: 0.5 } },
    { group: "capex_in", key: "capex_solar_per_kwp", label: "Solar cost per kWp", kind: "input", dataType: "currency", defaultJson: 80000, unit: "INR/kWp", surface: "finance", notes: "Community-scale PV installed rate." },
    { group: "capex_in", key: "capex_solar", label: "Solar PV system", kind: "formula", dataType: "currency", formula: "solar_kwp * capex_solar_per_kwp", unit: "INR" },
    { group: "capex_in", key: "capex_iot", label: "Payment & IoT system (RFID, cloud)", kind: "input", dataType: "currency", defaultJson: 50000, unit: "INR" },
    { group: "capex_in", key: "capex_surveys", label: "Pre-installation surveys & design", kind: "input", dataType: "currency", defaultJson: 50000, unit: "INR" },
    { group: "capex_in", key: "capex_contingency_pct", label: "Contingency (% of subtotal)", kind: "input", dataType: "percent", defaultJson: 0.10, unit: "%", notes: "Standard 8–12% buffer" },

    // ── 6. Opex inputs ────────────────────────────────────────────────────
    { group: "opex_in", key: "salary_operator", label: "Operator salary (monthly)", kind: "input", dataType: "currency", defaultJson: 12000, unit: "INR/mo" },
    { group: "opex_in", key: "salary_assistant", label: "Assistant / part-time helper", kind: "input", dataType: "currency", defaultJson: 5000, unit: "INR/mo" },
    { group: "opex_in", key: "electricity_kwh_per_1000l", label: "Electricity (kWh per 1000 L produced)", kind: "input", dataType: "number", defaultJson: 6, unit: "kWh/1000L" },
    { group: "opex_in", key: "electricity_rate", label: "Electricity rate (commercial)", kind: "input", dataType: "currency", defaultJson: 9.5, unit: "INR/kWh" },
    { group: "opex_in", key: "water_source_cost_per_1000l", label: "Water source cost (per 1000 L feed)", kind: "input", dataType: "currency", defaultJson: 30, unit: "INR/1000L" },
    { group: "opex_in", key: "membrane_cost_per_lph_year", label: "Membrane replacement per L/hour / year", kind: "input", dataType: "currency", defaultJson: 30, unit: "INR/LPH/yr", notes: "Membrane set scales with plant capacity. ×1000 LPH = ₹30k/yr base." },
    { group: "opex", key: "membrane_annual_cost", label: "Membrane replacement (annual)", kind: "formula", dataType: "currency", formula: "plant_lph * membrane_cost_per_lph_year", unit: "INR/year", notes: "Scales with plant_lph" },
    { group: "opex_in", key: "prefilter_monthly", label: "Pre-filter cartridges", kind: "input", dataType: "currency", defaultJson: 1000, unit: "INR/mo" },
    { group: "opex_in", key: "uv_monthly", label: "UV lamp & consumables", kind: "input", dataType: "currency", defaultJson: 500, unit: "INR/mo" },
    { group: "opex_in", key: "amc_pct_annual", label: "AMC / maintenance (% of capex per year)", kind: "input", dataType: "percent", defaultJson: 0.0109, unit: "%", notes: "Maintenance reserve as a share of total capex (scales with plant size)." },
    { group: "opex", key: "amc_monthly", label: "Maintenance / AMC reserve", kind: "formula", dataType: "currency", formula: "capex_total * amc_pct_annual / 12", unit: "INR/mo", notes: "Scales with capex_total" },
    { group: "opex_in", key: "tech_monthly", label: "Technology / monitoring platform fee", kind: "input", dataType: "currency", defaultJson: 2000, unit: "INR/mo" },
    { group: "opex_in", key: "mobile_monthly", label: "Mobile / internet / SIM", kind: "input", dataType: "currency", defaultJson: 500, unit: "INR/mo" },
    { group: "opex_in", key: "cleaning_monthly", label: "Cleaning supplies & sundry", kind: "input", dataType: "currency", defaultJson: 800, unit: "INR/mo" },
    { group: "opex_in", key: "lab_quarterly", label: "Water quality testing (quarterly)", kind: "input", dataType: "currency", defaultJson: 4000, unit: "INR/quarter", notes: "NABL-accredited lab" },

    // ── 7. Financial parameters ───────────────────────────────────────────
    { group: "financial", key: "cost_inflation", label: "YoY cost inflation", kind: "input", dataType: "percent", defaultJson: 0.06, unit: "%" },
    { group: "financial", key: "price_increase", label: "YoY price increase", kind: "input", dataType: "percent", defaultJson: 0.05, unit: "%" },
    { group: "financial", key: "grant_share", label: "Capex grant funding share", kind: "input", dataType: "percent", defaultJson: 1.0, unit: "%", notes: "100% grant-funded → no payback obligation" },
    { group: "financial", key: "discount_rate", label: "Discount rate (NPV/IRR)", kind: "input", dataType: "percent", defaultJson: 0.08, unit: "%", notes: "For 5-year NPV calculation" },

    // ── Capex derived ─────────────────────────────────────────────────────
    { group: "capex", key: "capex_subtotal", label: "Capex subtotal", kind: "formula", dataType: "currency",
      formula: "capex_ro_plant + capex_atm + capex_tanks + capex_civil + capex_plumbing + capex_borewell + capex_solar + capex_iot + capex_surveys", unit: "INR" },
    { group: "capex", key: "capex_contingency", label: "Contingency", kind: "formula", dataType: "currency", formula: "capex_subtotal * capex_contingency_pct", unit: "INR" },
    { group: "capex", key: "capex_total", label: "TOTAL CAPEX", kind: "formula", dataType: "currency", formula: "capex_subtotal + capex_contingency", unit: "INR" },
    { group: "capex", key: "capex_per_hh", label: "Capex per household served", kind: "formula", dataType: "currency", formula: "capex_total / hh_count", unit: "INR/HH" },
    { group: "capex", key: "capex_per_litre_5yr", label: "Capex per litre (5-yr amortised, BASE)", kind: "formula", dataType: "currency",
      formula: "capex_total / (5 * served_steady_litres_per_month * 12)", unit: "INR/L" },

    // ── Steady-state Opex (derived) ───────────────────────────────────────
    { group: "opex", key: "steady_litres_per_month", label: "Steady-state demand / month", kind: "formula", dataType: "number",
      formula: "hh_count * adoption_y3 * litres_per_adopting_hh * days_per_month", unit: "L/mo" },
    { group: "opex", key: "served_steady_litres_per_month", label: "Steady litres served (capacity-capped)", kind: "formula", dataType: "number",
      formula: "IF(steady_litres_per_month < capacity_litres_per_month, steady_litres_per_month, capacity_litres_per_month)", unit: "L/mo" },
    { group: "opex", key: "capacity_utilisation_steady", label: "Demand met at steady state", kind: "formula", dataType: "percent",
      formula: "IFERROR(served_steady_litres_per_month / steady_litres_per_month, 0)", unit: "%", notes: "Share of steady-state demand the plant can actually serve (100% = enough capacity)" },
    { group: "opex", key: "opex_steady_electricity", label: "Steady-state electricity", kind: "formula", dataType: "currency",
      formula: "served_steady_litres_per_month / 1000 * electricity_kwh_per_1000l * electricity_rate", unit: "INR/mo" },
    { group: "opex", key: "opex_steady_source_water", label: "Steady-state source water", kind: "formula", dataType: "currency",
      formula: "served_steady_litres_per_month / ro_recovery_rate / 1000 * water_source_cost_per_1000l", unit: "INR/mo" },
    { group: "opex", key: "opex_steady_membrane", label: "Membrane (amortised /12)", kind: "formula", dataType: "currency",
      formula: "membrane_annual_cost / 12", unit: "INR/mo" },
    { group: "opex", key: "opex_steady_lab", label: "Lab testing (monthly avg)", kind: "formula", dataType: "currency",
      formula: "lab_quarterly / 3", unit: "INR/mo" },
    { group: "opex", key: "opex_monthly_steady", label: "TOTAL monthly opex (steady-state)", kind: "formula", dataType: "currency",
      formula: "salary_operator + salary_assistant + opex_steady_electricity + opex_steady_source_water + opex_steady_membrane + prefilter_monthly + uv_monthly + amc_monthly + tech_monthly + mobile_monthly + cleaning_monthly + opex_steady_lab",
      unit: "INR/mo" },
    { group: "opex", key: "opex_per_litre", label: "Opex per litre produced", kind: "formula", dataType: "currency",
      formula: "opex_monthly_steady / served_steady_litres_per_month", unit: "INR/L" },
    { group: "opex", key: "breakeven_price_per_litre", label: "Break-even price per litre", kind: "formula", dataType: "currency",
      formula: "opex_per_litre", unit: "INR/L", notes: "Pricing below this loses money at steady state" },

    // ── Monthly adoption curve (60-month vector) ──────────────────────────
    // T = 0..59. M1-2 commissioning (zero), then piecewise linear interpolation
    // M3-M6, M6-M12, then year-2 average, then year-3+ plateau.
    { group: "revenue", key: "adoption_monthly", label: "Adoption (monthly)", kind: "formula", dataType: "percent",
      shape: { kind: "vector", horizon: "monthly" },
      formula:
        "IF(T < 2, 0, " +
        "IF(T <= 5, adoption_m3 + (adoption_m6 - adoption_m3) * (T - 2) / 3, " +
        "IF(T <= 11, adoption_m6 + (adoption_m12 - adoption_m6) * (T - 5) / 6, " +
        "IF(T < 24, adoption_y2, adoption_y3))))",
      unit: "%", notes: "Piecewise-linear ramp; matches Revenue sheet construction" },
    { group: "revenue", key: "active_hh_monthly", label: "Active households (monthly)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "adoption_monthly * hh_count", unit: "HH" },
    { group: "revenue", key: "litres_per_month", label: "Litres demanded per month", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "active_hh_monthly * litres_per_adopting_hh * days_per_month", unit: "L/mo" },
    { group: "revenue", key: "served_litres_per_month", label: "Litres served (capacity-capped)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "IF(litres_per_month < capacity_litres_per_month, litres_per_month, capacity_litres_per_month)", unit: "L/mo", notes: "Demand, capped at what the plant can produce" },
    { group: "revenue", key: "revenue_monthly", label: "Revenue (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "served_litres_per_month * effective_price_per_litre", unit: "INR/mo" },

    // ── Monthly P&L (60-month vector) ─────────────────────────────────────
    // Variable costs scale with actual production. Fixed costs zero in
    // commissioning months (T < 2), full from month 3 onwards.
    { group: "pnl", key: "opex_var_monthly", label: "Variable opex (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula:
        "served_litres_per_month / 1000 * electricity_kwh_per_1000l * electricity_rate" +
        " + served_litres_per_month / ro_recovery_rate / 1000 * water_source_cost_per_1000l" +
        " + IF(served_steady_litres_per_month > 0, served_litres_per_month * membrane_annual_cost / 12 / served_steady_litres_per_month, 0)",
      unit: "INR/mo" },
    { group: "pnl", key: "opex_fix_monthly", label: "Fixed opex (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula:
        "IF(T < 2, 0, " +
        "salary_operator + salary_assistant + prefilter_monthly + uv_monthly + amc_monthly + tech_monthly + mobile_monthly + cleaning_monthly" +
        " + IF(T == 2, lab_quarterly, IF((T - 2) % 3 == 0, lab_quarterly, 0)))",
      unit: "INR/mo" },
    { group: "pnl", key: "opex_total_monthly", label: "Total opex (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "opex_var_monthly + opex_fix_monthly", unit: "INR/mo" },
    { group: "pnl", key: "ebitda_monthly", label: "EBITDA (monthly)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "monthly" },
      formula: "revenue_monthly - opex_total_monthly", unit: "INR/mo" },

    // ── Annual rollups w/ inflation & price compounding ───────────────────
    // T = year index 0..4. Each year compounds inflation/price.
    { group: "pnl", key: "adoption_annual", label: "Adoption (annual avg)", kind: "formula", dataType: "percent",
      shape: { kind: "vector", horizon: "annual" },
      formula:
        "IF(T == 0, " +
        "(0 + 0 + adoption_m3 + (adoption_m3 + (adoption_m6 - adoption_m3) * 1 / 3) + (adoption_m3 + (adoption_m6 - adoption_m3) * 2 / 3) + adoption_m6 + (adoption_m6 + (adoption_m12 - adoption_m6) * 1 / 6) + (adoption_m6 + (adoption_m12 - adoption_m6) * 2 / 6) + (adoption_m6 + (adoption_m12 - adoption_m6) * 3 / 6) + (adoption_m6 + (adoption_m12 - adoption_m6) * 4 / 6) + (adoption_m6 + (adoption_m12 - adoption_m6) * 5 / 6) + adoption_m12) / 12, " +
        "IF(T == 1, adoption_y2, adoption_y3))",
      unit: "%" },
    { group: "pnl", key: "litres_annual", label: "Litres demanded (annual)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "annual" },
      formula: "hh_count * adoption_annual * litres_per_adopting_hh * 365", unit: "L/yr" },
    { group: "pnl", key: "capacity_litres_per_year", label: "Plant throughput ceiling / year", kind: "formula", dataType: "number",
      formula: "plant_lph * operating_hours_per_day * 365", unit: "L/yr" },
    { group: "pnl", key: "served_litres_annual", label: "Litres served / year (capped)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "annual" },
      formula: "IF(litres_annual < capacity_litres_per_year, litres_annual, capacity_litres_per_year)", unit: "L/yr" },
    { group: "pnl", key: "price_annual", label: "Effective price (annual)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "effective_price_per_litre * (1 + price_increase) ^ T", unit: "INR/L" },
    { group: "pnl", key: "revenue_annual", label: "Revenue (annual)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "served_litres_annual * price_annual", unit: "INR/yr" },
    { group: "pnl", key: "opex_annual_electricity", label: "Annual electricity (inflated)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "served_litres_annual / 1000 * electricity_kwh_per_1000l * electricity_rate * (1 + cost_inflation) ^ T", unit: "INR/yr" },
    { group: "pnl", key: "opex_annual_source_water", label: "Annual source water (inflated)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "served_litres_annual / ro_recovery_rate / 1000 * water_source_cost_per_1000l * (1 + cost_inflation) ^ T", unit: "INR/yr" },
    { group: "pnl", key: "opex_annual_membrane", label: "Annual membrane (inflated)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "membrane_annual_cost * (1 + cost_inflation) ^ T", unit: "INR/yr" },
    { group: "pnl", key: "opex_annual_consumables", label: "Annual consumables (filters, UV, cleaning)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "(prefilter_monthly + uv_monthly + cleaning_monthly) * 12 * (1 + cost_inflation) ^ T", unit: "INR/yr" },
    { group: "pnl", key: "opex_annual_staffing", label: "Annual staffing (Y1 prorated 10/12)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "(salary_operator + salary_assistant) * 12 * (1 + cost_inflation) ^ T * IF(T == 0, 10/12, 1)",
      unit: "INR/yr", notes: "Year 1 = 10/12 (no salary in commissioning months)" },
    { group: "pnl", key: "opex_annual_other", label: "Annual other fixed (AMC + tech + SIM + lab)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "(amc_monthly + tech_monthly + mobile_monthly) * 12 * (1 + cost_inflation) ^ T * IF(T == 0, 10/12, 1) + lab_quarterly * 4 * (1 + cost_inflation) ^ T",
      unit: "INR/yr" },
    { group: "pnl", key: "opex_annual", label: "Total annual opex", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "opex_annual_electricity + opex_annual_source_water + opex_annual_membrane + opex_annual_consumables + opex_annual_staffing + opex_annual_other",
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

    // ── Cost Recovery sheet ───────────────────────────────────────────────
    { group: "cost_recovery", key: "oss_ratio_annual", label: "Operational Self-Sufficiency (OSS)", kind: "formula", dataType: "number",
      shape: { kind: "vector", horizon: "annual" },
      formula: "IFERROR(revenue_annual / opex_annual, 0)", notes: "Above 1.0 = self-sustaining; 1.5+ = comfortable; 2.0+ = funder can step back" },
    { group: "cost_recovery", key: "replacement_reserve_annual", label: "Annual replacement reserve required", kind: "formula", dataType: "currency",
      formula:
        "capex_ro_plant / 8 + " +    // RO plant: 100% replacement / 8 yrs
        "capex_atm / 5 + " +          // ATM: 100% / 5
        "capex_tanks / 15 + " +       // Tanks: 100% / 15
        "capex_civil * 0.1 / 10 + " + // Civil: 10% / 10
        "capex_plumbing * 0.3 / 12 + " +
        "capex_borewell * 0.2 / 15 + " +
        "capex_solar * 0.4 / 10 + " +
        "capex_iot / 5",
      unit: "INR/yr",
      notes: "Replacement scope × original capex ÷ asset lifecycle. Sum of all assets." },
    { group: "cost_recovery", key: "community_surplus_annual", label: "Community surplus (EBITDA − reserves)", kind: "formula", dataType: "currency",
      shape: { kind: "vector", horizon: "annual" },
      formula: "ebitda_annual - replacement_reserve_annual" },

    // ── Operations (sim-only) ─────────────────────────────────────────────
    // Intra-day demand-shaping lever for the day-in-the-life simulation. Has no
    // bearing on the 5-year finance roll-up, hence sim-only.
    { group: "ops", key: "peak_concentration", label: "Peak concentration", kind: "input", dataType: "number", defaultJson: 100, unit: "", notes: "Higher = sharper morning/evening rush", surface: "sim", ui: { min: 60, max: 200, step: 5 } },
  ];

  const seedNodeKeys = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    seedNodeKeys.add(n.key);
    await prisma.modelNode.upsert({
      where: { templateId_key: { templateId: template.id, key: n.key } },
      create: {
        templateId: template.id, groupId: groups[n.group],
        key: n.key, label: n.label, kind: n.kind, dataType: n.dataType,
        shape: n.shape ?? { kind: "scalar" },
        defaultJson: n.defaultJson === undefined ? undefined : (n.defaultJson as never),
        formula: n.formula ?? null,
        unit: n.unit ?? null, notes: n.notes ?? null,
        surface: n.surface ?? "both",
        tier: n.tier ?? "basic",
        uiJson: n.ui === undefined ? undefined : (n.ui as never),
        order: i,
      },
      update: {
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
      },
    });
  }
  const pruned = await prisma.modelNode.deleteMany({
    where: { templateId: template.id, key: { notIn: [...seedNodeKeys] } },
  });
  if (pruned.count > 0) console.log(`  pruned ${pruned.count} stale node(s)`);

  // ── Outputs ─────────────────────────────────────────────────────────────
  type OutputIn = { key: string; label: string; kind: string; config: Record<string, unknown>; order: number };
  const outputs: OutputIn[] = [
    // KPI cards
    { key: "kpi_total_capex",     label: "Total Capex",            kind: "kpi", order: 0,  config: { nodeKey: "capex_total", format: "currency" } },
    { key: "kpi_capex_per_hh",    label: "Capex / HH",             kind: "kpi", order: 1,  config: { nodeKey: "capex_per_hh", format: "currency" } },
    { key: "kpi_opex_steady",     label: "Monthly Opex (steady)",  kind: "kpi", order: 2,  config: { nodeKey: "opex_monthly_steady", format: "currency" } },
    { key: "kpi_breakeven",       label: "Break-even price",       kind: "kpi", order: 3,  config: { nodeKey: "breakeven_price_per_litre", format: "currency" } },
    { key: "kpi_y1_revenue",      label: "Year-1 Revenue",         kind: "kpi", order: 4,  config: { nodeKey: "revenue_annual", index: 0, format: "currency" } },
    { key: "kpi_y3_ebitda",       label: "Year-3 EBITDA",          kind: "kpi", order: 5,  config: { nodeKey: "ebitda_annual",  index: 2, format: "currency" } },
    { key: "kpi_y3_oss",          label: "Year-3 OSS ratio",       kind: "kpi", order: 6,  config: { nodeKey: "oss_ratio_annual", index: 2, format: "number" } },
    { key: "kpi_demand_met",      label: "Demand met",             kind: "kpi", order: 7,  config: { nodeKey: "capacity_utilisation_steady", format: "percent" } },
    { key: "kpi_npv",             label: "5-Year NPV",             kind: "kpi", order: 8,  config: { nodeKey: "npv_5yr", format: "currency" } },

    // Time-series charts — Revenue vs Opex vs EBITDA on one chart (monthly + annual),
    // OSS standalone. Colors: revenue green, opex amber, EBITDA blue.
    { key: "series_pnl_m", label: "Monthly P&L — Revenue vs Opex vs EBITDA", kind: "seriesGroup", order: 10,
      config: {
        horizon: "monthly", format: "currency",
        series: [
          { nodeKey: "revenue_monthly",    label: "Revenue", color: "#10b981" },
          { nodeKey: "opex_total_monthly", label: "Opex",    color: "#f59e0b" },
          { nodeKey: "ebitda_monthly",     label: "EBITDA",  color: "#2563eb" },
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

    // Sensitivity grid (engine impl in next phase will read this config)
    { key: "sens_ebitda_y3",
      label: "Year-3 EBITDA: Adoption × Price",
      kind: "sensitivity", order: 20,
      config: {
        xNode: "adoption_y3", xValues: [0.55, 0.65, 0.75, 0.82, 0.90],
        yNode: "price_per_litre", yValues: [1.0, 1.5, 2.0, 2.5, 3.0],
        resultNode: "ebitda_annual", resultIndex: 2,
        format: "currency",
      } },

    // Budget bridge: map model nodes → budget line items. Picks the per-line
    // capex inputs (already itemised) + key opex inputs scaled to year 1.
    { key: "budget_export_year1", label: "Promote to Budget — Year 1", kind: "budgetExport", order: 30,
      config: {
        domainName: "RO_Water",
        years: 1,
        // templateKey links each promoted BudgetLine to its LineTemplate row →
        // regenerate-safe (same shape as Sanitation_Complex).
        capexLines: [
          { nodeKey: "capex_ro_plant",    description: "RO plant (skid + membranes + UV)", templateKey: "ro.cap_plant" },
          { nodeKey: "capex_atm",         description: "Water ATM dispensing unit",         templateKey: "ro.cap_atm" },
          { nodeKey: "capex_tanks",       description: "Storage tanks (raw + product)",     templateKey: "ro.cap_tanks" },
          { nodeKey: "capex_civil",       description: "Civil works (room, foundation)",    templateKey: "ro.cap_civil" },
          { nodeKey: "capex_plumbing",    description: "Plumbing & electrical works",       templateKey: "ro.cap_plumbing" },
          { nodeKey: "capex_borewell",    description: "Borewell / water source connection", templateKey: "ro.cap_borewell" },
          { nodeKey: "capex_solar",       description: "Solar PV system",                   templateKey: "ro.cap_solar" },
          { nodeKey: "capex_iot",         description: "Payment & IoT system",              templateKey: "ro.cap_iot" },
          { nodeKey: "capex_surveys",     description: "Pre-installation surveys & design", templateKey: "ro.cap_surveys" },
          { nodeKey: "capex_contingency", description: "Contingency",                       templateKey: "ro.cap_contingency" },
        ],
        opexLines: [
          { nodeKey: "salary_operator",            description: "Operator salary",         costCategory: "Salary", months: 10, templateKey: "ro.operator" },
          { nodeKey: "salary_assistant",           description: "Assistant / helper",      costCategory: "Salary", months: 10, templateKey: "ro.assistant" },
          { nodeKey: "opex_steady_electricity",    description: "Electricity",             costCategory: "Other",  months: 12, templateKey: "ro.electricity" },
          { nodeKey: "opex_steady_source_water",   description: "Source water",            costCategory: "Other",  months: 12, templateKey: "ro.source_water" },
          { nodeKey: "opex_steady_membrane",       description: "Membrane (amortised)",    costCategory: "Other",  months: 12, templateKey: "ro.membrane" },
          { nodeKey: "prefilter_monthly",          description: "Pre-filter cartridges",   costCategory: "Other",  months: 10, templateKey: "ro.prefilter" },
          { nodeKey: "uv_monthly",                 description: "UV lamp & consumables",   costCategory: "Other",  months: 10, templateKey: "ro.uv" },
          { nodeKey: "amc_monthly",                description: "Maintenance / AMC reserve", costCategory: "Other", months: 10, templateKey: "ro.amc" },
          { nodeKey: "tech_monthly",               description: "Technology / monitoring", costCategory: "Other",  months: 10, templateKey: "ro.tech" },
          { nodeKey: "mobile_monthly",             description: "Mobile / internet",       costCategory: "Other",  months: 10, templateKey: "ro.mobile" },
          { nodeKey: "cleaning_monthly",           description: "Cleaning supplies",       costCategory: "Other",  months: 10, templateKey: "ro.cleaning" },
          { nodeKey: "opex_steady_lab",            description: "Water quality testing",   costCategory: "Other",  months: 10, templateKey: "ro.lab" },
        ],
        // Model input key → budget inp.* key (drop "inp." prefix in the value).
        inputMapping: {
          plant_lph: "roLph",
          tank_litres: "roTankLitres",
          solar_kwp: "roSolarKwp",
          has_borewell: "hasBorewell",
        },
      } },

    // Operations day-in-the-life sim. Reads the same instance inputs via this
    // nodeKey map — rendered on the Operations tab only (see PlayWorkbench).
    { key: "daysim_ops", label: "Operations — day in the life", kind: "daySim", order: 40,
      config: {
        schematic: "ro_water",
        nodes: {
          lph: "plant_lph", tankCap: "tank_litres", cansCount: "cans_count",
          hh: "hh_count", adoption: "adoption_y3", lpd: "litres_per_adopting_hh",
          peak: "peak_concentration", price: "effective_price_per_litre", opexMonthly: "opex_monthly_steady",
          operatingDays: "days_per_month", operatingHours: "operating_hours_per_day",
        },
        // Engine constants + presentation live in config (editable in the Sim
        // tab). Seeded from the defaults so the DB is the source of truth.
        constants: DEFAULT_RO_CONSTANTS,
        presentation: DEFAULT_RO_PRESENTATION,
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

  const existingCount = await prisma.modelInstance.count({ where: { templateId: template.id } });
  let instance;
  if (existingCount === 0) {
    instance = await prisma.modelInstance.create({
      data: { templateId: template.id, name: "RO Water — Base", scenarioName: "Base" },
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
