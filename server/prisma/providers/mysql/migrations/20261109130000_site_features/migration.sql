-- AlterTable
ALTER TABLE `Tenant` ADD COLUMN `amenityKeys` TEXT NULL;
ALTER TABLE `Tenant` ADD COLUMN `parkingKeys` TEXT NULL;
ALTER TABLE `Tenant` ADD COLUMN `accessControlled` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Station` ADD COLUMN `parkingKeys` TEXT NULL;
