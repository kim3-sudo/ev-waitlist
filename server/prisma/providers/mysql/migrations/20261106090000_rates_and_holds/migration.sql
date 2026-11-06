-- Time-of-day rates, rate calculator inputs, pre-authorization holds. Only additions.

-- AlterTable
ALTER TABLE `PaymentSettings` ADD COLUMN `rateSchedule` TEXT NULL,
    ADD COLUMN `referencePowerKw` DOUBLE NULL,
    ADD COLUMN `rateCalculatorInputs` TEXT NULL,
    ADD COLUMN `preauthCents` INTEGER NULL;

-- AlterTable
ALTER TABLE `Charge` ADD COLUMN `holdCapturedCents` INTEGER NOT NULL DEFAULT 0;

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

-- AddForeignKey
ALTER TABLE `PaymentHold` ADD CONSTRAINT `PaymentHold_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
