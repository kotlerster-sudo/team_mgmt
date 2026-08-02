-- Cross-year carry-forward: null keeps the existing same-year behaviour.
ALTER TABLE "BudgetReallocationRequest" ADD COLUMN "targetGrantYear" INTEGER;
