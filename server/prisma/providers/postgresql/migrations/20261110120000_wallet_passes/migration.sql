-- AlterTable
ALTER TABLE "Station" ADD COLUMN     "walletTap" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN     "accountId" TEXT;

-- CreateTable
CREATE TABLE "WalletCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "WalletCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletCredential_tenantId_accountId_idx" ON "WalletCredential"("tenantId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletCredential_tenantId_idTag_key" ON "WalletCredential"("tenantId", "idTag");

-- CreateIndex
CREATE INDEX "QueueEntry_accountId_idx" ON "QueueEntry"("accountId");

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletCredential" ADD CONSTRAINT "WalletCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletCredential" ADD CONSTRAINT "WalletCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

