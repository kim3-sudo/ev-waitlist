-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "smartChargingConfig" TEXT;

-- AlterTable
ALTER TABLE "Connector" ADD COLUMN     "phaseCount" INTEGER,
ADD COLUMN     "phase" TEXT;
