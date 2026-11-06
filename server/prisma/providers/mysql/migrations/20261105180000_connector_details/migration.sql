-- Connector details for roaming partners (standard, format, power type, voltage, current). Only additions.

-- AlterTable
ALTER TABLE `Connector` ADD COLUMN `format` VARCHAR(191) NULL,
    ADD COLUMN `maxAmperage` INTEGER NULL,
    ADD COLUMN `maxVoltage` INTEGER NULL,
    ADD COLUMN `powerType` VARCHAR(191) NULL,
    ADD COLUMN `standard` VARCHAR(191) NULL;

