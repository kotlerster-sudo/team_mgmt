-- The colleague accountable for a grant. `partnerId` is only whoever clicked
-- create, and `grantingUnitId` is a team — neither answers "who chases this
-- partner when a report is late", which is what a portfolio view needs.

ALTER TABLE "Budget" ADD COLUMN "grantLeadId" TEXT;
CREATE INDEX "Budget_grantLeadId_idx" ON "Budget"("grantLeadId");
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_grantLeadId_fkey"
    FOREIGN KEY ("grantLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
