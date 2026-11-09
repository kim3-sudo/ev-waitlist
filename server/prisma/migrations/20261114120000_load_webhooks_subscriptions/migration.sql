-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT NOT NULL DEFAULT '*',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebhookEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    CONSTRAINT "WebhookDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyFeeCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubscriptionPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "driverName" TEXT,
    "billingCustomerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    "lastBilledPeriod" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Subscription_billingCustomerId_fkey" FOREIGN KEY ("billingCustomerId") REFERENCES "BillingCustomer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roamingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "roamingTermsAcknowledgedAt" DATETIME,
    "roamingTermsAcknowledgedBy" TEXT,
    "roamingTermsAcknowledgedVersion" TEXT,
    "roamingWarningExtra" TEXT,
    "loadBalancingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "siteCapacityKw" REAL,
    "queueRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "financialRetentionDays" INTEGER DEFAULT 30,
    "address" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "hours" TEXT,
    "amenities" TEXT,
    "amenityKeys" TEXT,
    "parkingKeys" TEXT,
    "accessControlled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Tenant" ("accessControlled", "address", "amenities", "amenityKeys", "city", "country", "createdAt", "financialRetentionDays", "hours", "id", "latitude", "longitude", "name", "parkingKeys", "postalCode", "queueRetentionDays", "roamingEnabled", "roamingTermsAcknowledgedAt", "roamingTermsAcknowledgedBy", "roamingTermsAcknowledgedVersion", "roamingWarningExtra", "slug", "updatedAt") SELECT "accessControlled", "address", "amenities", "amenityKeys", "city", "country", "createdAt", "financialRetentionDays", "hours", "id", "latitude", "longitude", "name", "parkingKeys", "postalCode", "queueRetentionDays", "roamingEnabled", "roamingTermsAcknowledgedAt", "roamingTermsAcknowledgedBy", "roamingTermsAcknowledgedVersion", "roamingWarningExtra", "slug", "updatedAt" FROM "Tenant";
DROP TABLE "Tenant";
ALTER TABLE "new_Tenant" RENAME TO "Tenant";
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
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
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "subscriptionId" TEXT,
    "reversedAt" DATETIME,
    "reversalReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Charge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Charge_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Charge_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Charge" ("amountCents", "createdAt", "currency", "durationSeconds", "energyNote", "energySource", "energyWh", "holdCapturedCents", "id", "idTag", "netCents", "paidAt", "payerContact", "payerName", "payerSmsNumber", "pricingModel", "pricingNote", "provider", "providerRef", "stationId", "status", "taxCents", "taxJson", "tenantId", "token", "transactionId") SELECT "amountCents", "createdAt", "currency", "durationSeconds", "energyNote", "energySource", "energyWh", "holdCapturedCents", "id", "idTag", "netCents", "paidAt", "payerContact", "payerName", "payerSmsNumber", "pricingModel", "pricingNote", "provider", "providerRef", "stationId", "status", "taxCents", "taxJson", "tenantId", "token", "transactionId" FROM "Charge";
DROP TABLE "Charge";
ALTER TABLE "new_Charge" RENAME TO "Charge";
CREATE UNIQUE INDEX "Charge_token_key" ON "Charge"("token");
CREATE UNIQUE INDEX "Charge_transactionId_key" ON "Charge"("transactionId");
CREATE INDEX "Charge_tenantId_idx" ON "Charge"("tenantId");
CREATE TABLE "new_BillingSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "receiptPrefix" TEXT NOT NULL DEFAULT 'RCP',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "footerText" TEXT,
    "emailReceipts" BOOLEAN NOT NULL DEFAULT false,
    "emailInvoices" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BillingSettings" ("address", "footerText", "id", "invoicePrefix", "legalName", "paymentTermsDays", "receiptPrefix", "taxId", "tenantId", "updatedAt") SELECT "address", "footerText", "id", "invoicePrefix", "legalName", "paymentTermsDays", "receiptPrefix", "taxId", "tenantId", "updatedAt" FROM "BillingSettings";
DROP TABLE "BillingSettings";
ALTER TABLE "new_BillingSettings" RENAME TO "BillingSettings";
CREATE UNIQUE INDEX "BillingSettings_tenantId_key" ON "BillingSettings"("tenantId");
CREATE TABLE "new_BillingCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "exemptionReference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingCustomer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BillingCustomer" ("address", "createdAt", "email", "id", "name", "notes", "taxId", "tenantId", "updatedAt") SELECT "address", "createdAt", "email", "id", "name", "notes", "taxId", "tenantId", "updatedAt" FROM "BillingCustomer";
DROP TABLE "BillingCustomer";
ALTER TABLE "new_BillingCustomer" RENAME TO "BillingCustomer";
CREATE INDEX "BillingCustomer_tenantId_idx" ON "BillingCustomer"("tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WebhookEndpoint_tenantId_idx" ON "WebhookEndpoint"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_idx" ON "WebhookDelivery"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_tenantId_idx" ON "SubscriptionPlan"("tenantId");

-- CreateIndex
CREATE INDEX "Subscription_tenantId_idx" ON "Subscription"("tenantId");

-- CreateIndex
CREATE INDEX "Subscription_idTag_idx" ON "Subscription"("idTag");

