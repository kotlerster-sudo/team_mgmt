CREATE TYPE "BudgetPartnerEditState" AS ENUM ('closed', 'open', 'submitted');

ALTER TABLE "Budget" ADD COLUMN "partnerEditState" "BudgetPartnerEditState" NOT NULL DEFAULT 'closed';
ALTER TABLE "Budget" ADD COLUMN "partnerSharedAt" TIMESTAMP(3);
ALTER TABLE "Budget" ADD COLUMN "partnerSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Budget" ADD COLUMN "partnerEditedAt" TIMESTAMP(3);
ALTER TABLE "Budget" ADD COLUMN "partnerRound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Budget" ADD COLUMN "partnerBaseline" JSONB;

ALTER TABLE "BudgetLine" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "BudgetLineNote" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "budgetLineId" TEXT,
    "round" INTEGER NOT NULL DEFAULT 0,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetLineNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BudgetLineNote_budgetId_round_idx" ON "BudgetLineNote"("budgetId", "round");
CREATE INDEX "BudgetLineNote_budgetLineId_idx" ON "BudgetLineNote"("budgetLineId");

ALTER TABLE "BudgetLineNote" ADD CONSTRAINT "BudgetLineNote_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetLineNote" ADD CONSTRAINT "BudgetLineNote_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BudgetLineNote" ADD CONSTRAINT "BudgetLineNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
