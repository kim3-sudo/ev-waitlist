-- OCPI roaming: partners, their tokens, the outbox of messages to send, station coordinates, and the partner on roaming sessions. Only additions; existing data is unchanged.

-- AlterTable
ALTER TABLE `Station` ADD COLUMN `latitude` DOUBLE NULL,
    ADD COLUMN `longitude` DOUBLE NULL;

-- AlterTable
ALTER TABLE `Transaction` ADD COLUMN `partnerId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `OcpiPartner` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `registrationTokenHash` VARCHAR(191) NULL,
    `ourTokenHash` VARCHAR(191) NULL,
    `theirTokenEnc` TEXT NULL,
    `theirVersionsUrl` VARCHAR(191) NULL,
    `theirCountryCode` VARCHAR(191) NULL,
    `theirPartyId` VARCHAR(191) NULL,
    `endpoints` TEXT NOT NULL DEFAULT '{}',
    `lastError` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OcpiPartner_registrationTokenHash_key`(`registrationTokenHash`),
    UNIQUE INDEX `OcpiPartner_ourTokenHash_key`(`ourTokenHash`),
    INDEX `OcpiPartner_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OcpiToken` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `contractId` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NOT NULL,
    `party` VARCHAR(191) NOT NULL,
    `valid` BOOLEAN NOT NULL DEFAULT true,
    `whitelist` VARCHAR(191) NOT NULL DEFAULT 'ALLOWED',
    `lastUpdated` DATETIME(3) NOT NULL,

    INDEX `OcpiToken_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `OcpiToken_partnerId_uid_key`(`partnerId`, `uid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OcpiOutbox` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastError` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OcpiOutbox_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `OcpiOutbox_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OcpiPartner` ADD CONSTRAINT `OcpiPartner_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OcpiToken` ADD CONSTRAINT `OcpiToken_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OcpiToken` ADD CONSTRAINT `OcpiToken_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `OcpiPartner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OcpiOutbox` ADD CONSTRAINT `OcpiOutbox_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OcpiOutbox` ADD CONSTRAINT `OcpiOutbox_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `OcpiPartner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

