CREATE TABLE "BudgetReportLineNote" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "budgetLineId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetReportLineNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BudgetReportLineNote_reportId_idx" ON "BudgetReportLineNote"("reportId");
CREATE INDEX "BudgetReportLineNote_budgetLineId_idx" ON "BudgetReportLineNote"("budgetLineId");

ALTER TABLE "BudgetReportLineNote" ADD CONSTRAINT "BudgetReportLineNote_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BudgetReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetReportLineNote" ADD CONSTRAINT "BudgetReportLineNote_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetReportLineNote" ADD CONSTRAINT "BudgetReportLineNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
