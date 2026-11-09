-- AlterTable
ALTER TABLE `Station` ADD COLUMN `walletTap` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `QueueEntry` ADD COLUMN `accountId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `WalletCredential` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `idTag` VARCHAR(191) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    INDEX `WalletCredential_tenantId_accountId_idx`(`tenantId`, `accountId`),
    UNIQUE INDEX `WalletCredential_tenantId_idTag_key`(`tenantId`, `idTag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `QueueEntry_accountId_idx` ON `QueueEntry`(`accountId`);

-- AddForeignKey
ALTER TABLE `QueueEntry` ADD CONSTRAINT `QueueEntry_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WalletCredential` ADD CONSTRAINT `WalletCredential_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WalletCredential` ADD CONSTRAINT `WalletCredential_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Admin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

