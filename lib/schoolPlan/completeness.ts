// Derived completeness of a school plan. Sections 0..10 correspond to the plan
// page's section headings; the plan can move to "for_review" only when every
// section is complete AND every additional blocking step is Done / N/A. A
// section is complete when
//   (a) every step in that planSection carrying blocksSignoff=true is Done or N/A, AND
//   (b) every required field on that section has a value, AND
//   (c) every requiredArtifactType is present as an artifact.
//
// blocksSignoff is a per-step boolean (default true). Toggling it OFF lets the
// team park a step in the tracker without gating sign-off — useful for steps
// added mid-flight that are informational rather than mandatory.
//
// Section membership is now driven by SchoolPlanStep.planSection in the DB
// (so user-added steps can slot into a section by picking one); requiredArtifactType
// is likewise read from the DB. The lib/schoolPlan/stepTemplate.ts template only
// determines the initial seed — it's not the runtime source of truth.

import type { SchoolPlanStepStatusValue } from "./types";

export type StepForCompleteness = {
  stepNo: number;
  title: string;
  status: SchoolPlanStepStatusValue;
  planSection: string | null;
  requiredArtifactType: string | null;
  blocksSignoff: boolean;
};

export type PlanForCompleteness = {
  id: string;
  name: string;
  officialName: string | null;
  district: string | null;
  headTeacherName: string | null;
  enrolmentBoys: number | null;
  enrolmentGirls: number | null;
  targetChildrenPerDay: number | null;
  siteAreaSqft: number | null;
  builtupAreaSqft: number | null;
  surveyStatus: string | null;
  capacityRead: string | null;
  mobilisationNotes: string | null;
  budgetId: string | null;
  ourLeadUserId: string | null;
  anchorPartnerName: string | null;
  steps: StepForCompleteness[];
  settlementsCount: number;
  spacesCount: number;
  servicesAssessedCount: number; // status != unknown
  componentsWithOfferCount: number;
  staffingCount: number;
  milestonesCount: number;
  risksCount: number;
  artifactsByKind: Record<string, number>;
  signoffApproved: boolean;
};

export type SectionCompleteness = {
  section: string;                    // "1".."10" or "extras"
  title: string;
  ready: boolean;                     // all requirements met
  missing: string[];                  // human-readable list of what's still needed
};

const SECTION_TITLES: Record<string, string> = {
  "1":  "School snapshot",
  "2":  "Catchment",
  "3":  "Space",
  "4":  "Services & infrastructure",
  "5":  "Programme offer",
  "6":  "Staffing & operating model",
  "7":  "Timeline",
  "8":  "Budget",
  "9":  "Risks & open issues",
  "10": "Sign-off",
  extras: "Additional blocking steps",
};

function isStepDone(status: SchoolPlanStepStatusValue): boolean {
  return status === "done" || status === "not_applicable";
}

/** Blocking steps assigned to a given section — enumerated from the plan's own
 *  step rows, so user-added steps that carry a planSection count too. */
function blockingStepsForSection(plan: PlanForCompleteness, section: string): StepForCompleteness[] {
  return plan.steps.filter((s) => s.blocksSignoff && s.planSection === section);
}

/** Required artefact kinds are also DB-driven now — any step in the section
 *  carrying a requiredArtifactType contributes, whether template or user-added. */
function requiredArtifactsForSection(plan: PlanForCompleteness, section: string): string[] {
  return plan.steps
    .filter((s) => s.planSection === section && !!s.requiredArtifactType)
    .map((s) => s.requiredArtifactType as string);
}

export function sectionCompleteness(
  section: string,
  plan: PlanForCompleteness,
): SectionCompleteness {
  const missing: string[] = [];
  for (const s of blockingStepsForSection(plan, section)) {
    if (!isStepDone(s.status)) missing.push(`step ${s.stepNo} not done (${s.title})`);
  }
  for (const kind of requiredArtifactsForSection(plan, section)) {
    if (!plan.artifactsByKind[kind]) missing.push(`missing artefact: ${kind}`);
  }

  // Section-specific required-field checks.
  switch (section) {
    case "1":
      if (!plan.officialName) missing.push("official school name");
      if (!plan.headTeacherName) missing.push("head teacher");
      if (plan.enrolmentBoys == null || plan.enrolmentGirls == null) missing.push("enrolment");
      if (plan.targetChildrenPerDay == null) missing.push("children/day planned");
      if (!plan.ourLeadUserId) missing.push("our lead");
      break;
    case "2":
      if (plan.settlementsCount === 0) missing.push("at least one settlement");
      if (!plan.mobilisationNotes) missing.push("mobilisation notes");
      break;
    case "3":
      if (plan.spacesCount === 0) missing.push("at least one space");
      if (!plan.siteAreaSqft) missing.push("site area");
      if (!plan.builtupAreaSqft) missing.push("built-up area");
      break;
    case "4":
      if (plan.servicesAssessedCount < 8) missing.push("all 8 services assessed");
      break;
    case "5":
      if (plan.componentsWithOfferCount === 0) missing.push("programme components filled");
      break;
    case "6":
      if (plan.staffingCount === 0) missing.push("staffing plan");
      if (!plan.anchorPartnerName) missing.push("anchor partner");
      break;
    case "7":
      if (plan.milestonesCount === 0) missing.push("timeline milestones");
      break;
    case "8":
      if (!plan.budgetId) missing.push("budget attached");
      break;
    case "9":
      if (plan.risksCount === 0) missing.push("risks logged");
      break;
    case "10":
      if (!plan.signoffApproved) missing.push("sign-off not approved");
      break;
  }

  return {
    section,
    title: SECTION_TITLES[section] ?? section,
    ready: missing.length === 0,
    missing,
  };
}

/** Blocking steps that carry no planSection — usually user-added ones the team
 *  wants to track but hasn't slotted into a formal §-section. Surface them as
 *  a pseudo-section so they still gate sign-off. */
function extrasCompleteness(plan: PlanForCompleteness): SectionCompleteness | null {
  const rows = plan.steps.filter((s) => s.blocksSignoff && !s.planSection && !isStepDone(s.status));
  if (rows.length === 0) return null;
  return {
    section: "extras",
    title: SECTION_TITLES.extras,
    ready: false,
    missing: rows.map((s) => `step ${s.stepNo} not done (${s.title})`),
  };
}

export function planCompleteness(plan: PlanForCompleteness): {
  sections: SectionCompleteness[];
  ready: boolean;
  readyCount: number;
} {
  const numbered = ["1","2","3","4","5","6","7","8","9","10"].map((s) => sectionCompleteness(s, plan));
  const extras = extrasCompleteness(plan);
  const sections = extras ? [...numbered, extras] : numbered;
  const ready = sections.every((s) => s.ready);
  const readyCount = sections.filter((s) => s.ready).length;
  return { sections, ready, readyCount };
}
