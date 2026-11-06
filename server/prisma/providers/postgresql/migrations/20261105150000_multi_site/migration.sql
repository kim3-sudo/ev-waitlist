-- DropIndex
DROP INDEX "CustomRole_name_key";

-- DropIndex
DROP INDEX "Zone_name_key";

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Admin" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Charge" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ConfigValue" DROP CONSTRAINT "ConfigValue_pkey",
ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default',
ADD CONSTRAINT "ConfigValue_pkey" PRIMARY KEY ("tenantId", "key");

-- AlterTable
ALTER TABLE "ConfigValue" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomRole" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "CustomRole" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "IdleEvent" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "IdleEvent" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LineCutterReport" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "LineCutterReport" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PaymentSettings" DROP CONSTRAINT "PaymentSettings_pkey",
DROP COLUMN "id",
ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default',
ADD CONSTRAINT "PaymentSettings_pkey" PRIMARY KEY ("tenantId");

-- AlterTable
ALTER TABLE "PaymentSettings" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "QueueEntry" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Reservation" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SamlConfig" DROP CONSTRAINT "SamlConfig_pkey",
DROP COLUMN "id",
ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default',
ADD CONSTRAINT "SamlConfig_pkey" PRIMARY KEY ("tenantId");

-- AlterTable
ALTER TABLE "SamlConfig" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Settings" DROP CONSTRAINT "Settings_pkey",
DROP COLUMN "id",
ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default',
ADD CONSTRAINT "Settings_pkey" PRIMARY KEY ("tenantId");

-- AlterTable
ALTER TABLE "Settings" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Station" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Station" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Zone" ALTER COLUMN "tenantId" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "name" TEXT NOT NULL DEFAULT '',
    "countryCode" TEXT NOT NULL DEFAULT '',
    "partyId" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roamingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "roamingTermsAcknowledgedAt" TIMESTAMP(3),
    "roamingTermsAcknowledgedBy" TEXT,
    "roamingTermsAcknowledgedVersion" TEXT,
    "queueRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "financialRetentionDays" INTEGER DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- Default site (id "default") and the installation's operator. Existing installs
-- take their branding name for both; fresh installs get blank names until setup.
INSERT INTO "Tenant" ("id", "slug", "name", "createdAt", "updatedAt")
SELECT 'default', 'default', COALESCE((SELECT "companyName" FROM "Settings" WHERE "tenantId" = 'default'), 'Main site'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP;

INSERT INTO "Operator" ("id", "name", "countryCode", "partyId", "updatedAt")
SELECT 'singleton', COALESCE((SELECT "companyName" FROM "Settings" WHERE "tenantId" = 'default'), ''), '', '', CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Admin_tenantId_idx" ON "Admin"("tenantId");

-- CreateIndex
CREATE INDEX "Charge_tenantId_idx" ON "Charge"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_tenantId_name_key" ON "CustomRole"("tenantId", "name");

-- CreateIndex
CREATE INDEX "IdleEvent_tenantId_idx" ON "IdleEvent"("tenantId");

-- CreateIndex
CREATE INDEX "LineCutterReport_tenantId_idx" ON "LineCutterReport"("tenantId");

-- CreateIndex
CREATE INDEX "QueueEntry_tenantId_idx" ON "QueueEntry"("tenantId");

-- CreateIndex
CREATE INDEX "Reservation_tenantId_idx" ON "Reservation"("tenantId");

-- CreateIndex
CREATE INDEX "Station_tenantId_idx" ON "Station"("tenantId");

-- CreateIndex
CREATE INDEX "Transaction_tenantId_idx" ON "Transaction"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_tenantId_name_key" ON "Zone"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamlConfig" ADD CONSTRAINT "SamlConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineCutterReport" ADD CONSTRAINT "LineCutterReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdleEvent" ADD CONSTRAINT "IdleEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRole" ADD CONSTRAINT "CustomRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettings" ADD CONSTRAINT "PaymentSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigValue" ADD CONSTRAINT "ConfigValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


