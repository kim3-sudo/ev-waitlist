-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "smartChargingConfig" TEXT;

-- AlterTable
ALTER TABLE "Connector" ADD COLUMN "phaseCount" INTEGER;
ALTER TABLE "Connector" ADD COLUMN "phase" TEXT;
