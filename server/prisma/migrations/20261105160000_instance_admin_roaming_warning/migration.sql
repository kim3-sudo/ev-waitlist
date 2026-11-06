-- Instance administrator, queue closing time, and roaming warning text.
-- Closed queue entries get closedAt from their creation time (the closing time was not recorded before).
-- The installation's first admin becomes the instance administrator.

-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN "closedAt" DATETIME;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "roamingWarningExtra" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Admin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "instanceAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Admin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Admin" ("createdAt", "email", "id", "mfaEnabled", "mfaSecret", "mustChangePassword", "passwordHash", "role", "tenantId") SELECT "createdAt", "email", "id", "mfaEnabled", "mfaSecret", "mustChangePassword", "passwordHash", "role", "tenantId" FROM "Admin";
DROP TABLE "Admin";
ALTER TABLE "new_Admin" RENAME TO "Admin";
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");
CREATE INDEX "Admin_tenantId_idx" ON "Admin"("tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill
UPDATE "QueueEntry" SET "closedAt" = "createdAt" WHERE "status" IN ('COMPLETED', 'EXPIRED', 'CANCELLED') AND "closedAt" IS NULL;

UPDATE "Admin" SET "instanceAdmin" = 1 WHERE "id" = (SELECT "id" FROM "Admin" ORDER BY "createdAt" ASC LIMIT 1);
