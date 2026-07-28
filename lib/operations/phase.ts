/**
 * Phase derivation for the Operations world.
 *
 * The spine stores a centre's lifecycle implicitly in its goal's pitstops:
 * one-time setup pitstops (recurrence = None) run in an ordered sequence
 * (`progressTag`: Planning → Mobilisation → Setup → Capacity → Engagement →
 * Delivery → Monitoring), then recurring pitstops (Weekly/Monthly/Quarterly)
 * carry the ongoing review rhythm once the centre is live.
 *
 * The Operations UI needs to show, per centre, at a glance:
 *   - SETTING UP  → which phase it's in ("Infrastructure · 2/6")
 *   - LIVE        → it's operating; recurring-visit status is layered on
 *                   separately (needs this-period events, computed elsewhere)
 *   - DONE        → nothing outstanding
 *
 * This module derives that purely from a goal's pitstops — no new fields, no
 * DB access. Keep it side-effect-free so it can be unit-reasoned and reused by
 * any loader.
 */

export type PhasePitstop = {
  status: string; // PitstopStatus: Upcoming | InProgress | Done
  recurrence: string; // PitstopRecurrence: None | Weekly | Monthly | Quarterly
  order: number;
  progressTag: string | null;
  title: string;
  deletedAt?: Date | string | null;
};

export type CentreLifecycle = "setting_up" | "live" | "done";

export type CentrePhase = {
  lifecycle: CentreLifecycle;
  /** Human label for the active setup phase (progressTag, else pitstop title). */
  currentPhaseLabel: string | null;
  /** 1-based position of the active setup pitstop among setup pitstops. */
  currentStep: number | null;
  /** Total number of setup pitstops (the "of N"). */
  totalSteps: number | null;
  /** True when the centre runs a recurring review rhythm (has recurring pitstops). */
  hasReviewRhythm: boolean;
};

const isDone = (p: PhasePitstop) => p.status === "Done";
const isSetup = (p: PhasePitstop) => p.recurrence === "None";
const notDeleted = (p: PhasePitstop) => !p.deletedAt;

/**
 * Derive the centre's lifecycle + current setup phase from its goal's pitstops.
 * `pitstops` may be in any order; deleted ones are ignored.
 *
 * `opts.mode` is the explicit Goal.mode. When it is "live", it wins over the implicit
 * pitstop-derived phase (a centre can be flipped live before every setup pitstop is Done).
 */
export function deriveCentrePhase(
  pitstops: PhasePitstop[],
  opts: { mode?: string } = {},
): CentrePhase {
  if (opts.mode === "live") {
    const setup = pitstops.filter(notDeleted).filter(isSetup);
    return {
      lifecycle: "live",
      currentPhaseLabel: null,
      currentStep: null,
      totalSteps: setup.length || null,
      hasReviewRhythm: true,
    };
  }
  const live = pitstops.filter(notDeleted);
  const setup = live.filter(isSetup).sort((a, b) => a.order - b.order);
  const hasReviewRhythm = live.some((p) => !isSetup(p));

  const firstOpenSetupIdx = setup.findIndex((p) => !isDone(p));

  if (firstOpenSetupIdx !== -1) {
    const active = setup[firstOpenSetupIdx];
    return {
      lifecycle: "setting_up",
      currentPhaseLabel: active.progressTag || active.title || null,
      currentStep: firstOpenSetupIdx + 1,
      totalSteps: setup.length,
      hasReviewRhythm,
    };
  }

  // No open setup work. If there's a recurring rhythm, the centre is live;
  // otherwise every pitstop is done (or there were none) → done.
  if (hasReviewRhythm) {
    return {
      lifecycle: "live",
      currentPhaseLabel: null,
      currentStep: null,
      totalSteps: setup.length || null,
      hasReviewRhythm: true,
    };
  }

  return {
    lifecycle: "done",
    currentPhaseLabel: null,
    currentStep: setup.length || null,
    totalSteps: setup.length || null,
    hasReviewRhythm: false,
  };
}
