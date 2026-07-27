-- Per-step "blocks sign-off" toggle. Default TRUE preserves existing
-- behaviour: all seeded template steps continue to gate their section's
-- completeness. New user-added steps also default TRUE but the UI exposes
-- a checkbox to opt out.
ALTER TABLE "SchoolPlanStep" ADD COLUMN IF NOT EXISTS "blocksSignoff" BOOLEAN NOT NULL DEFAULT true;
