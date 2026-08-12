// Derived lifecycle for a /field intervention — a pure function over its steps,
// mirroring the old lib/operations/phase.ts but far simpler (one flat step list,
// no pitstop-recurrence gymnastics). Phase is NEVER stored; always derived.
export type FieldPhase = "setting_up" | "live" | "done";

export function deriveFieldPhase(args: {
  mode: string;
  setupTotal: number;
  setupDone: number;
  hasVisitRecipe: boolean;
}): FieldPhase {
  const { mode, setupTotal, setupDone, hasVisitRecipe } = args;
  // Any incomplete setup step → still setting up (explicit live mode does not skip setup work).
  if (setupTotal > 0 && setupDone < setupTotal) return "setting_up";
  // Setup done (or none) and there's a live cadence to run → live.
  if (mode === "live" || hasVisitRecipe) return "live";
  // Setup finished with no live phase → done. Nothing to do yet → treat as setting up.
  return setupTotal > 0 ? "done" : "setting_up";
}

export const PHASE_LABEL: Record<FieldPhase, string> = {
  setting_up: "Setting up",
  live: "Live",
  done: "Done",
};
