-- Connector details for roaming partners (standard, format, power type, voltage, current). Only additions.

-- AlterTable
ALTER TABLE "Connector" ADD COLUMN "format" TEXT;
ALTER TABLE "Connector" ADD COLUMN "maxAmperage" INTEGER;
ALTER TABLE "Connector" ADD COLUMN "maxVoltage" INTEGER;
ALTER TABLE "Connector" ADD COLUMN "powerType" TEXT;
ALTER TABLE "Connector" ADD COLUMN "standard" TEXT;

