/**
 * Deterministic rule for choosing between append and regenerate when the
 * recruiter adds more CVs to an existing scouting desk. The user does NOT
 * pick — the rule is the single source of truth and applies both on the
 * server (dispatch) and client (preview line).
 *
 * Small pools: axes were derived from too little signal — refresh them.
 * Medium pools: single addition = append; batch = refresh.
 * Large pools: refresh only when the addition is a meaningful fraction of
 * the pool (>= 20%); otherwise the existing axes stay trustworthy.
 */

export type AddMode = "append" | "regenerate";

export const SMALL_POOL_THRESHOLD = 4;   // pool sizes below this always regenerate
export const LARGE_POOL_THRESHOLD = 15;  // pool sizes at/above this use the ratio rule
export const LARGE_POOL_RATIO = 0.2;     // 20% of the pool triggers regenerate

export function decideMode(poolSize: number, addCount: number): AddMode {
  if (poolSize < SMALL_POOL_THRESHOLD) return "regenerate";
  if (poolSize < LARGE_POOL_THRESHOLD) return addCount >= 2 ? "regenerate" : "append";
  return addCount / poolSize >= LARGE_POOL_RATIO ? "regenerate" : "append";
}

/** Human-readable one-liner for the modal preview + progress messaging. */
export function describeMode(mode: AddMode, poolSize: number, addCount: number): string {
  const cvs = `${addCount} CV${addCount === 1 ? "" : "s"}`;
  const pool = `pool of ${poolSize}`;
  if (mode === "append") {
    return `Adding ${cvs} to a ${pool} → will append to the existing pool (takes ~1 min).`;
  }
  return `Adding ${cvs} to a ${pool} → will regenerate the full pool with fresh axes (takes a few min).`;
}
