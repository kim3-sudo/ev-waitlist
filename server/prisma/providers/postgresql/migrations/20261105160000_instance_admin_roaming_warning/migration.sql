-- Instance administrator, queue closing time, and roaming warning text.
-- Closed queue entries get closedAt from their creation time (the closing time was not recorded before).
-- The installation's first admin becomes the instance administrator.

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "instanceAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN     "closedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "roamingWarningExtra" TEXT;

-- Backfill
UPDATE "QueueEntry" SET "closedAt" = "createdAt" WHERE "status" IN ('COMPLETED', 'EXPIRED', 'CANCELLED') AND "closedAt" IS NULL;

UPDATE "Admin" SET "instanceAdmin" = true WHERE "id" = (SELECT "id" FROM "Admin" ORDER BY "createdAt" ASC LIMIT 1);
