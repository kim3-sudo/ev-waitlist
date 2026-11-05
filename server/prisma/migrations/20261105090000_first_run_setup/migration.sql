-- AlterTable
ALTER TABLE "Admin" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "setupCompleted" BOOLEAN NOT NULL DEFAULT false;

-- Existing deployments were already set up before the wizard existed.
UPDATE "Settings" SET "setupCompleted" = true;
