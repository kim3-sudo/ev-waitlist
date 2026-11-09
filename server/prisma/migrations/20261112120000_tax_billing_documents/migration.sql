-- CreateTable
CREATE TABLE "BillingSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "receiptPrefix" TEXT NOT NULL DEFAULT 'RCP',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "footerText" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "rateBasisPoints" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'EXCLUSIVE',
    "appliesTo" TEXT NOT NULL DEFAULT 'ALL',
    "scope" TEXT NOT NULL DEFAULT 'SITE',
    "zoneId" TEXT,
    "stationId" TEXT,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaxRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingCustomer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INVOICE',
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "netCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "supplierSnapshot" TEXT NOT NULL,
    "customerSnapshot" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME,
    "paidAt" DATETIME,
    "creditsInvoiceId" TEXT,
    CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BillingCustomer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chargeId" TEXT,
    "netCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "taxJson" TEXT,
    CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "netCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "taxJson" TEXT,
    "payerName" TEXT,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Receipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "DocumentCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Charge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "payerName" TEXT,
    "payerContact" TEXT,
    "payerSmsNumber" TEXT,
    "pricingModel" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "netCents" INTEGER,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "taxJson" TEXT,
    "durationSeconds" INTEGER NOT NULL,
    "energyWh" INTEGER,
    "energySource" TEXT,
    "energyNote" TEXT,
    "pricingNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerRef" TEXT,
    "paidAt" DATETIME,
    "holdCapturedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Charge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Charge_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Charge_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Charge" ("amountCents", "createdAt", "currency", "durationSeconds", "energyNote", "energySource", "energyWh", "holdCapturedCents", "id", "idTag", "paidAt", "payerContact", "payerName", "payerSmsNumber", "pricingModel", "pricingNote", "provider", "providerRef", "stationId", "status", "tenantId", "token", "transactionId") SELECT "amountCents", "createdAt", "currency", "durationSeconds", "energyNote", "energySource", "energyWh", "holdCapturedCents", "id", "idTag", "paidAt", "payerContact", "payerName", "payerSmsNumber", "pricingModel", "pricingNote", "provider", "providerRef", "stationId", "status", "tenantId", "token", "transactionId" FROM "Charge";
DROP TABLE "Charge";
ALTER TABLE "new_Charge" RENAME TO "Charge";
CREATE UNIQUE INDEX "Charge_token_key" ON "Charge"("token");
CREATE UNIQUE INDEX "Charge_transactionId_key" ON "Charge"("transactionId");
CREATE INDEX "Charge_tenantId_idx" ON "Charge"("tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BillingSettings_tenantId_key" ON "BillingSettings"("tenantId");

-- CreateIndex
CREATE INDEX "TaxRule_tenantId_idx" ON "TaxRule"("tenantId");

-- CreateIndex
CREATE INDEX "BillingCustomer_tenantId_idx" ON "BillingCustomer"("tenantId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_chargeId_key" ON "InvoiceLine"("chargeId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_chargeId_key" ON "Receipt"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_tenantId_number_key" ON "Receipt"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCounter_tenantId_kind_key" ON "DocumentCounter"("tenantId", "kind");

