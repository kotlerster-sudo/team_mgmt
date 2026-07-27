// RO Water — parametric cost rates.
//
// Single source of truth shared by:
//   - scripts/seed-ro-water-registry.ts (writes CostRegistry rows)
//   - prisma/seed-operating-model-ro-water.ts (writes ModelNode constants)
//
// Rates anchored to the existing RO_Water model defaults (calibrated for a
// 1000 LPH community-scale plant serving ~200 HH), with capex made parametric
// on:
//   - inp.roLph              — RO plant capacity in L/hour
//   - inp.roTankLitres       — raw + product storage size in L
//   - inp.roSolarKwp         — solar PV backup in kWp
//   - inp.hasBorewell        — 0/1 gate for borewell + source connection

export type ComponentBreakup = {
  label: string;
  spec?: string;
  qty: number;
  unitCost: number;
  notes?: string;
};

export type CostRate = {
  key: string;
  standardUnitCost: number;
  costUnit: string;
  notes?: string;
  derivation?: string;
  displayGroup?: string;
  components?: ComponentBreakup[];
};

export const RO_WATER_RATES: CostRate[] = [
  // ── Plant (₹/LPH) ────────────────────────────────────────────────────────
  {
    key: "ro.plant_per_lph",
    standardUnitCost: 600,
    costUnit: "₹/LPH",
    notes: "RO skid + membranes + UV per L/hour of product capacity.",
    derivation: "Community-grade skid+membranes+UV. ×1000 LPH = ₹6L base.",
    components: [
      { label: "RO skid + membranes",   qty: 1, unitCost: 400 },
      { label: "UV disinfection",       qty: 1, unitCost: 100 },
      { label: "Pre-treatment + dosing", qty: 1, unitCost: 100 },
    ],
  },

  // ── ATM (fixed) ─────────────────────────────────────────────────────────
  {
    key: "ro.atm_fixed",
    standardUnitCost: 150000,
    costUnit: "₹/plant",
    notes: "Water ATM dispensing unit (RFID + UPI capable).",
  },

  // ── Tanks (₹/L) ─────────────────────────────────────────────────────────
  {
    key: "ro.tanks_per_litre",
    standardUnitCost: 40,
    costUnit: "₹/L",
    notes: "Raw + product storage per litre of product-tank size.",
    components: [
      { label: "Product tank (food-grade)", qty: 1, unitCost: 25 },
      { label: "Raw / feed tank + fittings", qty: 1, unitCost: 15 },
    ],
  },

  // ── Civil, plumbing, borewell, iot, surveys (fixed per plant) ───────────
  {
    key: "ro.civil_fixed",
    standardUnitCost: 200000,
    costUnit: "₹/plant",
    notes: "Room + foundation + platform (RO plants are typically single-room installations).",
  },
  {
    key: "ro.plumbing_fixed",
    standardUnitCost: 100000,
    costUnit: "₹/plant",
    notes: "Feed line + reject line + product plumbing + electrical panel + wiring.",
  },
  {
    key: "ro.borewell_fixed",
    standardUnitCost: 75000,
    costUnit: "₹/plant",
    notes: "Borewell / water source connection. Set inp.hasBorewell = 0 if using municipal supply.",
  },
  {
    key: "ro.iot_fixed",
    standardUnitCost: 50000,
    costUnit: "₹/plant",
    notes: "RFID reader + IoT gateway + cloud monitoring subscription setup.",
  },
  {
    key: "ro.surveys_fixed",
    standardUnitCost: 50000,
    costUnit: "₹/plant",
    notes: "Pre-installation surveys, borewell test, design + drawings.",
  },

  // ── Solar (₹/kWp) ────────────────────────────────────────────────────────
  {
    key: "ro.solar_per_kwp",
    standardUnitCost: 80000,
    costUnit: "₹/kWp",
    notes: "Backup PV — smaller-scale than a full community complex, cheaper per kWp.",
    components: [
      { label: "PV panels",             qty: 1, unitCost: 30000 },
      { label: "Inverter + BOS",        qty: 1, unitCost: 20000 },
      { label: "Battery share",         qty: 1, unitCost: 20000 },
      { label: "Install + commission",  qty: 1, unitCost: 10000 },
    ],
  },

  // ── Contingency (% of subtotal) ──────────────────────────────────────────
  {
    key: "ro.contingency_pct_of_subtotal",
    standardUnitCost: 10,
    costUnit: "% of hardware subtotal",
    notes: "Standard 8–12% buffer.",
  },
];

export type ComputedRegistryKey = { key: string; formula: string };

export const RO_WATER_COMPUTED_KEYS: ComputedRegistryKey[] = [
  { key: "ro.cap_plant_derived",     formula: "inp.roLph * ro.plant_per_lph" },
  { key: "ro.cap_atm_derived",       formula: "ro.atm_fixed" },
  { key: "ro.cap_tanks_derived",     formula: "inp.roTankLitres * ro.tanks_per_litre" },
  { key: "ro.cap_civil_derived",     formula: "ro.civil_fixed" },
  { key: "ro.cap_plumbing_derived",  formula: "ro.plumbing_fixed" },
  { key: "ro.cap_borewell_derived",  formula: "inp.hasBorewell * ro.borewell_fixed" },
  { key: "ro.cap_solar_derived",     formula: "inp.roSolarKwp * ro.solar_per_kwp" },
  { key: "ro.cap_iot_derived",       formula: "ro.iot_fixed" },
  { key: "ro.cap_surveys_derived",   formula: "ro.surveys_fixed" },
  {
    key: "ro.hardware_subtotal_derived",
    formula:
      "ro.cap_plant_derived + ro.cap_atm_derived + ro.cap_tanks_derived + " +
      "ro.cap_civil_derived + ro.cap_plumbing_derived + ro.cap_borewell_derived + " +
      "ro.cap_solar_derived + ro.cap_iot_derived + ro.cap_surveys_derived",
  },
  {
    key: "ro.cap_contingency_derived",
    formula: "ro.hardware_subtotal_derived * ro.contingency_pct_of_subtotal / 100",
  },
];

export const RO_WATER_INPUT_DEFAULTS = {
  nRO_Plants: 1,
  roLph: 1000,
  roTankLitres: 4000,
  roSolarKwp: 2.5,
  hasBorewell: 1,
  roPlantRentPerMonth: 0,
};
