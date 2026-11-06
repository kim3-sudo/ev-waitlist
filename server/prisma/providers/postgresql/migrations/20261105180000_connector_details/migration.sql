-- Connector details for roaming partners (standard, format, power type, voltage, current). Only additions.

-- AlterTable
ALTER TABLE "Connector" ADD COLUMN     "format" TEXT,
ADD COLUMN     "maxAmperage" INTEGER,
ADD COLUMN     "maxVoltage" INTEGER,
ADD COLUMN     "powerType" TEXT,
ADD COLUMN     "standard" TEXT;

