// Sanitation Complex — parametric cost rates and area constants.
//
// Single source of truth for both:
//   - `scripts/seed-sanitation-registry.ts` (writes CostRegistry + CostRegistryComponent rows)
//   - `prisma/seed-operating-model-sanitation-complex.ts` (writes ModelNode constants)
//
// Rates reverse-engineered from the Community Sanitation Complexes doc:
//   - Civil G+2 300–500 sqm = ₹60–90L → ₹18k/sqm at G+2
//   - Plumbing ₹10–18L for a 30-seat / 500-user build
//   - Semi-commercial washing machines ₹67–100k → mid ₹80k/unit
//   - RO plant ₹500–800/LPH
//   - MBBR STP ₹53–67k per KLD
//   - Solar ₹100–120k per kWp
//   - SBM benchmark ~₹98k per WC seat total
//
// All amounts in INR. Bangalore-anchored; Chennai adjustment factor applied
// as a single multiplier below.

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

// ─── Per-unit hardware rates ────────────────────────────────────────────────

export const SANITATION_RATES: CostRate[] = [
  // ── Civil (₹/sqm × structure_type) ──────────────────────────────────────
  {
    key: "san.civil_per_sqm_single",
    standardUnitCost: 12000,
    costUnit: "₹/sqm",
    notes: "Single-floor RCC/masonry, finishes, anti-slip flooring, ventilation.",
    derivation: "Blended finished ₹/sqm for a single-storey RCC wet block in Bangalore, 2026.",
    components: [
      { label: "RCC + frame + slab", qty: 1, unitCost: 5500, spec: "M20, IS 456" },
      { label: "Brickwork + plaster", qty: 1, unitCost: 2200 },
      { label: "Flooring + tiling (R11 anti-slip)", qty: 1, unitCost: 2200 },
      { label: "Waterproofing", qty: 1, unitCost: 900 },
      { label: "Ceiling + paint + finishes", qty: 1, unitCost: 900 },
      { label: "Doors + windows share", qty: 1, unitCost: 300 },
    ],
  },
  {
    key: "san.civil_per_sqm_g1",
    standardUnitCost: 15000,
    costUnit: "₹/sqm",
    notes: "G+1 RCC frame + staircase + intermediate slab.",
    components: [
      { label: "RCC frame + slabs (G+1)", qty: 1, unitCost: 7000 },
      { label: "Brickwork + plaster", qty: 1, unitCost: 2700 },
      { label: "Flooring + tiling", qty: 1, unitCost: 2400 },
      { label: "Waterproofing (both floors + terrace)", qty: 1, unitCost: 1200 },
      { label: "Staircase + railings", qty: 1, unitCost: 700 },
      { label: "Ceiling + paint + finishes", qty: 1, unitCost: 1000 },
    ],
  },
  {
    key: "san.civil_per_sqm_g2",
    standardUnitCost: 18000,
    costUnit: "₹/sqm",
    notes: "G+2 RCC frame + 2 staircases + terrace works — Suvidha-style.",
    derivation: "Interpolated from doc: civil for 300–500 sqm G+2 = ₹60–90L → ₹18k/sqm midpoint.",
    components: [
      { label: "RCC frame + slabs (G+2)", qty: 1, unitCost: 8000 },
      { label: "Brickwork + plaster", qty: 1, unitCost: 3500 },
      { label: "Flooring + tiling (R11)", qty: 1, unitCost: 3000 },
      { label: "Waterproofing (both floors + terrace)", qty: 1, unitCost: 1500 },
      { label: "Terrace works + parapets", qty: 1, unitCost: 800 },
      { label: "Ceiling + paint + finishes", qty: 1, unitCost: 1200 },
    ],
  },
  {
    key: "san.civil_shell_fixed",
    standardUnitCost: 200000,
    costUnit: "₹/complex",
    notes: "Foundation + entrance + boundary + non-scaling site overheads.",
  },

  // ── Plumbing (per fixture) ──────────────────────────────────────────────
  {
    key: "san.plumbing_per_wc_seat",
    standardUnitCost: 12000,
    costUnit: "₹/seat",
    notes: "Low-flush pan + cistern + water line + drain line per seat.",
    components: [
      { label: "Low-flush ceramic pan (Indian/Western)", qty: 1, unitCost: 4500 },
      { label: "Push-valve cistern + fittings", qty: 1, unitCost: 3500 },
      { label: "Supply line + isolation valve", qty: 1, unitCost: 2000 },
      { label: "Drain line + trap", qty: 1, unitCost: 2000 },
    ],
  },
  {
    key: "san.plumbing_per_bath",
    standardUnitCost: 15000,
    costUnit: "₹/cubicle",
    notes: "Push-valve shower + mixer + drain + door hardware per cubicle.",
    components: [
      { label: "Push-valve shower + mixer", qty: 1, unitCost: 5000 },
      { label: "Supply + hot line + isolation", qty: 1, unitCost: 3500 },
      { label: "Drain + P-trap + gully", qty: 1, unitCost: 2500 },
      { label: "Door + latch + hooks", qty: 1, unitCost: 4000 },
    ],
  },
  {
    key: "san.plumbing_per_machine",
    standardUnitCost: 8000,
    costUnit: "₹/machine",
    notes: "Hot + cold supply + drain hookup + isolation valves per machine.",
    components: [
      { label: "Hot + cold supply lines", qty: 1, unitCost: 3500 },
      { label: "Drain hookup + trap", qty: 1, unitCost: 2500 },
      { label: "Isolation valves + hoses", qty: 1, unitCost: 2000 },
    ],
  },
  {
    key: "san.plumbing_per_ro_lph",
    standardUnitCost: 100,
    costUnit: "₹/LPH",
    notes: "Feed line + RO reject line + product-water plumbing to ATM.",
  },
  {
    key: "san.plumbing_fixed",
    standardUnitCost: 250000,
    costUnit: "₹/complex",
    notes: "Handwash stations + manifolds + risers + backbone piping (non-scaling).",
  },

  // ── Electrical (₹/sqm × structure_type, plus fixed backbone) ────────────
  {
    key: "san.electrical_per_sqm_single",
    standardUnitCost: 800,
    costUnit: "₹/sqm",
    notes: "Wiring + LED lighting + exhaust fans + sockets for single-floor.",
  },
  {
    key: "san.electrical_per_sqm_g1",
    standardUnitCost: 1000,
    costUnit: "₹/sqm",
    notes: "Wiring + lighting + exhaust for G+1 (extra risers + floor panels).",
  },
  {
    key: "san.electrical_per_sqm_g2",
    standardUnitCost: 1200,
    costUnit: "₹/sqm",
    notes: "Wiring + lighting + exhaust for G+2 (3 floors + lift wiring provision).",
  },
  {
    key: "san.electrical_fixed",
    standardUnitCost: 150000,
    costUnit: "₹/complex",
    notes: "Main panel + BESCOM meter + earthing + backbone (non-scaling).",
    components: [
      { label: "Main panel + MCB + RCCB", qty: 1, unitCost: 55000 },
      { label: "BESCOM commercial meter + connection charges", qty: 1, unitCost: 40000 },
      { label: "Earthing + lightning arrester", qty: 1, unitCost: 25000 },
      { label: "Backbone conduit + cable trays", qty: 1, unitCost: 30000 },
    ],
  },

  // ── Storage tanks (₹/L) ─────────────────────────────────────────────────
  {
    key: "san.tanks_per_litre",
    standardUnitCost: 8,
    costUnit: "₹/L",
    notes: "Blended UG + OH storage capacity, food-grade HDPE or stainless.",
    components: [
      { label: "Underground sump (concrete/HDPE)", qty: 1, unitCost: 5 },
      { label: "Overhead tank + platform", qty: 1, unitCost: 3 },
    ],
  },
  {
    key: "san.tanks_fixed",
    standardUnitCost: 100000,
    costUnit: "₹/complex",
    notes: "Level sensors + inlet/outlet valves + platform (non-scaling).",
  },

  // ── Solar (₹/kWp) ───────────────────────────────────────────────────────
  {
    key: "san.solar_per_kwp",
    standardUnitCost: 100000,
    costUnit: "₹/kWp",
    notes: "Complete installed: panels + inverter + battery share + BOS.",
    derivation: "Doc §5.3: 3–5 kWp installed at ₹3–6L → ₹100–120k/kWp midpoint.",
    components: [
      { label: "PV panels (poly/mono)", qty: 1, unitCost: 35000 },
      { label: "Inverter (grid-tie or hybrid)", qty: 1, unitCost: 18000 },
      { label: "Battery bank share (li-ion or lead-acid)", qty: 1, unitCost: 25000 },
      { label: "Mounting + cabling + isolators", qty: 1, unitCost: 12000 },
      { label: "Installation + commissioning + net-metering", qty: 1, unitCost: 10000 },
    ],
  },

  // ── IoT + payment (per-fixture + fixed) ─────────────────────────────────
  {
    key: "san.iot_per_wc_seat",
    standardUnitCost: 3000,
    costUnit: "₹/seat",
    notes: "Turnstile share + occupancy sensor + door lock per seat.",
  },
  {
    key: "san.iot_per_bath",
    standardUnitCost: 2000,
    costUnit: "₹/cubicle",
    notes: "Prepaid meter + occupancy sensor per bath cubicle.",
  },
  {
    key: "san.iot_fixed",
    standardUnitCost: 50000,
    costUnit: "₹/complex",
    notes: "Central controller + IoT gateway + RFID reader + cloud dashboard.",
    components: [
      { label: "Central controller + Raspberry Pi/edge unit", qty: 1, unitCost: 15000 },
      { label: "IoT gateway + 4G modem", qty: 1, unitCost: 12000 },
      { label: "RFID reader + card issuer", qty: 1, unitCost: 15000 },
      { label: "Cloud dashboard + install", qty: 1, unitCost: 8000 },
    ],
  },

  // ── Signage / accessibility (per-fixture + fixed) ───────────────────────
  {
    key: "san.signage_per_fixture",
    standardUnitCost: 1500,
    costUnit: "₹/fixture",
    notes: "Braille labels + gender signage + hooks + shelves per WC/bath/laundry bay.",
  },
  {
    key: "san.signage_fixed",
    standardUnitCost: 40000,
    costUnit: "₹/complex",
    notes: "Ramp + grab rails + entrance signage + noticeboards (non-scaling).",
  },

  // ── Approval fees (fixed + per-seat SBM) ────────────────────────────────
  {
    key: "san.approval_fixed",
    standardUnitCost: 50000,
    costUnit: "₹/complex",
    notes: "BBMP building plan + KSPCB CTE + FSSAI + fire NOC lumped.",
  },
  {
    key: "san.approval_per_seat",
    standardUnitCost: 2000,
    costUnit: "₹/seat",
    notes: "BBMP scales the sanction fee with seat count.",
  },

  // ── Design + supervision, contingency, tax (percentages) ────────────────
  {
    key: "san.design_pct_of_hardware",
    standardUnitCost: 7,
    costUnit: "% of hardware subtotal",
    notes: "Architect + structural + MEP + PM. Industry norm 6–8%.",
  },
  {
    key: "san.contingency_pct_of_subtotal",
    standardUnitCost: 10,
    costUnit: "% of (hardware + design)",
    notes: "Standard 8–12% buffer for civil/plumbing overruns.",
  },
  {
    key: "san.tax_pct_of_subtotal",
    standardUnitCost: 5,
    costUnit: "% of (hardware + design)",
    notes: "Blended GST across mixed-rate components.",
  },

  // ── Equipment (per-unit) ────────────────────────────────────────────────
  {
    key: "san.capex_per_washing_machine",
    standardUnitCost: 80000,
    costUnit: "₹/machine",
    notes: "Semi-commercial front-load washer, 8–10kg. Spin dryer share included.",
    derivation: "Doc §4.4: 6 industrial machines ₹4–6L → ₹80k/unit midpoint incl. dryer share.",
    components: [
      { label: "Semi-commercial washer 8–10kg", qty: 1, unitCost: 65000 },
      { label: "Spin dryer share (1 dryer per 2 washers)", qty: 1, unitCost: 8000 },
      { label: "Delivery + install + testing", qty: 1, unitCost: 7000 },
    ],
  },
  {
    key: "san.capex_per_ro_lph",
    standardUnitCost: 650,
    costUnit: "₹/LPH",
    notes: "RO plant (skid+membranes+UV+ATM) per L/hour of product capacity.",
    derivation: "Doc §4.3 / §8.1: 1000 LPH ₹5–8L → ₹650/LPH midpoint incl. water ATM.",
    components: [
      { label: "RO skid + membranes + UV", qty: 1, unitCost: 400 },
      { label: "Water ATM (RFID + UPI, share per LPH)", qty: 1, unitCost: 150 },
      { label: "Pre-treatment + antiscalant dosing", qty: 1, unitCost: 100 },
    ],
  },
  {
    key: "san.capex_stp_per_kld",
    standardUnitCost: 55000,
    costUnit: "₹/KLD",
    notes: "MBBR-based packaged greywater treatment plant per KL/day capacity.",
    derivation: "Doc §4.5 / §8.1: 15–30 KLD ₹8–20L → ₹55k/KLD midpoint.",
    components: [
      { label: "MBBR media + reactor tank", qty: 1, unitCost: 22000 },
      { label: "Blowers + recirculation pumps", qty: 1, unitCost: 12000 },
      { label: "Controls + PLC + level sensors", qty: 1, unitCost: 8000 },
      { label: "Screens + grease trap + polishing filter", qty: 1, unitCost: 4000 },
      { label: "Installation + commissioning + testing", qty: 1, unitCost: 9000 },
    ],
  },
  {
    key: "san.capex_biodigester_per_seat",
    standardUnitCost: 11154,
    costUnit: "₹/seat",
    notes: "DRDO-style biodigester or septic, sized per WC seat.",
  },

  // ── Area derivation constants (sqm per fixture / service room) ──────────
  {
    key: "san.sqm_per_wc_seat",
    standardUnitCost: 3.5,
    costUnit: "sqm/seat",
    notes: "Cubicle + share of corridor + share of handwash frontage (IS 1172 recommended sizes).",
  },
  {
    key: "san.sqm_per_bath",
    standardUnitCost: 3.0,
    costUnit: "sqm/cubicle",
    notes: "Recommended 1.5m × 1.5m cubicle + share of approach/drying corridor.",
  },
  {
    key: "san.sqm_per_machine",
    standardUnitCost: 2.5,
    costUnit: "sqm/machine",
    notes: "Machine footprint + load/unload bay share (doc §4.2 recommended 1.2m × 1.5m).",
  },
  {
    key: "san.sqm_per_stp_kld",
    standardUnitCost: 1.5,
    costUnit: "sqm/KLD",
    notes: "MBBR tank footprint + blower room share per KLD capacity.",
  },
  {
    key: "san.sqm_ro_room_fixed",
    standardUnitCost: 15,
    costUnit: "sqm",
    notes: "RO plant room + ATM dispensing counter (fixed regardless of LPH).",
  },
  {
    key: "san.sqm_service_rooms_fixed",
    standardUnitCost: 30,
    costUnit: "sqm",
    notes: "Operations room + attendant counter + electrical panel + tank room (fixed).",
  },
  {
    key: "san.sqm_circulation_pct",
    standardUnitCost: 25,
    costUnit: "%",
    notes: "Circulation + walls + stairs added on top of net programme sqm.",
  },
];

