-- WBS one-page plan: flag a pitstop as the milestone / launch gate node.
ALTER TABLE "Pitstop" ADD COLUMN "isMilestone" BOOLEAN NOT NULL DEFAULT false;
