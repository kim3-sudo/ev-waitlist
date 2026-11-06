-- Instance administrator, queue closing time, and roaming warning text.
-- Closed queue entries get closedAt from their creation time (the closing time was not recorded before).
-- The installation's first admin becomes the instance administrator.

-- AlterTable
ALTER TABLE `Admin` ADD COLUMN `instanceAdmin` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `QueueEntry` ADD COLUMN `closedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Tenant` ADD COLUMN `roamingWarningExtra` TEXT NULL;

-- Backfill
UPDATE `QueueEntry` SET `closedAt` = `createdAt` WHERE `status` IN ('COMPLETED', 'EXPIRED', 'CANCELLED') AND `closedAt` IS NULL;

UPDATE `Admin` SET `instanceAdmin` = 1 WHERE `id` = (SELECT `id` FROM (SELECT `id` FROM `Admin` ORDER BY `createdAt` ASC LIMIT 1) AS first_admin);
