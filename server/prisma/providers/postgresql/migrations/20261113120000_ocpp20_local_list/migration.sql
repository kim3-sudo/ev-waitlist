-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "ocppTransactionRef" TEXT;

-- CreateTable
CREATE TABLE "LocalListEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocalListEntry_tenantId_idTag_key" ON "LocalListEntry"("tenantId", "idTag");

-- AddForeignKey
ALTER TABLE "LocalListEntry" ADD CONSTRAINT "LocalListEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

