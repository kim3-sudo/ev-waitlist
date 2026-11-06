-- Time-of-day rates, rate calculator inputs, pre-authorization holds. Only additions.

-- AlterTable
ALTER TABLE "PaymentSettings" ADD COLUMN "rateSchedule" TEXT;
ALTER TABLE "PaymentSettings" ADD COLUMN "referencePowerKw" REAL;
ALTER TABLE "PaymentSettings" ADD COLUMN "rateCalculatorInputs" TEXT;
ALTER TABLE "PaymentSettings" ADD COLUMN "preauthCents" INTEGER;

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN "holdCapturedCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentHold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "payerName" TEXT,
    "payerContact" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING',
    "provider" TEXT,
    "sessionRef" TEXT,
    "providerRef" TEXT,
    "transactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentHold_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentHold_token_key" ON "PaymentHold"("token");

-- CreateIndex
CREATE INDEX "PaymentHold_tenantId_idx" ON "PaymentHold"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentHold_tenantId_idTag_idx" ON "PaymentHold"("tenantId", "idTag");
