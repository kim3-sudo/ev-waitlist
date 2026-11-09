-- AlterTable
ALTER TABLE `Tenant` ADD COLUMN `loadBalancingEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `siteCapacityKw` DOUBLE NULL;

-- AlterTable
ALTER TABLE `Charge` ADD COLUMN `discountCents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `reversalReason` TEXT NULL,
    ADD COLUMN `reversedAt` DATETIME(3) NULL,
    ADD COLUMN `subscriptionId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `BillingSettings` ADD COLUMN `emailInvoices` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `emailReceipts` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `BillingCustomer` ADD COLUMN `exemptionReference` VARCHAR(191) NULL,
    ADD COLUMN `taxExempt` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `WebhookEndpoint` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `secret` TEXT NOT NULL,
    `events` VARCHAR(191) NOT NULL DEFAULT '*',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WebhookEndpoint_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `endpointId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `payload` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastStatusCode` INTEGER NULL,
    `lastError` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deliveredAt` DATETIME(3) NULL,

    INDEX `WebhookDelivery_tenantId_idx`(`tenantId`),
    INDEX `WebhookDelivery_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionPlan` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `monthlyFeeCents` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL,
    `discountPercent` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SubscriptionPlan_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `idTag` VARCHAR(191) NOT NULL,
    `driverName` VARCHAR(191) NULL,
    `billingCustomerId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cancelledAt` DATETIME(3) NULL,
    `lastBilledPeriod` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Subscription_tenantId_idx`(`tenantId`),
    INDEX `Subscription_idTag_idx`(`idTag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WebhookEndpoint` ADD CONSTRAINT `WebhookEndpoint_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebhookDelivery` ADD CONSTRAINT `WebhookDelivery_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebhookDelivery` ADD CONSTRAINT `WebhookDelivery_endpointId_fkey` FOREIGN KEY (`endpointId`) REFERENCES `WebhookEndpoint`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionPlan` ADD CONSTRAINT `SubscriptionPlan_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `SubscriptionPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_billingCustomerId_fkey` FOREIGN KEY (`billingCustomerId`) REFERENCES `BillingCustomer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

