/** Standard inp.* programme-scale inputs, with the displayGroup that decides
 *  which Cost Analysis section renders them. A key missing from the registry is
 *  silently dropped from the new-budget form (app/(budget)/budget/new/page.tsx),
 *  so every inp.* a template formula references must have a row here. */
export type StandardProgInput = {
  itemKey: string;
  unit: string;
  unitCost: number;
  notes: string;
  displayGroup: string;
};

export const STANDARD_PROG_INPUTS: StandardProgInput[] = [
  { itemKey: "inp.nSettlements",              unit: "count",    unitCost: 10,    notes: "No. of settlements",                    displayGroup: "geography"  },
  { itemKey: "inp.nClusters",                 unit: "count",    unitCost: 3,     notes: "No. of clusters",                       displayGroup: "geography"  },
  { itemKey: "inp.cosPerCluster",             unit: "count",    unitCost: 2,     notes: "COs per cluster",                       displayGroup: "geography"  },
  { itemKey: "inp.cosTotal",                  unit: "count",    unitCost: 0,     notes: "Total COs",                             displayGroup: "geography"  },
  { itemKey: "inp.nCLCs",                     unit: "count",    unitCost: 5,     notes: "No. of CLCs",                           displayGroup: "facilities" },
  { itemKey: "inp.clcRentPerMonth",           unit: "₹/month",  unitCost: 15000, notes: "CLC rent / mo",                         displayGroup: "facilities" },
  { itemKey: "inp.nYRCs",                     unit: "count",    unitCost: 2,     notes: "No. of YRCs",                           displayGroup: "facilities" },
  { itemKey: "inp.yrcRentPerMonth",           unit: "₹/month",  unitCost: 10000, notes: "YRC rent / mo",                         displayGroup: "facilities" },
  { itemKey: "inp.nElderlyCentres",           unit: "count",    unitCost: 2,     notes: "No. of elderly centres",                displayGroup: "facilities" },
  { itemKey: "inp.elderlyCentreRentPerMonth", unit: "₹/month",  unitCost: 8000,  notes: "Elderly centre rent / mo",              displayGroup: "facilities" },
  { itemKey: "inp.nCreches",                  unit: "count",    unitCost: 3,     notes: "No. of creches",                        displayGroup: "facilities" },
  { itemKey: "inp.crecheRentPerMonth",        unit: "₹/month",  unitCost: 12000, notes: "Creche rent / mo",                      displayGroup: "facilities" },
  { itemKey: "inp.rcRentPerMonth",            unit: "₹/month",  unitCost: 5000,  notes: "RC rent / mo",                          displayGroup: "facilities" },
  { itemKey: "inp.nElderly",                  unit: "count",    unitCost: 50,    notes: "Elderly enrolled",                      displayGroup: "coverage"   },
  // Food distribution
  { itemKey: "inp.nDPs",                      unit: "count",    unitCost: 50,    notes: "No. of distribution points",            displayGroup: "facilities" },
  { itemKey: "inp.nMealsPerDay",              unit: "count",    unitCost: 10000, notes: "Total daily meals (kitchen capacity)",  displayGroup: "coverage"   },
  { itemKey: "inp.nOperatingDaysPerYear",     unit: "days",     unitCost: 300,   notes: "Operating days/year (25 × 12)",         displayGroup: "coverage"   },
  { itemKey: "inp.nTrucks",                   unit: "count",    unitCost: 17,    notes: "No. of trucks",                         displayGroup: "facilities" },
  { itemKey: "inp.kitchenRentPerMonth",       unit: "₹/month",  unitCost: 150000, notes: "Kitchen + warehouse rent / mo",        displayGroup: "facilities" },
  // RO Water + Sanitation Complex (standalone domains)
  { itemKey: "inp.nRO_Plants",                unit: "count",    unitCost: 1,     notes: "No. of RO water plants",                displayGroup: "facilities" },
  { itemKey: "inp.roPlantRentPerMonth",       unit: "₹/month",  unitCost: 0,     notes: "RO plant site rent / mo",               displayGroup: "facilities" },
  // RO_Water — capacity mix (drives parametric formulas)
  { itemKey: "inp.roTankLitres",              unit: "L",        unitCost: 4000,  notes: "Storage tanks (raw + product) per plant", displayGroup: "capacity" },
  { itemKey: "inp.roSolarKwp",                unit: "kWp",      unitCost: 2.5,   notes: "Solar PV backup per plant",             displayGroup: "capacity"   },
  { itemKey: "inp.hasBorewell",               unit: "0/1",      unitCost: 1,     notes: "1 = includes borewell + source connection; 0 = municipal supply only", displayGroup: "facilities" },
  { itemKey: "inp.nSanitationComplexes",      unit: "count",    unitCost: 1,     notes: "No. of sanitation complexes",           displayGroup: "facilities" },
  { itemKey: "inp.sanitationComplexRentPerMonth", unit: "₹/month", unitCost: 0,  notes: "Sanitation complex rent / mo",          displayGroup: "facilities" },
  // Sanitation Complex — capacity mix (drives parametric formulas)
  { itemKey: "inp.wcSeats",                   unit: "seats",    unitCost: 30,    notes: "Total WC seats (M + F + DA) per complex", displayGroup: "capacity"   },
  { itemKey: "inp.bathCubicles",              unit: "cubicles", unitCost: 8,     notes: "Bathing cubicles per complex",            displayGroup: "capacity"   },
  { itemKey: "inp.washingMachines",           unit: "machines", unitCost: 4,     notes: "Washing machines per complex (0 = no laundry)", displayGroup: "capacity" },
  // Referenced by both Sanitation_Complex and RO_Water templates
  { itemKey: "inp.roLph",                     unit: "L/hour",   unitCost: 1000,  notes: "RO plant capacity (0 = no drinking water)", displayGroup: "capacity" },
  { itemKey: "inp.stpKld",                    unit: "KL/day",   unitCost: 12,    notes: "Greywater treatment capacity (0 = no STP)", displayGroup: "capacity" },
  { itemKey: "inp.solarKwp",                  unit: "kWp",      unitCost: 5,     notes: "Solar PV capacity per complex",           displayGroup: "capacity"   },
  { itemKey: "inp.tankStorageLitres",         unit: "L",        unitCost: 33000, notes: "Water storage (UG + OH) per complex",     displayGroup: "capacity"   },
  { itemKey: "inp.areaSqmOverride",           unit: "sqm",      unitCost: 0,     notes: "Built-up area override (0 = auto-derive from fixtures)", displayGroup: "facilities" },
  // Structure type is enum, expanded to 3 sentinel numerics (exactly one is 1)
  { itemKey: "inp.structureIsSingle",         unit: "0/1",      unitCost: 0,     notes: "Structure = single-floor (sentinel; set via structureType picker)", displayGroup: "facilities" },
  { itemKey: "inp.structureIsG1",             unit: "0/1",      unitCost: 0,     notes: "Structure = G+1 (sentinel)",              displayGroup: "facilities" },
  { itemKey: "inp.structureIsG2",             unit: "0/1",      unitCost: 1,     notes: "Structure = G+2 (sentinel; default)",     displayGroup: "facilities" },
  // After-School Centre (standalone)
  { itemKey: "inp.nAfterSchoolCentres",       unit: "count",    unitCost: 1,     notes: "No. of after-school centres",           displayGroup: "facilities" },
  { itemKey: "inp.targetChildrenPerDay",      unit: "count",    unitCost: 300,   notes: "Children per day (drives food-cost line)", displayGroup: "coverage" },
  { itemKey: "inp.ascCentreRentPerMonth",     unit: "₹/month",  unitCost: 0,     notes: "After-school centre site rent (usually 0 — dept-owned)", displayGroup: "facilities" },
];
