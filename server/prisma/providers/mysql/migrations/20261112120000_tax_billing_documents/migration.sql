-- AlterTable
ALTER TABLE `Charge` ADD COLUMN `netCents` INTEGER NULL,
    ADD COLUMN `taxCents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `taxJson` TEXT NULL;

-- CreateTable
CREATE TABLE `BillingSettings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(191) NULL,
    `taxId` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `invoicePrefix` VARCHAR(191) NOT NULL DEFAULT 'INV',
    `receiptPrefix` VARCHAR(191) NOT NULL DEFAULT 'RCP',
    `paymentTermsDays` INTEGER NOT NULL DEFAULT 30,
    `footerText` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BillingSettings_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaxRule` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `jurisdiction` VARCHAR(191) NULL,
    `rateBasisPoints` INTEGER NOT NULL,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'EXCLUSIVE',
    `appliesTo` VARCHAR(191) NOT NULL DEFAULT 'ALL',
    `scope` VARCHAR(191) NOT NULL DEFAULT 'SITE',
    `zoneId` VARCHAR(191) NULL,
    `stationId` VARCHAR(191) NULL,
    `validFrom` DATETIME(3) NULL,
    `validUntil` DATETIME(3) NULL,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TaxRule_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BillingCustomer` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `taxId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BillingCustomer_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'INVOICE',
    `status` VARCHAR(191) NOT NULL DEFAULT 'ISSUED',
    `customerId` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `netCents` INTEGER NOT NULL,
    `taxCents` INTEGER NOT NULL,
    `totalCents` INTEGER NOT NULL,
    `supplierSnapshot` TEXT NOT NULL,
    `customerSnapshot` TEXT NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `creditsInvoiceId` VARCHAR(191) NULL,

    INDEX `Invoice_customerId_idx`(`customerId`),
    UNIQUE INDEX `Invoice_tenantId_number_key`(`tenantId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvoiceLine` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `chargeId` VARCHAR(191) NULL,
    `netCents` INTEGER NOT NULL,
    `taxCents` INTEGER NOT NULL,
    `totalCents` INTEGER NOT NULL,
    `taxJson` TEXT NULL,

    UNIQUE INDEX `InvoiceLine_chargeId_key`(`chargeId`),
    INDEX `InvoiceLine_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Receipt` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `chargeId` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `netCents` INTEGER NOT NULL,
    `taxCents` INTEGER NOT NULL,
    `totalCents` INTEGER NOT NULL,
    `taxJson` TEXT NULL,
    `payerName` VARCHAR(191) NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Receipt_chargeId_key`(`chargeId`),
    UNIQUE INDEX `Receipt_tenantId_number_key`(`tenantId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentCounter` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `next` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `DocumentCounter_tenantId_kind_key`(`tenantId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BillingSettings` ADD CONSTRAINT `BillingSettings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaxRule` ADD CONSTRAINT `TaxRule_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BillingCustomer` ADD CONSTRAINT `BillingCustomer_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `BillingCustomer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceLine` ADD CONSTRAINT `InvoiceLine_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Receipt` ADD CONSTRAINT `Receipt_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentCounter` ADD CONSTRAINT `DocumentCounter_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

