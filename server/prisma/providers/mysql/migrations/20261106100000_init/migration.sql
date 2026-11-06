-- CreateTable
CREATE TABLE `Operator` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `countryCode` VARCHAR(191) NOT NULL DEFAULT '',
    `partyId` VARCHAR(191) NOT NULL DEFAULT '',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tenant` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `roamingEnabled` BOOLEAN NOT NULL DEFAULT false,
    `roamingTermsAcknowledgedAt` DATETIME(3) NULL,
    `roamingTermsAcknowledgedBy` VARCHAR(191) NULL,
    `roamingTermsAcknowledgedVersion` VARCHAR(191) NULL,
    `roamingWarningExtra` TEXT NULL,
    `queueRetentionDays` INTEGER NOT NULL DEFAULT 30,
    `financialRetentionDays` INTEGER NULL DEFAULT 30,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tenant_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Admin` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NULL,
    `mfaSecret` VARCHAR(191) NULL,
    `mfaEnabled` BOOLEAN NOT NULL DEFAULT false,
    `alertOnFault` BOOLEAN NOT NULL DEFAULT false,
    `alertOffline` BOOLEAN NOT NULL DEFAULT false,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `role` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    `instanceAdmin` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Admin_email_key`(`email`),
    INDEX `Admin_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Settings` (
    `tenantId` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NOT NULL DEFAULT 'Plugyard',
    `logoUrl` TEXT NULL,
    `primaryColor` VARCHAR(191) NOT NULL DEFAULT '#0d7a5f',
    `secondaryColor` VARCHAR(191) NOT NULL DEFAULT '#1565c0',
    `fontFamily` VARCHAR(191) NULL,
    `plateRegions` TEXT NULL,
    `defaultPlateRegion` VARCHAR(191) NULL,
    `identifierMode` VARCHAR(191) NOT NULL DEFAULT 'LICENSE_PLATE',
    `mfaRequired` BOOLEAN NOT NULL DEFAULT false,
    `setupCompleted` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SamlConfig` (
    `tenantId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `idpEntityId` VARCHAR(191) NULL,
    `idpSsoUrl` VARCHAR(191) NULL,
    `idpCertificate` TEXT NULL,
    `autoProvision` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Zone` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Zone_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Station` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `identity` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `serialNumber` VARCHAR(191) NULL,
    `firmwareVersion` VARCHAR(191) NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `offlineSince` DATETIME(3) NULL,
    `offlineAlertSent` BOOLEAN NOT NULL DEFAULT false,
    `firmwareStatus` VARCHAR(191) NULL,
    `diagnosticsStatus` VARCHAR(191) NULL,
    `meterStatus` VARCHAR(191) NOT NULL DEFAULT 'UNKNOWN',
    `configurationJson` TEXT NULL,
    `configurationAt` DATETIME(3) NULL,
    `zoneId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Station_identity_key`(`identity`),
    INDEX `Station_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Connector` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Unavailable',
    `errorCode` VARCHAR(191) NULL,
    `standard` VARCHAR(191) NULL,
    `format` VARCHAR(191) NULL,
    `powerType` VARCHAR(191) NULL,
    `maxVoltage` INTEGER NULL,
    `maxAmperage` INTEGER NULL,
    `info` VARCHAR(191) NULL,
    `vendorErrorCode` VARCHAR(191) NULL,
    `operative` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Connector_stationId_connectorId_key`(`stationId`, `connectorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QueueEntry` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NULL,
    `zoneId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `contact` VARCHAR(191) NOT NULL,
    `smsNumber` VARCHAR(191) NULL,
    `idTag` VARCHAR(191) NOT NULL,
    `licensePlate` VARCHAR(191) NULL,
    `plateRegion` VARCHAR(191) NULL,
    `parkingPermit` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'WAITING',
    `position` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,

    INDEX `QueueEntry_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reservation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `queueEntryId` VARCHAR(191) NULL,
    `idTag` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `createdByAdminId` VARCHAR(191) NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `ocppReservationId` INTEGER NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Reservation_queueEntryId_key`(`queueEntryId`),
    INDEX `Reservation_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LineCutterReport` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `queueEntryId` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `LineCutterReport_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `idTag` VARCHAR(191) NOT NULL,
    `ocppTransactionId` INTEGER NOT NULL,
    `meterStart` INTEGER NULL,
    `meterStop` INTEGER NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `stoppedAt` DATETIME(3) NULL,
    `stopReason` VARCHAR(191) NULL,
    `partnerId` VARCHAR(191) NULL,

    INDEX `Transaction_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdleEvent` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,

    INDEX `IdleEvent_stationId_connectorId_endedAt_idx`(`stationId`, `connectorId`, `endedAt`),
    INDEX `IdleEvent_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MeterSample` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `ocppTransactionId` INTEGER NULL,
    `measurand` VARCHAR(191) NOT NULL,
    `context` VARCHAR(191) NULL,
    `value` DOUBLE NOT NULL,
    `at` DATETIME(3) NOT NULL,

    INDEX `MeterSample_stationId_ocppTransactionId_idx`(`stationId`, `ocppTransactionId`),
    INDEX `MeterSample_stationId_connectorId_measurand_at_idx`(`stationId`, `connectorId`, `measurand`, `at`),
    INDEX `MeterSample_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StationEvent` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NULL,
    `kind` VARCHAR(191) NOT NULL,
    `detail` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StationEvent_stationId_at_idx`(`stationId`, `at`),
    INDEX `StationEvent_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomRole` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `permissions` TEXT NOT NULL DEFAULT '[]',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomRole_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentSettings` (
    `tenantId` VARCHAR(191) NOT NULL,
    `pricingModel` VARCHAR(191) NOT NULL DEFAULT 'TIME',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `timeBillingUnit` VARCHAR(191) NOT NULL DEFAULT 'MINUTE',
    `ratePerMinuteCents` INTEGER NOT NULL DEFAULT 0,
    `peakRatePerMinuteCents` INTEGER NULL,
    `peakStartHour` INTEGER NULL,
    `peakEndHour` INTEGER NULL,
    `ratePerKwhCents` INTEGER NOT NULL DEFAULT 0,
    `energyPricingAcknowledgedAt` DATETIME(3) NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `rateSchedule` TEXT NULL,
    `referencePowerKw` DOUBLE NULL,
    `meterSampleSeconds` INTEGER NOT NULL DEFAULT 60,
    `meterToleranceWh` INTEGER NOT NULL DEFAULT 100,
    `meterTolerancePct` INTEGER NOT NULL DEFAULT 5,
    `meterMinSessionMinutes` INTEGER NOT NULL DEFAULT 2,
    `meterMaxJumpWh` INTEGER NOT NULL DEFAULT 50000,
    `rateCalculatorInputs` TEXT NULL,
    `preauthCents` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Charge` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NOT NULL,
    `idTag` VARCHAR(191) NOT NULL,
    `payerName` VARCHAR(191) NULL,
    `payerContact` VARCHAR(191) NULL,
    `payerSmsNumber` VARCHAR(191) NULL,
    `pricingModel` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `durationSeconds` INTEGER NOT NULL,
    `energyWh` INTEGER NULL,
    `energySource` VARCHAR(191) NULL,
    `energyNote` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `provider` VARCHAR(191) NULL,
    `providerRef` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `holdCapturedCents` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Charge_token_key`(`token`),
    UNIQUE INDEX `Charge_transactionId_key`(`transactionId`),
    INDEX `Charge_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentHold` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `idTag` VARCHAR(191) NOT NULL,
    `payerName` VARCHAR(191) NULL,
    `payerContact` VARCHAR(191) NULL,
    `amountCents` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'AWAITING',
    `provider` VARCHAR(191) NULL,
    `sessionRef` VARCHAR(191) NULL,
    `providerRef` VARCHAR(191) NULL,
    `transactionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentHold_token_key`(`token`),
    INDEX `PaymentHold_tenantId_idx`(`tenantId`),
    INDEX `PaymentHold_tenantId_idTag_idx`(`tenantId`, `idTag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConfigValue` (
    `tenantId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

-- CreateTable
CREATE TABLE `MessageTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `smsBody` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MessageTemplate_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `MessageTemplate_tenantId_key_key`(`tenantId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Admin` ADD CONSTRAINT `Admin_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Settings` ADD CONSTRAINT `Settings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SamlConfig` ADD CONSTRAINT `SamlConfig_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Zone` ADD CONSTRAINT `Zone_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Station` ADD CONSTRAINT `Station_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Station` ADD CONSTRAINT `Station_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `Zone`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Connector` ADD CONSTRAINT `Connector_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueEntry` ADD CONSTRAINT `QueueEntry_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueEntry` ADD CONSTRAINT `QueueEntry_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueEntry` ADD CONSTRAINT `QueueEntry_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `Zone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_queueEntryId_fkey` FOREIGN KEY (`queueEntryId`) REFERENCES `QueueEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LineCutterReport` ADD CONSTRAINT `LineCutterReport_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LineCutterReport` ADD CONSTRAINT `LineCutterReport_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LineCutterReport` ADD CONSTRAINT `LineCutterReport_queueEntryId_fkey` FOREIGN KEY (`queueEntryId`) REFERENCES `QueueEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IdleEvent` ADD CONSTRAINT `IdleEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IdleEvent` ADD CONSTRAINT `IdleEvent_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MeterSample` ADD CONSTRAINT `MeterSample_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MeterSample` ADD CONSTRAINT `MeterSample_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StationEvent` ADD CONSTRAINT `StationEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StationEvent` ADD CONSTRAINT `StationEvent_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomRole` ADD CONSTRAINT `CustomRole_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentSettings` ADD CONSTRAINT `PaymentSettings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Charge` ADD CONSTRAINT `Charge_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Charge` ADD CONSTRAINT `Charge_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Charge` ADD CONSTRAINT `Charge_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentHold` ADD CONSTRAINT `PaymentHold_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConfigValue` ADD CONSTRAINT `ConfigValue_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE `MessageTemplate` ADD CONSTRAINT `MessageTemplate_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

