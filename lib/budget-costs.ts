// Canonical cost registry defaults — seeded into DB, editable via admin page.
// itemKey format: "domain.parameter" (domain lowercase)

import { SANITATION_RATES, SANITATION_COMPUTED_KEYS } from "@/lib/sanitation/rates";
import { RO_WATER_RATES, RO_WATER_COMPUTED_KEYS } from "@/lib/ro-water/rates";

export type CostItem = {
  domain: string | null;
  itemKey: string;
  unitCost: number;
  unit: string;
  notes?: string;
};

// Computed registry keys evaluated by lib/budget-generator.ts at generation
// time — every LineTemplate.formula that uses `<domain>.*_derived` reads its
// value from here. All domains merged into one list; unused domains just
// evaluate against default inp.* = 0 and produce 0s (harmless).
export type ComputedRegistryKey = { key: string; formula: string };

export const ALL_COMPUTED_REGISTRY_KEYS: ComputedRegistryKey[] = [
  ...SANITATION_COMPUTED_KEYS,
  ...RO_WATER_COMPUTED_KEYS,
];

export const DEFAULT_COSTS: CostItem[] = [
  // ── Children ────────────────────────────────────────────────────────────────
  { domain: "Children", itemKey: "children.snack_per_child_per_day",       unitCost: 12,     unit: "₹/child/day",         notes: "Breakfast or evening snack at CLC" },
  { domain: "Children", itemKey: "children.snack_days_per_year",           unitCost: 180,    unit: "days",                notes: "Working days CLC operates" },
  { domain: "Children", itemKey: "children.children_per_clc",              unitCost: 100,    unit: "children",            notes: "Enrolment per CLC" },
  { domain: "Children", itemKey: "children.leisure_material_per_day",      unitCost: 12,     unit: "₹/child/day",         notes: "Art & craft materials per child" },
  { domain: "Children", itemKey: "children.leisure_days_per_year",         unitCost: 26,     unit: "days" },
  { domain: "Children", itemKey: "children.parent_session_per_person",     unitCost: 90,     unit: "₹/person/session",    notes: "Refreshment at parent meetings" },
  { domain: "Children", itemKey: "children.parent_sessions_per_year",      unitCost: 4,      unit: "sessions" },
  { domain: "Children", itemKey: "children.parents_per_centre",            unitCost: 200,    unit: "parents" },
  { domain: "Children", itemKey: "children.social_awareness_per_event",    unitCost: 5000,   unit: "₹/event" },
  { domain: "Children", itemKey: "children.social_awareness_events",       unitCost: 6,      unit: "events/year/CLC" },
  { domain: "Children", itemKey: "children.exposure_visit_per_child",      unitCost: 500,    unit: "₹/child",             notes: "Travel + food + entry fee" },
  { domain: "Children", itemKey: "children.exposure_children",             unitCost: 100,    unit: "children" },
  { domain: "Children", itemKey: "children.camp_cost",                     unitCost: 37500,  unit: "₹/camp",              notes: "Food + resource person + materials for 5 days" },
  { domain: "Children", itemKey: "children.camps_per_year",                unitCost: 2,      unit: "camps/year" },
  { domain: "Children", itemKey: "children.leadership_training_cost",      unitCost: 37500,  unit: "₹/year/CLC" },
  { domain: "Children", itemKey: "children.education_materials_cost",      unitCost: 40000,  unit: "₹/year/CLC",          notes: "TLM, worksheets, audio-visual" },
  { domain: "Children", itemKey: "children.profiling_external_training",   unitCost: 25000,  unit: "₹/year/CLC" },
  { domain: "Children", itemKey: "children.clc_setup_cost",                unitCost: 25000,  unit: "₹/CLC",               notes: "Painting, civil works (one-time)" },
  { domain: "Children", itemKey: "children.staff_exposure_visit_cost",     unitCost: 40600,  unit: "₹/CLC",               notes: "Staff exposure trip per CLC" },

  // ── Youth ────────────────────────────────────────────────────────────────────
  { domain: "Youth",    itemKey: "youth.small_group_meeting_per_month",    unitCost: 500,    unit: "₹/worker/month",      notes: "Tea & snacks, 10 meetings × 20 youth" },
  { domain: "Youth",    itemKey: "youth.yuva_adda_cost_per_workshop",      unitCost: 9000,   unit: "₹/workshop",          notes: "Resource person + food + venue" },
  { domain: "Youth",    itemKey: "youth.yuva_adda_workshops_per_year",     unitCost: 8,      unit: "workshops/year/YRC" },
  { domain: "Youth",    itemKey: "youth.leadership_training_cost",         unitCost: 18000,  unit: "₹/training" },
  { domain: "Youth",    itemKey: "youth.leadership_trainings_per_year",    unitCost: 2,      unit: "per year" },
  { domain: "Youth",    itemKey: "youth.felicitation_cost",                unitCost: 20000,  unit: "₹/event" },
  { domain: "Youth",    itemKey: "youth.felicitations_per_year",           unitCost: 2,      unit: "per year" },
  { domain: "Youth",    itemKey: "youth.sports_event_cost",                unitCost: 47500,  unit: "₹/event" },
  { domain: "Youth",    itemKey: "youth.sports_events_per_year",           unitCost: 2,      unit: "per year" },
  { domain: "Youth",    itemKey: "youth.youth_festival_cost",              unitCost: 40000,  unit: "₹/year/YRC" },
  { domain: "Youth",    itemKey: "youth.community_exposure_cost",          unitCost: 75000,  unit: "₹/year/YRC" },
  { domain: "Youth",    itemKey: "youth.staff_exposure_visit_cost",        unitCost: 36700,  unit: "₹/YRC" },

  // ── Elderly + Community Kitchen ───────────────────────────────────────────
  { domain: "Elderly",  itemKey: "elderly.nutrition_per_person_per_day",   unitCost: 90,     unit: "₹/person/day",        notes: "Day care meals, 25 days/month" },
  { domain: "Elderly",  itemKey: "elderly.nutrition_days_per_month",       unitCost: 25,     unit: "days" },
  { domain: "Elderly",  itemKey: "elderly.dry_ration_per_person_per_month",unitCost: 450,    unit: "₹/person/month" },
  { domain: "Elderly",  itemKey: "elderly.vegetable_per_person_per_month", unitCost: 400,    unit: "₹/person/month",      notes: "Community kitchen vegetables" },
  { domain: "Elderly",  itemKey: "elderly.gas_refill_cost",                unitCost: 10000,  unit: "₹/refill",            notes: "Bi-monthly refill" },
  { domain: "Elderly",  itemKey: "elderly.gas_refills_per_year",           unitCost: 6,      unit: "refills/year" },
  { domain: "Elderly",  itemKey: "elderly.meeting_refreshment_per_person", unitCost: 100,    unit: "₹/person/meeting" },
  { domain: "Elderly",  itemKey: "elderly.elderly_per_meeting",            unitCost: 30,     unit: "persons" },
  { domain: "Elderly",  itemKey: "elderly.annual_day_cost",                unitCost: 17000,  unit: "₹/event" },
  { domain: "Elderly",  itemKey: "elderly.annual_days_per_year",           unitCost: 2,      unit: "per year" },
  { domain: "Elderly",  itemKey: "elderly.volunteer_honorarium_per_month", unitCost: 3600,   unit: "₹/volunteer/month" },
  { domain: "Elderly",  itemKey: "elderly.volunteers_per_centre",          unitCost: 5,      unit: "volunteers" },
  { domain: "Elderly",  itemKey: "elderly.kitchen_incharge_travel",        unitCost: 3000,   unit: "₹/month" },
  { domain: "Elderly",  itemKey: "elderly.centre_setup_cost",              unitCost: 20000,  unit: "₹/centre",            notes: "Beds, utensils, linen (one-time)" },
  { domain: "Elderly",  itemKey: "elderly.misc_contingency_per_centre",    unitCost: 60000,  unit: "₹/year/centre" },

  // ── Welfare Rights ────────────────────────────────────────────────────────
  { domain: "WelfareRights", itemKey: "wr.slum_meeting_refreshment",       unitCost: 15,     unit: "₹/person/meeting" },
  { domain: "WelfareRights", itemKey: "wr.slum_meeting_participants",      unitCost: 20,     unit: "persons" },
  { domain: "WelfareRights", itemKey: "wr.cluster_meeting_refreshment",    unitCost: 60,     unit: "₹/person/meeting" },
  { domain: "WelfareRights", itemKey: "wr.cluster_meeting_participants",   unitCost: 30,     unit: "persons" },
  { domain: "WelfareRights", itemKey: "wr.city_training_cost",             unitCost: 19000,  unit: "₹/year" },
  { domain: "WelfareRights", itemKey: "wr.city_meeting_cost",              unitCost: 16000,  unit: "₹/year" },
  { domain: "WelfareRights", itemKey: "wr.community_exposure_per_leader",  unitCost: 500,    unit: "₹/leader" },
  { domain: "WelfareRights", itemKey: "wr.leaders_per_cluster",            unitCost: 50,     unit: "leaders" },
  { domain: "WelfareRights", itemKey: "wr.entitlement_camp_per_settlement",unitCost: 240,    unit: "₹/settlement" },
  { domain: "WelfareRights", itemKey: "wr.consultation_cost",              unitCost: 20000,  unit: "₹/year" },
  { domain: "WelfareRights", itemKey: "wr.governance_cost_per_cluster",    unitCost: 3000,   unit: "₹/cluster" },

  // ── Creche ────────────────────────────────────────────────────────────────
  { domain: "Creche",   itemKey: "creche.worker_honorarium_per_month",     unitCost: 12000,  unit: "₹/worker/month" },
  { domain: "Creche",   itemKey: "creche.workers_per_creche",              unitCost: 2,      unit: "workers" },
  { domain: "Creche",   itemKey: "creche.maternity_buffer_pct",            unitCost: 10,     unit: "%",                   notes: "Extra % added to honorarium for maternity" },
  { domain: "Creche",   itemKey: "creche.children_per_creche",             unitCost: 20,     unit: "children" },
  // Urban Creche V.2 (May-25) standard. Recurring op-cost refresh; feeding folds
  // in Special Nutrition Care; training split from review meetings (new key).
  { domain: "Creche",   itemKey: "creche.feeding_cost_per_child_per_year", unitCost: 109264, unit: "₹/creche/year",       notes: "Breakfast + lunch + evening snack + special nutrition care (per creche of 20)" },
  { domain: "Creche",   itemKey: "creche.egg_cost_per_year",               unitCost: 43680,  unit: "₹/creche/year",       notes: "6 eggs/week × ₹7 × 20 children" },
  { domain: "Creche",   itemKey: "creche.gas_cost_per_year",               unitCost: 21000,  unit: "₹/creche/year",       notes: "₹1,750/month" },
  { domain: "Creche",   itemKey: "creche.hygiene_cost_per_year",           unitCost: 19990,  unit: "₹/creche/year",       notes: "Soap, detergent, mops, stationery, sanitary pads, toilet & first-aid set" },
  { domain: "Creche",   itemKey: "creche.food_transport_per_year",         unitCost: 12000,  unit: "₹/creche/year",       notes: "₹1,000/month" },
  { domain: "Creche",   itemKey: "creche.play_materials_per_year",         unitCost: 14690,  unit: "₹/creche/year" },
  { domain: "Creche",   itemKey: "creche.flexi_fund_per_year",             unitCost: 4656,   unit: "₹/creche/year" },
  { domain: "Creche",   itemKey: "creche.training_cost_per_year",          unitCost: 115080, unit: "₹/creche/year",       notes: "Training of creche workers (initial + refresher)" },
  { domain: "Creche",   itemKey: "creche.review_meeting_per_year",         unitCost: 7200,   unit: "₹/creche/year",       notes: "Monthly review meeting of creche workers (split from training in V.2)" },
  { domain: "Creche",   itemKey: "creche.caregiver_food_per_year",         unitCost: 15600,  unit: "₹/creche/year",       notes: "₹1,300/month × 2 caregivers" },
  { domain: "Creche",   itemKey: "creche.setup_cost",                      unitCost: 254000, unit: "₹/creche",            notes: "Anthropometric + galvanised + utensils + water/handwash + linen + safety (one-time, V.2)" },
  { domain: "Creche",   itemKey: "creche.supervisor_salary_per_month",     unitCost: 25000,  unit: "₹/month" },
  { domain: "Creche",   itemKey: "creche.coordinator_salary_per_month",    unitCost: 35000,  unit: "₹/month" },
  { domain: "Creche",   itemKey: "creche.supervisor_per_n_creches",        unitCost: 10,     unit: "creches per supervisor" },
  { domain: "Creche",   itemKey: "creche.coordinator_per_n_creches",       unitCost: 40,     unit: "creches per coordinator" },
  { domain: "Creche",   itemKey: "creche.supervisor_travel_per_month",     unitCost: 4400,   unit: "₹/supervisor/month",  notes: "Travel + phone/internet (V.2)" },
  { domain: "Creche",   itemKey: "creche.coordinator_travel_per_month",    unitCost: 6400,   unit: "₹/coordinator/month", notes: "Travel + phone/internet (V.2)" },
  // V.2 supervisory & support roles. Ratios follow the cost-book remarks; ceil()
  // means a 40-creche cluster carries one of each cluster-level role and one head
  // (ceil of the 1/200 share) of each central role — matching the V.2 standard.
  // inputThreshold is left null: an admin can set it per role to suppress the
  // line for sub-scale pilots.
  { domain: "Creche",   itemKey: "creche.logistics_salary_per_month",      unitCost: 30000,  unit: "₹/month" },
  { domain: "Creche",   itemKey: "creche.logistics_per_n_creches",         unitCost: 200,    unit: "creches per logistics coordinator" },
  { domain: "Creche",   itemKey: "creche.logistics_travel_per_month",      unitCost: 4400,   unit: "₹/month",             notes: "Travel + phone/internet" },
  { domain: "Creche",   itemKey: "creche.training_coord_salary_per_month", unitCost: 50000,  unit: "₹/month" },
  { domain: "Creche",   itemKey: "creche.training_coord_per_n_creches",    unitCost: 200,    unit: "creches per training coordinator" },
  { domain: "Creche",   itemKey: "creche.training_coord_travel_per_month", unitCost: 7900,   unit: "₹/month",             notes: "Travel + phone/internet" },
  { domain: "Creche",   itemKey: "creche.safety_salary_per_month",         unitCost: 30000,  unit: "₹/month" },
  { domain: "Creche",   itemKey: "creche.safety_per_n_creches",            unitCost: 200,    unit: "creches per safety coordinator" },
  { domain: "Creche",   itemKey: "creche.safety_travel_per_month",         unitCost: 7900,   unit: "₹/month",             notes: "Travel + phone/internet" },
  { domain: "Creche",   itemKey: "creche.pm_salary_per_month",             unitCost: 40000,  unit: "₹/month" },
  { domain: "Creche",   itemKey: "creche.pm_per_n_creches",                unitCost: 40,     unit: "creches per programme manager" },
  { domain: "Creche",   itemKey: "creche.pm_travel_per_month",             unitCost: 10400,  unit: "₹/month",             notes: "Travel + phone/internet" },
  { domain: "Creche",   itemKey: "creche.mis_salary_per_month",            unitCost: 35000,  unit: "₹/month" },
  { domain: "Creche",   itemKey: "creche.mis_per_n_creches",               unitCost: 40,     unit: "creches per MIS coordinator" },
  { domain: "Creche",   itemKey: "creche.mis_travel_per_month",            unitCost: 7900,   unit: "₹/month",             notes: "Travel + phone/internet" },
  { domain: "Creche",   itemKey: "creche.insurance_per_creche_per_year",   unitCost: 875,    unit: "₹/creche/year",       notes: "Staff insurance ₹3,500/yr × supervisory team (₹35k for a 40-cluster = ₹875/creche at standard scale)" },
  { domain: "Creche",   itemKey: "creche.accounts_manager_salary_per_month", unitCost: 0,    unit: "₹/month",             notes: "Accounts & Logistics Manager (Chennai only)" },
  { domain: "Creche",   itemKey: "creche.accounts_manager_travel_per_month", unitCost: 0,    unit: "₹/month",             notes: "A&L Manager travel (Chennai only)" },

  // ── Youth (additional) ────────────────────────────────────────────────────
  { domain: "Youth",    itemKey: "youth.social_actions_per_yrc",           unitCost: 3000,   unit: "₹/YRC/year",          notes: "Youth-led social actions" },
  { domain: "Youth",    itemKey: "youth.stationery_per_yrc",               unitCost: 1500,   unit: "₹/YRC/year",          notes: "Stationery, IEC, photocopy & printing" },

  // ── Welfare Rights (additional) ───────────────────────────────────────────
  { domain: "WelfareRights", itemKey: "wr.dept_interaction_per_cluster",   unitCost: 3000,   unit: "₹/cluster/year",      notes: "Travel for interaction with departments" },
  { domain: "WelfareRights", itemKey: "wr.special_occasions_cost",         unitCost: 10000,  unit: "₹/year",              notes: "Observation of special occasions" },
  { domain: "WelfareRights", itemKey: "wr.civic_baseline_cost",            unitCost: 50000,  unit: "₹/year",              notes: "Civic community baseline survey" },

  // ── Food Distribution ─────────────────────────────────────────────────────
  // Food ingredient (veg-only menu, per Automated Food Calculator)
  { domain: "FoodDistribution", itemKey: "food.cost_per_meal",                       unitCost: 21.91,  unit: "₹/meal",              notes: "Veg menu weekly avg (₹153.36 ÷ 7 days)" },

  // Programme coordination salaries (food-specific, programme-side)
  { domain: "FoodDistribution", itemKey: "food.programme_coordinator_salary",        unitCost: 65000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.procurement_coordinator_salary",      unitCost: 50000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.delivery_coordinator_salary",         unitCost: 30000,  unit: "₹/month" },

  // Kitchen staff salaries (per role, monthly)
  { domain: "FoodDistribution", itemKey: "food.kitchen_manager_salary",              unitCost: 55000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.warehouse_manager_salary",            unitCost: 40000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.cook_salary",                         unitCost: 50000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.helper_cook_salary",                  unitCost: 25000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.kitchen_loader_salary",               unitCost: 25000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.chopping_cleaning_salary",            unitCost: 20000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.food_loader_salary",                  unitCost: 18000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.housekeeping_salary",                 unitCost: 15000,  unit: "₹/month" },

  // Kitchen staffing ratios — meals/day per staff member (supervisorRatioKey: ceil(meals/ratio) × 12 staff-months)
  { domain: "FoodDistribution", itemKey: "food.meals_per_kitchen_manager",           unitCost: 10000,  unit: "meals/day per staff", notes: "1 Kitchen Manager per 10K meals/day" },
  { domain: "FoodDistribution", itemKey: "food.meals_per_warehouse_manager",         unitCost: 10000,  unit: "meals/day per staff", notes: "1 Warehouse Manager per 10K meals/day" },
  { domain: "FoodDistribution", itemKey: "food.meals_per_cook",                      unitCost: 1667,   unit: "meals/day per staff", notes: "6 Cooks per 10K meals/day" },
  { domain: "FoodDistribution", itemKey: "food.meals_per_helper_cook",               unitCost: 1112,   unit: "meals/day per staff", notes: "9 Helper Cooks per 10K meals/day" },
  { domain: "FoodDistribution", itemKey: "food.meals_per_kitchen_loader",            unitCost: 1667,   unit: "meals/day per staff", notes: "6 Loaders per 10K meals/day" },
  { domain: "FoodDistribution", itemKey: "food.meals_per_chopping_cleaning",         unitCost: 667,    unit: "meals/day per staff", notes: "15 Chopping & Cleaning per 10K meals/day" },
  { domain: "FoodDistribution", itemKey: "food.meals_per_food_loader",               unitCost: 667,    unit: "meals/day per staff", notes: "15 Food Loaders per 10K meals/day" },
  { domain: "FoodDistribution", itemKey: "food.meals_per_housekeeping",              unitCost: 667,    unit: "meals/day per staff", notes: "15 Housekeeping per 10K meals/day" },

  // DP staff
  { domain: "FoodDistribution", itemKey: "food.dp_staff_per_dp",                     unitCost: 2,      unit: "staff per DP" },
  { domain: "FoodDistribution", itemKey: "food.dp_staff_remuneration_per_month",     unitCost: 6000,   unit: "₹/staff/month" },

  // Kitchen infrastructure (monthly fixed, regardless of operating days)
  { domain: "FoodDistribution", itemKey: "food.electricity_per_month",               unitCost: 75000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.water_bill_per_month",                unitCost: 40000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.cleaning_per_month",                  unitCost: 60000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.gas_per_month",                       unitCost: 85000,  unit: "₹/month" },
  { domain: "FoodDistribution", itemKey: "food.maintenance_per_month",               unitCost: 50000,  unit: "₹/month" },

  // Transport (from Sampark budget basis)
  { domain: "FoodDistribution", itemKey: "food.truck_cost_per_month",                unitCost: 53100,  unit: "₹/truck/month",       notes: "Driver + fuel + maintenance + rental, all-in" },

  // DP consumables (from Sampark budget)
  { domain: "FoodDistribution", itemKey: "food.paper_plate_cost",                    unitCost: 1.30,   unit: "₹/plate" },
  { domain: "FoodDistribution", itemKey: "food.dustbin_cover_cost",                  unitCost: 10,     unit: "₹/cover" },
  { domain: "FoodDistribution", itemKey: "food.dustbin_covers_per_dp_per_month",     unitCost: 50,     unit: "covers/DP/month" },
  { domain: "FoodDistribution", itemKey: "food.gloves_cost",                         unitCost: 5,      unit: "₹/pair" },
  { domain: "FoodDistribution", itemKey: "food.gloves_per_dp_per_month",             unitCost: 100,    unit: "pairs/DP/month" },
  { domain: "FoodDistribution", itemKey: "food.head_cap_cost",                       unitCost: 2,      unit: "₹/cap" },
  { domain: "FoodDistribution", itemKey: "food.head_caps_per_dp_per_month",          unitCost: 50,     unit: "caps/DP/month" },
  { domain: "FoodDistribution", itemKey: "food.drinking_water_can_cost",             unitCost: 30,     unit: "₹/can" },
  { domain: "FoodDistribution", itemKey: "food.drinking_water_cans_per_dp_per_month",unitCost: 50,     unit: "cans/DP/month" },
  { domain: "FoodDistribution", itemKey: "food.apron_cost",                          unitCost: 500,    unit: "₹/apron" },
  { domain: "FoodDistribution", itemKey: "food.aprons_per_dp_per_year",              unitCost: 2,      unit: "aprons/DP/year" },
  { domain: "FoodDistribution", itemKey: "food.misc_per_dp_per_month",               unitCost: 2000,   unit: "₹/DP/month",          notes: "Miscellaneous DP supplies" },

  // Capex (one-time)
  { domain: "FoodDistribution", itemKey: "food.foldable_table_per_dp",               unitCost: 6000,   unit: "₹/DP" },
  { domain: "FoodDistribution", itemKey: "food.canopy_tent_per_dp",                  unitCost: 8000,   unit: "₹/DP" },
  { domain: "FoodDistribution", itemKey: "food.standee_umbrella_per_dp",             unitCost: 2000,   unit: "₹/DP" },
  { domain: "FoodDistribution", itemKey: "food.water_container_cost",                unitCost: 250,    unit: "₹/container" },
  { domain: "FoodDistribution", itemKey: "food.water_containers_per_dp",             unitCost: 2,      unit: "containers/DP" },
  { domain: "FoodDistribution", itemKey: "food.serving_kit_per_kitchen",             unitCost: 85000,  unit: "₹/kitchen",           notes: "Casseroles + vessels + spoons + chimta (lump from Sampark)" },
  { domain: "FoodDistribution", itemKey: "food.kitchen_equipment_one_time",          unitCost: 0,      unit: "₹/kitchen",           notes: "Set to ₹75.39L for in-house kitchen; 0 for vendor-procured" },

  // ── RO Water Plant (standalone budget domain; figures ≈ RO-water model @1000 LPH) ──
  // ── RO_Water — LEGACY aggregate capex (deprecated 2026-07-27) ──
  // Kept so historical budgets that still reference these keys resolve. New
  // RO budgets use the parametric per-unit rates below (RO_WATER_RATES) driven
  // by LineTemplate.formula.
  { domain: "RO_Water", itemKey: "ro.capex_ro_plant",         unitCost: 600000, unit: "₹/plant",       notes: "DEPRECATED — use ro.plant_per_lph × LPH" },
  { domain: "RO_Water", itemKey: "ro.capex_atm",              unitCost: 150000, unit: "₹/plant",       notes: "DEPRECATED — use ro.atm_fixed" },
  { domain: "RO_Water", itemKey: "ro.capex_tanks",            unitCost: 80000,  unit: "₹/plant",       notes: "DEPRECATED — use ro.tanks_per_litre × litres" },
  { domain: "RO_Water", itemKey: "ro.capex_civil",            unitCost: 200000, unit: "₹/plant",       notes: "DEPRECATED — use ro.civil_fixed" },
  { domain: "RO_Water", itemKey: "ro.capex_plumbing",         unitCost: 100000, unit: "₹/plant",       notes: "DEPRECATED — use ro.plumbing_fixed" },
  { domain: "RO_Water", itemKey: "ro.capex_borewell",         unitCost: 75000,  unit: "₹/plant",       notes: "DEPRECATED — gate ro.borewell_fixed on inp.hasBorewell" },
  { domain: "RO_Water", itemKey: "ro.capex_solar",            unitCost: 200000, unit: "₹/plant",       notes: "DEPRECATED — use ro.solar_per_kwp × kWp" },
  { domain: "RO_Water", itemKey: "ro.capex_iot",              unitCost: 50000,  unit: "₹/plant",       notes: "DEPRECATED — use ro.iot_fixed" },
  { domain: "RO_Water", itemKey: "ro.capex_surveys",          unitCost: 50000,  unit: "₹/plant",       notes: "DEPRECATED — use ro.surveys_fixed" },
  { domain: "RO_Water", itemKey: "ro.capex_contingency",      unitCost: 150500, unit: "₹/plant",       notes: "DEPRECATED — now derived: ro.contingency_pct_of_subtotal" },

  // ── RO_Water — parametric per-unit rates (from lib/ro-water/rates.ts) ──
  ...RO_WATER_RATES.map(r => ({
    domain: "RO_Water" as string | null,
    itemKey: r.key,
    unitCost: r.standardUnitCost,
    unit: r.costUnit,
    notes: r.notes,
  })),
  { domain: "RO_Water", itemKey: "ro.salary_operator",        unitCost: 12000,  unit: "₹/month" },
  { domain: "RO_Water", itemKey: "ro.operators_per_plant",    unitCost: 1,      unit: "operators" },
  { domain: "RO_Water", itemKey: "ro.salary_assistant",       unitCost: 5000,   unit: "₹/month" },
  { domain: "RO_Water", itemKey: "ro.assistants_per_plant",   unitCost: 1,      unit: "assistants" },
  { domain: "RO_Water", itemKey: "ro.electricity_per_month",  unitCost: 11778,  unit: "₹/plant/month", notes: "At ~206k L/mo steady demand" },
  { domain: "RO_Water", itemKey: "ro.source_water_per_month", unitCost: 11271,  unit: "₹/plant/month" },
  { domain: "RO_Water", itemKey: "ro.membrane_per_month",     unitCost: 2500,   unit: "₹/plant/month", notes: "₹30k/yr ÷ 12" },
  { domain: "RO_Water", itemKey: "ro.prefilter_per_month",    unitCost: 1000,   unit: "₹/plant/month" },
  { domain: "RO_Water", itemKey: "ro.uv_per_month",           unitCost: 500,    unit: "₹/plant/month" },
  { domain: "RO_Water", itemKey: "ro.amc_per_month",          unitCost: 1500,   unit: "₹/plant/month" },
  { domain: "RO_Water", itemKey: "ro.tech_per_month",         unitCost: 2000,   unit: "₹/plant/month" },
  { domain: "RO_Water", itemKey: "ro.mobile_per_month",       unitCost: 500,    unit: "₹/plant/month" },
  { domain: "RO_Water", itemKey: "ro.cleaning_per_month",     unitCost: 800,    unit: "₹/plant/month" },
  { domain: "RO_Water", itemKey: "ro.lab_per_month",          unitCost: 1333,   unit: "₹/plant/month", notes: "₹4k/quarter ÷ 3" },

  // ── Sanitation Complex — LEGACY aggregate capex (deprecated 2026-07-27) ──
  // Kept so historical budgets that still reference these keys resolve. New
  // sanitation budgets use the parametric per-unit rates below (SANITATION_RATES
  // from lib/sanitation/rates.ts) driven by LineTemplate.formula.
  { domain: "Sanitation_Complex", itemKey: "san.capex_civil",             unitCost: 5800000, unit: "₹/complex", notes: "DEPRECATED — use san.civil_per_sqm_g2 × area" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_plumbing",          unitCost: 1150000, unit: "₹/complex", notes: "DEPRECATED — use san.plumbing_per_wc_seat etc." },
  { domain: "Sanitation_Complex", itemKey: "san.capex_washing_machines",  unitCost: 480000,  unit: "₹/complex", notes: "DEPRECATED — use san.capex_per_washing_machine × count" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_ro",                unitCost: 650000,  unit: "₹/complex", notes: "DEPRECATED — use san.capex_per_ro_lph × LPH" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_stp",               unitCost: 1350000, unit: "₹/complex", notes: "DEPRECATED — use san.capex_stp_per_kld × KLD" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_biodigester",       unitCost: 580000,  unit: "₹/complex", notes: "DEPRECATED — use san.capex_biodigester_per_seat × seats" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_tanks",             unitCost: 390000,  unit: "₹/complex", notes: "DEPRECATED — use san.tanks_per_litre × storage" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_solar",             unitCost: 450000,  unit: "₹/complex", notes: "DEPRECATED — use san.solar_per_kwp × kWp" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_electrical",        unitCost: 520000,  unit: "₹/complex", notes: "DEPRECATED — use san.electrical_per_sqm_g2 × area" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_iot",               unitCost: 180000,  unit: "₹/complex", notes: "DEPRECATED — use san.iot_per_wc_seat etc." },
  { domain: "Sanitation_Complex", itemKey: "san.capex_approval",          unitCost: 173000,  unit: "₹/complex", notes: "DEPRECATED — use san.approval_fixed + per_seat" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_design",            unitCost: 650000,  unit: "₹/complex", notes: "DEPRECATED — now derived: san.design_pct_of_hardware" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_signage",           unitCost: 150000,  unit: "₹/complex", notes: "DEPRECATED — use san.signage_per_fixture" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_contingency",       unitCost: 1252300, unit: "₹/complex", notes: "DEPRECATED — now derived: san.contingency_pct_of_subtotal" },
  { domain: "Sanitation_Complex", itemKey: "san.capex_tax",               unitCost: 626150,  unit: "₹/complex", notes: "DEPRECATED — now derived: san.tax_pct_of_subtotal" },

  // ── Sanitation Complex — parametric per-unit rates (from lib/sanitation/rates.ts) ──
  ...SANITATION_RATES.map(r => ({
    domain: "Sanitation_Complex" as string | null,
    itemKey: r.key,
    unitCost: r.standardUnitCost,
    unit: r.costUnit,
    notes: r.notes,
  })),
  { domain: "Sanitation_Complex", itemKey: "san.salary_caretaker",        unitCost: 12000,   unit: "₹/month" },
  { domain: "Sanitation_Complex", itemKey: "san.caretakers_per_complex",  unitCost: 3,       unit: "caretakers" },
  { domain: "Sanitation_Complex", itemKey: "san.salary_plant_operator",   unitCost: 10000,   unit: "₹/month" },
  { domain: "Sanitation_Complex", itemKey: "san.plant_operators_per_complex", unitCost: 1,   unit: "operators" },
  { domain: "Sanitation_Complex", itemKey: "san.salary_laundry_sup",      unitCost: 8000,    unit: "₹/month" },
  { domain: "Sanitation_Complex", itemKey: "san.laundry_sups_per_complex", unitCost: 1,      unit: "supervisors" },
  { domain: "Sanitation_Complex", itemKey: "san.salary_security",         unitCost: 10000,   unit: "₹/month" },
  { domain: "Sanitation_Complex", itemKey: "san.security_per_complex",    unitCost: 2,       unit: "guards" },
  { domain: "Sanitation_Complex", itemKey: "san.salary_admin_cashier",    unitCost: 12000,   unit: "₹/month" },
  { domain: "Sanitation_Complex", itemKey: "san.admin_per_complex",       unitCost: 1,       unit: "staff" },
  { domain: "Sanitation_Complex", itemKey: "san.electricity_per_month",   unitCost: 104142,  unit: "₹/complex/month", notes: "Net of solar, at default usage" },
  { domain: "Sanitation_Complex", itemKey: "san.water_per_month",         unitCost: 58025,   unit: "₹/complex/month", notes: "BWSSB net of greywater recycling" },
  { domain: "Sanitation_Complex", itemKey: "san.cleaning_per_month",      unitCost: 8064,    unit: "₹/complex/month" },
  { domain: "Sanitation_Complex", itemKey: "san.detergent_per_month",     unitCost: 4032,    unit: "₹/complex/month" },
  { domain: "Sanitation_Complex", itemKey: "san.ro_consumables_per_month", unitCost: 4536,   unit: "₹/complex/month" },
  { domain: "Sanitation_Complex", itemKey: "san.stp_consumables_per_month", unitCost: 5500,  unit: "₹/complex/month" },
  { domain: "Sanitation_Complex", itemKey: "san.desludging_per_month",    unitCost: 1512,    unit: "₹/complex/month" },
  { domain: "Sanitation_Complex", itemKey: "san.amc_per_month",           unitCost: 3000,    unit: "₹/complex/month" },
  { domain: "Sanitation_Complex", itemKey: "san.tech_per_month",          unitCost: 2500,    unit: "₹/complex/month" },
  { domain: "Sanitation_Complex", itemKey: "san.lab_per_month",           unitCost: 1667,    unit: "₹/complex/month", notes: "₹5k/quarter ÷ 3" },

  // ── After-School Centre (standalone; annexure, per centre, Y1 = ₹195.79 L) ──
  // Salaries — per person, monthly
  { domain: "AfterSchoolCentre", itemKey: "asc.school_coordinator_salary",   unitCost: 65000,  unit: "₹/month" },
  { domain: "AfterSchoolCentre", itemKey: "asc.librarian_salary",            unitCost: 35000,  unit: "₹/month" },
  { domain: "AfterSchoolCentre", itemKey: "asc.art_coord_salary",            unitCost: 35000,  unit: "₹/month" },
  { domain: "AfterSchoolCentre", itemKey: "asc.sports_coord_salary",         unitCost: 35000,  unit: "₹/month" },
  { domain: "AfterSchoolCentre", itemKey: "asc.science_instructor_salary",   unitCost: 35000,  unit: "₹/month" },
  { domain: "AfterSchoolCentre", itemKey: "asc.computer_instructor_salary",  unitCost: 35000,  unit: "₹/month" },
  { domain: "AfterSchoolCentre", itemKey: "asc.security_salary",             unitCost: 25000,  unit: "₹/month" },
  { domain: "AfterSchoolCentre", itemKey: "asc.security_per_centre",         unitCost: 6,      unit: "guards",   notes: "6 guards × 3 shifts (annexure)" },
  { domain: "AfterSchoolCentre", itemKey: "asc.facility_mgmt_salary",        unitCost: 25000,  unit: "₹/month" },
  { domain: "AfterSchoolCentre", itemKey: "asc.facility_mgmt_per_centre",    unitCost: 8,      unit: "staff",    notes: "8 housekeeping (annexure)" },
  { domain: "AfterSchoolCentre", itemKey: "asc.outreach_salary",             unitCost: 16500,  unit: "₹/month" },
  { domain: "AfterSchoolCentre", itemKey: "asc.outreach_per_centre",         unitCost: 2,      unit: "workers",  notes: "1 per 150–200 children (annexure)" },
  // Travel
  { domain: "AfterSchoolCentre", itemKey: "asc.coord_local_travel",          unitCost: 3000,   unit: "₹/month",  notes: "Local travel — school coordinator" },
  // Capex — per centre one-time
  { domain: "AfterSchoolCentre", itemKey: "asc.capex_design",                unitCost: 500000,  unit: "₹/centre", notes: "Design (architecture fees)" },
  { domain: "AfterSchoolCentre", itemKey: "asc.capex_refurbishment",         unitCost: 5000000, unit: "₹/centre", notes: "Refurbishment / civil works" },
  { domain: "AfterSchoolCentre", itemKey: "asc.capex_creche_conversion",     unitCost: 200000,  unit: "₹/centre", notes: "Crèche classroom conversion" },
  { domain: "AfterSchoolCentre", itemKey: "asc.capex_activity_resources",    unitCost: 2000000, unit: "₹/centre", notes: "Computers, sports, other" },
  { domain: "AfterSchoolCentre", itemKey: "asc.capex_learning_materials",    unitCost: 1000000, unit: "₹/centre", notes: "Books, kits, art & other" },
  // Programme
  { domain: "AfterSchoolCentre", itemKey: "asc.creche_ops_annual",           unitCost: 858335,  unit: "₹/centre/year",  notes: "Urban Crèche V.2 standard" },
  { domain: "AfterSchoolCentre", itemKey: "asc.activity_resources_per_month", unitCost: 57913,  unit: "₹/centre/month", notes: "Recurring; incl. child profiling + staff training" },
  { domain: "AfterSchoolCentre", itemKey: "asc.utilities_per_month",         unitCost: 41667,   unit: "₹/centre/month", notes: "Cleaning, consumables" },
  { domain: "AfterSchoolCentre", itemKey: "asc.food_per_child_per_day",      unitCost: 12,      unit: "₹/child/day",    notes: "Snacks — scales with targetChildrenPerDay" },
  { domain: "AfterSchoolCentre", itemKey: "asc.food_days_per_year",          unitCost: 365,     unit: "days" },

  // ── Cross-cutting ─────────────────────────────────────────────────────────
  { domain: null,       itemKey: "cross.staff_capacity_building",          unitCost: 14480,  unit: "₹/year" },
  { domain: null,       itemKey: "cross.team_building_offsite",            unitCost: 204600, unit: "₹/year",              notes: "3-day offsite" },
  { domain: null,       itemKey: "cross.planning_review_meetings",         unitCost: 5400,   unit: "₹/year" },
  { domain: null,       itemKey: "cross.crisis_intervention",              unitCost: 2500,   unit: "₹/year" },
];

// ── Chennai defaults ──────────────────────────────────────────────────────────
// Sourced from the standardised Chennai R-2604/R-2510 template (Arunodhaya,
// TNDWWT, DBAI, DBSSS, Thozhamai all use identical programme costs).
// Only items that differ from Bangalore are listed here; lookupCost falls back
// to DEFAULT_COSTS (Bangalore) for anything not overridden.
export const DEFAULT_COSTS_CHENNAI: CostItem[] = [

  // ── Welfare Rights ────────────────────────────────────────────────────────
  // Chennai community meeting = ₹375 all-in per settlement per occurrence.
  // Set participants=1 so the generator total = 375 × 1 × 12 = ₹4,500/settlement/yr.
  { domain: "WelfareRights", itemKey: "wr.slum_meeting_refreshment",        unitCost: 375,    unit: "₹/settlement/occurrence", notes: "Community meeting — all-in per occurrence" },
  { domain: "WelfareRights", itemKey: "wr.slum_meeting_participants",        unitCost: 1,      unit: "units",                   notes: "1 unit = one settlement occurrence" },
  // Cluster-level awareness programme ₹21,000/cluster/year → ₹1,750/month × 1
  { domain: "WelfareRights", itemKey: "wr.cluster_meeting_refreshment",     unitCost: 1750,   unit: "₹/cluster/month",         notes: "Awareness programme ₹21,000/yr ÷ 12" },
  { domain: "WelfareRights", itemKey: "wr.cluster_meeting_participants",    unitCost: 1,      unit: "units" },
  // SVG leadership training (annual)
  { domain: "WelfareRights", itemKey: "wr.city_training_cost",              unitCost: 105000, unit: "₹/year",                  notes: "SVG leadership training" },
  // SVG area-level event & meetings
  { domain: "WelfareRights", itemKey: "wr.city_meeting_cost",               unitCost: 9050,   unit: "₹/year",                  notes: "SVG area-level event & meetings" },
  // Staff exposure visit per person
  { domain: "WelfareRights", itemKey: "wr.community_exposure_per_leader",   unitCost: 10500,  unit: "₹/staff",                 notes: "Staff exposure visit" },
  { domain: "WelfareRights", itemKey: "wr.leaders_per_cluster",             unitCost: 1,      unit: "staff per cluster" },
  // SVG settlement-level meeting ₹625/settlement
  { domain: "WelfareRights", itemKey: "wr.entitlement_camp_per_settlement", unitCost: 625,    unit: "₹/settlement",            notes: "SVG settlement-level meeting" },
  // Leaders training — 4 quarters × ₹12,750 = ₹51,000/year
  { domain: "WelfareRights", itemKey: "wr.consultation_cost",               unitCost: 51000,  unit: "₹/year",                  notes: "Leaders training (4 × ₹12,750/quarter)" },
  // Entitlement camp per area = ₹1,250
  { domain: "WelfareRights", itemKey: "wr.governance_cost_per_cluster",     unitCost: 1250,   unit: "₹/area/year",             notes: "Entitlement camp" },
  // Area coordinator travel ₹1,500/month × 12
  { domain: "WelfareRights", itemKey: "wr.dept_interaction_per_cluster",    unitCost: 18000,  unit: "₹/area/year",             notes: "Area coordinator travel" },
  // Training of community volunteers
  { domain: "WelfareRights", itemKey: "wr.special_occasions_cost",          unitCost: 12000,  unit: "₹/year",                  notes: "Training of community volunteers" },
  // Health camp per area
  { domain: "WelfareRights", itemKey: "wr.civic_baseline_cost",             unitCost: 2750,   unit: "₹/year",                  notes: "Health camp per area" },

  // ── Elderly ───────────────────────────────────────────────────────────────
  // Chennai uses "Friend of the Elderly" (dedicated worker model, Nil inflation)
  { domain: "Elderly",       itemKey: "elderly.volunteer_honorarium_per_month", unitCost: 19200, unit: "₹/worker/month",       notes: "Friend of the Elderly honorarium (Nil inflation)" },
  { domain: "Elderly",       itemKey: "elderly.volunteers_per_centre",      unitCost: 3,      unit: "workers",                 notes: "EP workers per centre (1 per 500 elderly)" },
  { domain: "Elderly",       itemKey: "elderly.kitchen_incharge_travel",    unitCost: 1000,   unit: "₹/month",                 notes: "EP Coordinator travel" },
  { domain: "Elderly",       itemKey: "elderly.misc_contingency_per_centre",unitCost: 5000,   unit: "₹/year/centre",           notes: "Medicines & first aid" },

  // ── Creche ────────────────────────────────────────────────────────────────
  // All 5 Chennai partners (Arunodhaya, DBAI, DBSSS, Thozhamai, TNDWWT) use identical costs.
  // 2.2 workers/creche = template unit count ÷ (n_creches × 12); includes maternity buffer implicitly.
  { domain: "Creche",        itemKey: "creche.workers_per_creche",          unitCost: 2.2,    unit: "workers",                 notes: "2.2 workers/creche (incl. implicit maternity buffer)" },
  { domain: "Creche",        itemKey: "creche.worker_honorarium_per_month", unitCost: 13500,  unit: "₹/worker/month" },
  { domain: "Creche",        itemKey: "creche.maternity_buffer_pct",        unitCost: 0,      unit: "%",                       notes: "Buffer baked into 2.2 workers/creche ratio" },
  { domain: "Creche",        itemKey: "creche.setup_cost",                  unitCost: 135830, unit: "₹/creche",                notes: "Anthropometric ₹34k + galvanised ₹17.27k + fittings ₹51.41k + misc ₹22.15k + safety ₹11k" },
  { domain: "Creche",        itemKey: "creche.supervisor_salary_per_month", unitCost: 23000,  unit: "₹/month" },
  { domain: "Creche",        itemKey: "creche.supervisor_per_n_creches",    unitCost: 10,     unit: "creches per supervisor",  notes: "1 supervisor per batch (up to ~10 creches)" },
  { domain: "Creche",        itemKey: "creche.coordinator_salary_per_month",unitCost: 25600,  unit: "₹/month" },
  { domain: "Creche",        itemKey: "creche.supervisor_travel_per_month", unitCost: 1500,   unit: "₹/supervisor/month" },
  { domain: "Creche",        itemKey: "creche.insurance_per_creche_per_year", unitCost: 718,  unit: "₹/creche/year",           notes: "Health & accident insurance" },
  { domain: "Creche",        itemKey: "creche.accounts_manager_salary_per_month", unitCost: 23000, unit: "₹/month",           notes: "Accounts & Logistics Manager" },
  { domain: "Creche",        itemKey: "creche.accounts_manager_travel_per_month", unitCost: 3500,  unit: "₹/month" },

  // ── Cross-cutting ─────────────────────────────────────────────────────────
  // Staff training ₹571/staff — estimate for ~20 staff
  { domain: null,            itemKey: "cross.staff_capacity_building",      unitCost: 11420,  unit: "₹/year",                  notes: "₹571/staff × ~20 staff" },
  { domain: null,            itemKey: "cross.team_building_offsite",        unitCost: 150000, unit: "₹/year" },

];

// Returns the full cost list for a city, merging Chennai overrides onto the Bangalore base.
export function getDefaultsForCity(city: string): CostItem[] {
  if (city !== "Chennai") return DEFAULT_COSTS;
  const overrideMap = new Map(DEFAULT_COSTS_CHENNAI.map(c => [c.itemKey, c]));
  const base = DEFAULT_COSTS.map(c => overrideMap.get(c.itemKey) ?? c);
  const bangaloreKeys = new Set(DEFAULT_COSTS.map(c => c.itemKey));
  const chennaiOnly = DEFAULT_COSTS_CHENNAI.filter(c => !bangaloreKeys.has(c.itemKey));
  return [...base, ...chennaiOnly];
}

// Lookup helper — returns the unitCost for a given itemKey from the seeded/edited registry,
// falling back to DEFAULT_COSTS if not found.
export function lookupCost(
  registry: Record<string, number>,
  itemKey: string,
  fallback?: number
): number {
  if (registry[itemKey] !== undefined) return registry[itemKey];
  const def = DEFAULT_COSTS.find(c => c.itemKey === itemKey);
  return def?.unitCost ?? fallback ?? 0;
}
