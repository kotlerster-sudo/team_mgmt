-- A grantee organisation can hold several login accounts (finance officer,
-- director) instead of exactly one. The reverse stays single: a login still
-- belongs to one grantee.
CREATE TABLE "GrantPartnerUser" (
    "id" TEXT NOT NULL,
    "grantPartnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrantPartnerUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GrantPartnerUser_userId_key" ON "GrantPartnerUser"("userId");
CREATE INDEX "GrantPartnerUser_grantPartnerId_idx" ON "GrantPartnerUser"("grantPartnerId");

ALTER TABLE "GrantPartnerUser" ADD CONSTRAINT "GrantPartnerUser_grantPartnerId_fkey"
    FOREIGN KEY ("grantPartnerId") REFERENCES "GrantPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrantPartnerUser" ADD CONSTRAINT "GrantPartnerUser_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry the existing one-login-per-grantee links across.
INSERT INTO "GrantPartnerUser" ("id", "grantPartnerId", "userId", "createdAt")
SELECT gen_random_uuid()::text, "id", "userId", "createdAt"
FROM "GrantPartner"
WHERE "userId" IS NOT NULL;

-- The column is now a second source of truth for the same fact. Drop it.
ALTER TABLE "GrantPartner" DROP CONSTRAINT IF EXISTS "GrantPartner_userId_fkey";
DROP INDEX IF EXISTS "GrantPartner_userId_key";
ALTER TABLE "GrantPartner" DROP COLUMN "userId";