// ─── Computed registry keys ─────────────────────────────────────────────────
//
// Evaluated by the budget generator in declared order. Each formula sees the
// augmented registry (all rates above + all inp.* + prior computed keys).
// These implement the shared subexpressions used by multiple LineTemplates
// (area, hardware subtotal, design derived) so LineTemplate.formula stays
// short and reconciles automatically when a component rate changes.

export type ComputedRegistryKey = { key: string; formula: string };

export const SANITATION_COMPUTED_KEYS: ComputedRegistryKey[] = [
  // Auto-derived built-up area. `inp.areaSqmOverride > 0` disables the derivation.
  {
    key: "san.area_sqm_derived",
    formula:
      "IF(inp.areaSqmOverride > 0, inp.areaSqmOverride, " +
      "(inp.wcSeats * san.sqm_per_wc_seat + " +
      " inp.bathCubicles * san.sqm_per_bath + " +
      " inp.washingMachines * san.sqm_per_machine + " +
      " inp.stpKld * san.sqm_per_stp_kld + " +
      " san.sqm_ro_room_fixed + san.sqm_service_rooms_fixed) * " +
      " (1 + san.sqm_circulation_pct / 100))",
  },
  // Structure-type-aware ₹/sqm rates. structureType is stored as a string in
  // inp.* — but our formula engine only handles numbers. We instead use three
  // sentinel numeric inputs: inp.structureIsG2, inp.structureIsG1, inp.structureIsSingle
  // (exactly one of which is 1) driven by the form. See lib/budget/inputEnumOptions.ts.
  {
    key: "san.civil_rate_per_sqm",
    formula:
      "inp.structureIsG2 * san.civil_per_sqm_g2 + " +
      "inp.structureIsG1 * san.civil_per_sqm_g1 + " +
      "inp.structureIsSingle * san.civil_per_sqm_single",
  },
  {
    key: "san.electrical_rate_per_sqm",
    formula:
      "inp.structureIsG2 * san.electrical_per_sqm_g2 + " +
      "inp.structureIsG1 * san.electrical_per_sqm_g1 + " +
      "inp.structureIsSingle * san.electrical_per_sqm_single",
  },
  // Hardware sub-line values (used both by the LineTemplates and by the
  // derived subtotal below). Kept as computed keys so design/contingency/tax
  // stay reconciled if any component rate changes.
  {
    key: "san.cap_civil_derived",
    formula: "san.area_sqm_derived * san.civil_rate_per_sqm + san.civil_shell_fixed",
  },
  {
    key: "san.cap_plumbing_derived",
    formula:
      "inp.wcSeats * san.plumbing_per_wc_seat + " +
      "inp.bathCubicles * san.plumbing_per_bath + " +
      "inp.washingMachines * san.plumbing_per_machine + " +
      "inp.roLph * san.plumbing_per_ro_lph + " +
      "san.plumbing_fixed",
  },
  {
    key: "san.cap_washing_machines_derived",
    formula: "inp.washingMachines * san.capex_per_washing_machine",
  },
  {
    key: "san.cap_ro_derived",
    formula: "inp.roLph * san.capex_per_ro_lph",
  },
  {
    key: "san.cap_stp_derived",
    formula: "inp.stpKld * san.capex_stp_per_kld",
  },
  {
    key: "san.cap_biodigester_derived",
    formula: "inp.wcSeats * san.capex_biodigester_per_seat",
  },
  {
    key: "san.cap_tanks_derived",
    formula: "inp.tankStorageLitres * san.tanks_per_litre + san.tanks_fixed",
  },
  {
    key: "san.cap_solar_derived",
    formula: "inp.solarKwp * san.solar_per_kwp",
  },
  {
    key: "san.cap_electrical_derived",
    formula: "san.area_sqm_derived * san.electrical_rate_per_sqm + san.electrical_fixed",
  },
  {
    key: "san.cap_iot_derived",
    formula:
      "inp.wcSeats * san.iot_per_wc_seat + " +
      "inp.bathCubicles * san.iot_per_bath + " +
      "san.iot_fixed",
  },
  {
    key: "san.cap_signage_derived",
    formula:
      "(inp.wcSeats + inp.bathCubicles + inp.washingMachines) * san.signage_per_fixture + " +
      "san.signage_fixed",
  },
  {
    key: "san.cap_approval_derived",
    formula: "san.approval_fixed + inp.wcSeats * san.approval_per_seat",
  },
  // Hardware = everything above except design/contingency/tax.
  {
    key: "san.hardware_subtotal_derived",
    formula:
      "san.cap_civil_derived + san.cap_plumbing_derived + " +
      "san.cap_washing_machines_derived + san.cap_ro_derived + " +
      "san.cap_stp_derived + san.cap_biodigester_derived + " +
      "san.cap_tanks_derived + san.cap_solar_derived + " +
      "san.cap_electrical_derived + san.cap_iot_derived + " +
      "san.cap_signage_derived + san.cap_approval_derived",
  },
  {
    key: "san.cap_design_derived",
    formula: "san.hardware_subtotal_derived * san.design_pct_of_hardware / 100",
  },
  {
    key: "san.cap_contingency_derived",
    formula:
      "(san.hardware_subtotal_derived + san.cap_design_derived) * " +
      "san.contingency_pct_of_subtotal / 100",
  },
  {
    key: "san.cap_tax_derived",
    formula:
      "(san.hardware_subtotal_derived + san.cap_design_derived) * " +
      "san.tax_pct_of_subtotal / 100",
  },
];

