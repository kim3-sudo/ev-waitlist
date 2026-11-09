-- AlterTable
ALTER TABLE `Tenant` ADD COLUMN `smartChargingConfig` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `Connector` ADD COLUMN `phaseCount` INTEGER NULL,
    ADD COLUMN `phase` VARCHAR(191) NULL;
