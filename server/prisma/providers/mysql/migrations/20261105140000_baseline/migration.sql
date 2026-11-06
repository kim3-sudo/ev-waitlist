-- CreateTable
CREATE TABLE `Admin` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NULL,
    `mfaSecret` VARCHAR(191) NULL,
    `mfaEnabled` BOOLEAN NOT NULL DEFAULT false,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `role` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Admin_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Settings` (
    `id` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NOT NULL DEFAULT 'EV Waitlist',
    `logoUrl` TEXT NULL,
    `primaryColor` VARCHAR(191) NOT NULL DEFAULT '#0d7a5f',
    `secondaryColor` VARCHAR(191) NOT NULL DEFAULT '#1565c0',
    `fontFamily` VARCHAR(191) NULL,
    `identifierMode` VARCHAR(191) NOT NULL DEFAULT 'LICENSE_PLATE',
    `mfaRequired` BOOLEAN NOT NULL DEFAULT false,
    `setupCompleted` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SamlConfig` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `idpEntityId` VARCHAR(191) NULL,
    `idpSsoUrl` VARCHAR(191) NULL,
    `idpCertificate` TEXT NULL,
    `autoProvision` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Zone` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Zone_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Station` (
    `id` VARCHAR(191) NOT NULL,
    `identity` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `zoneId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Station_identity_key`(`identity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Connector` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Unavailable',
    `errorCode` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Connector_stationId_connectorId_key`(`stationId`, `connectorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QueueEntry` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NULL,
    `zoneId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `contact` VARCHAR(191) NOT NULL,
    `idTag` VARCHAR(191) NOT NULL,
    `licensePlate` VARCHAR(191) NULL,
    `parkingPermit` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'WAITING',
    `position` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reservation` (
    `id` VARCHAR(191) NOT NULL,
    `queueEntryId` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `ocppReservationId` INTEGER NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Reservation_queueEntryId_key`(`queueEntryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LineCutterReport` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `queueEntryId` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `idTag` VARCHAR(191) NOT NULL,
    `ocppTransactionId` INTEGER NOT NULL,
    `meterStart` INTEGER NULL,
    `meterStop` INTEGER NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `stoppedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdleEvent` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,

    INDEX `IdleEvent_stationId_connectorId_endedAt_idx`(`stationId`, `connectorId`, `endedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomRole` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `permissions` TEXT NOT NULL DEFAULT '[]',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomRole_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentSettings` (
    `id` VARCHAR(191) NOT NULL,
    `pricingModel` VARCHAR(191) NOT NULL DEFAULT 'TIME',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `ratePerMinuteCents` INTEGER NOT NULL DEFAULT 0,
    `peakRatePerMinuteCents` INTEGER NULL,
    `peakStartHour` INTEGER NULL,
    `peakEndHour` INTEGER NULL,
    `ratePerKwhCents` INTEGER NOT NULL DEFAULT 0,
    `energyPricingAcknowledgedAt` DATETIME(3) NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Charge` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NOT NULL,
    `idTag` VARCHAR(191) NOT NULL,
    `payerName` VARCHAR(191) NULL,
    `payerContact` VARCHAR(191) NULL,
    `pricingModel` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `durationSeconds` INTEGER NOT NULL,
    `energyWh` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `provider` VARCHAR(191) NULL,
    `providerRef` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Charge_token_key`(`token`),
    UNIQUE INDEX `Charge_transactionId_key`(`transactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConfigValue` (
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Station` ADD CONSTRAINT `Station_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `Zone`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Connector` ADD CONSTRAINT `Connector_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueEntry` ADD CONSTRAINT `QueueEntry_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueEntry` ADD CONSTRAINT `QueueEntry_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `Zone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_queueEntryId_fkey` FOREIGN KEY (`queueEntryId`) REFERENCES `QueueEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LineCutterReport` ADD CONSTRAINT `LineCutterReport_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LineCutterReport` ADD CONSTRAINT `LineCutterReport_queueEntryId_fkey` FOREIGN KEY (`queueEntryId`) REFERENCES `QueueEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IdleEvent` ADD CONSTRAINT `IdleEvent_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Charge` ADD CONSTRAINT `Charge_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Charge` ADD CONSTRAINT `Charge_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