// ─── Input defaults (mirrors the model template's input defaults) ───────────
//
// Used by the budget-side STANDARD_PROG_INPUTS seed and by the model's ModelNode
// defaults. Keeping them here means one edit updates both surfaces.

export const SANITATION_INPUT_DEFAULTS = {
  nSanitationComplexes: 1,
  wcSeats: 30,
  bathCubicles: 8,
  washingMachines: 4,
  roLph: 1000,
  stpKld: 12,
  solarKwp: 5,
  tankStorageLitres: 33000,
  // Enum expanded into 3 sentinels; defaults reflect structureType="g_plus_2".
  structureIsG2: 1,
  structureIsG1: 0,
  structureIsSingle: 0,
  areaSqmOverride: 0,
  sanitationComplexRentPerMonth: 0,
};

// The enum ↔ sentinel mapping is exposed for the budget form and the model
// UI. Keep in sync with lib/budget/inputEnumOptions.ts.
export const STRUCTURE_TYPE_OPTIONS = [
  { value: "single_floor", label: "Single floor", sentinels: { structureIsSingle: 1, structureIsG1: 0, structureIsG2: 0 } },
  { value: "g_plus_1",     label: "G + 1",         sentinels: { structureIsSingle: 0, structureIsG1: 1, structureIsG2: 0 } },
  { value: "g_plus_2",     label: "G + 2",         sentinels: { structureIsSingle: 0, structureIsG1: 0, structureIsG2: 1 } },
];
