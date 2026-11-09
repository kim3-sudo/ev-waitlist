-- AlterTable
ALTER TABLE `Station` ADD COLUMN `firmwareUpdateEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `localListEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `smartChargingEnabled` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `FirmwarePackage` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FirmwarePackage_storageKey_key`(`storageKey`),
    INDEX `FirmwarePackage_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DiagnosticsLog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',
    `tokenHash` VARCHAR(191) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `uploadedAt` DATETIME(3) NULL,
    `fileName` VARCHAR(191) NULL,
    `storageKey` VARCHAR(191) NULL,
    `sizeBytes` INTEGER NULL,
    `sha256` VARCHAR(191) NULL,

    UNIQUE INDEX `DiagnosticsLog_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `DiagnosticsLog_storageKey_key`(`storageKey`),
    INDEX `DiagnosticsLog_tenantId_idx`(`tenantId`),
    INDEX `DiagnosticsLog_stationId_idx`(`stationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FirmwarePackage` ADD CONSTRAINT `FirmwarePackage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DiagnosticsLog` ADD CONSTRAINT `DiagnosticsLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DiagnosticsLog` ADD CONSTRAINT `DiagnosticsLog_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

