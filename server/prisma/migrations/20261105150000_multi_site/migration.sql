-- Multi-site support. Adds the operator singleton and sites (tenants), and
-- tenantId on every tenant-scoped table. All existing data moves into the default site.

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "name" TEXT NOT NULL DEFAULT '',
    "countryCode" TEXT NOT NULL DEFAULT '',
    "partyId" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roamingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "roamingTermsAcknowledgedAt" DATETIME,
    "roamingTermsAcknowledgedBy" TEXT,
    "roamingTermsAcknowledgedVersion" TEXT,
    "queueRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "financialRetentionDays" INTEGER DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);


-- Default site (id "default") and the installation's operator. Existing installs
-- take their branding name for both; fresh installs get blank names until setup.
INSERT INTO "Tenant" ("id", "slug", "name", "createdAt", "updatedAt")
SELECT 'default', 'default', COALESCE((SELECT "companyName" FROM "Settings" WHERE "id" = 'singleton'), 'Main site'), (CAST(strftime('%s','now') AS INTEGER) * 1000), (CAST(strftime('%s','now') AS INTEGER) * 1000);

INSERT INTO "Operator" ("id", "name", "countryCode", "partyId", "updatedAt")
SELECT 'singleton', COALESCE((SELECT "companyName" FROM "Settings" WHERE "id" = 'singleton'), ''), '', '', (CAST(strftime('%s','now') AS INTEGER) * 1000);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Admin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Admin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Admin" ("tenantId", "createdAt", "email", "id", "mfaEnabled", "mfaSecret", "mustChangePassword", "passwordHash", "role") SELECT 'default', "createdAt", "email", "id", "mfaEnabled", "mfaSecret", "mustChangePassword", "passwordHash", "role" FROM "Admin";
DROP TABLE "Admin";
ALTER TABLE "new_Admin" RENAME TO "Admin";
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");
CREATE INDEX "Admin_tenantId_idx" ON "Admin"("tenantId");
CREATE TABLE "new_Charge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "payerName" TEXT,
    "payerContact" TEXT,
    "pricingModel" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "energyWh" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerRef" TEXT,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Charge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Charge_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Charge_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Charge" ("tenantId", "amountCents", "createdAt", "currency", "durationSeconds", "energyWh", "id", "idTag", "paidAt", "payerContact", "payerName", "pricingModel", "provider", "providerRef", "stationId", "status", "token", "transactionId") SELECT 'default', "amountCents", "createdAt", "currency", "durationSeconds", "energyWh", "id", "idTag", "paidAt", "payerContact", "payerName", "pricingModel", "provider", "providerRef", "stationId", "status", "token", "transactionId" FROM "Charge";
DROP TABLE "Charge";
ALTER TABLE "new_Charge" RENAME TO "Charge";
CREATE UNIQUE INDEX "Charge_token_key" ON "Charge"("token");
CREATE UNIQUE INDEX "Charge_transactionId_key" ON "Charge"("transactionId");
CREATE INDEX "Charge_tenantId_idx" ON "Charge"("tenantId");
CREATE TABLE "new_ConfigValue" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("tenantId", "key"),
    CONSTRAINT "ConfigValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ConfigValue" ("tenantId", "key", "updatedAt", "value") SELECT 'default', "key", "updatedAt", "value" FROM "ConfigValue";
DROP TABLE "ConfigValue";
ALTER TABLE "new_ConfigValue" RENAME TO "ConfigValue";
CREATE TABLE "new_CustomRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CustomRole" ("tenantId", "createdAt", "description", "id", "name", "permissions", "updatedAt") SELECT 'default', "createdAt", "description", "id", "name", "permissions", "updatedAt" FROM "CustomRole";
DROP TABLE "CustomRole";
ALTER TABLE "new_CustomRole" RENAME TO "CustomRole";
CREATE UNIQUE INDEX "CustomRole_tenantId_name_key" ON "CustomRole"("tenantId", "name");
CREATE TABLE "new_IdleEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "IdleEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IdleEvent_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_IdleEvent" ("tenantId", "connectorId", "endedAt", "id", "startedAt", "stationId") SELECT 'default', "connectorId", "endedAt", "id", "startedAt", "stationId" FROM "IdleEvent";
DROP TABLE "IdleEvent";
ALTER TABLE "new_IdleEvent" RENAME TO "IdleEvent";
CREATE INDEX "IdleEvent_stationId_connectorId_endedAt_idx" ON "IdleEvent"("stationId", "connectorId", "endedAt");
CREATE INDEX "IdleEvent_tenantId_idx" ON "IdleEvent"("tenantId");
CREATE TABLE "new_LineCutterReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "LineCutterReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LineCutterReport_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineCutterReport_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LineCutterReport" ("tenantId", "createdAt", "id", "note", "queueEntryId", "resolvedAt", "stationId", "status") SELECT 'default', "createdAt", "id", "note", "queueEntryId", "resolvedAt", "stationId", "status" FROM "LineCutterReport";
DROP TABLE "LineCutterReport";
ALTER TABLE "new_LineCutterReport" RENAME TO "LineCutterReport";
CREATE INDEX "LineCutterReport_tenantId_idx" ON "LineCutterReport"("tenantId");
CREATE TABLE "new_PaymentSettings" (
    "tenantId" TEXT NOT NULL PRIMARY KEY,
    "pricingModel" TEXT NOT NULL DEFAULT 'TIME',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ratePerMinuteCents" INTEGER NOT NULL DEFAULT 0,
    "peakRatePerMinuteCents" INTEGER,
    "peakStartHour" INTEGER,
    "peakEndHour" INTEGER,
    "ratePerKwhCents" INTEGER NOT NULL DEFAULT 0,
    "energyPricingAcknowledgedAt" DATETIME,
    "provider" TEXT NOT NULL DEFAULT 'NONE',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PaymentSettings" ("tenantId", "currency", "energyPricingAcknowledgedAt", "peakEndHour", "peakRatePerMinuteCents", "peakStartHour", "pricingModel", "provider", "ratePerKwhCents", "ratePerMinuteCents", "updatedAt") SELECT 'default', "currency", "energyPricingAcknowledgedAt", "peakEndHour", "peakRatePerMinuteCents", "peakStartHour", "pricingModel", "provider", "ratePerKwhCents", "ratePerMinuteCents", "updatedAt" FROM "PaymentSettings" WHERE "id" = 'singleton';
DROP TABLE "PaymentSettings";
ALTER TABLE "new_PaymentSettings" RENAME TO "PaymentSettings";
CREATE TABLE "new_QueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT,
    "zoneId" TEXT,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "licensePlate" TEXT,
    "parkingPermit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QueueEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QueueEntry_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QueueEntry_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QueueEntry" ("tenantId", "contact", "createdAt", "id", "idTag", "licensePlate", "name", "parkingPermit", "position", "stationId", "status", "zoneId") SELECT 'default', "contact", "createdAt", "id", "idTag", "licensePlate", "name", "parkingPermit", "position", "stationId", "status", "zoneId" FROM "QueueEntry";
DROP TABLE "QueueEntry";
ALTER TABLE "new_QueueEntry" RENAME TO "QueueEntry";
CREATE INDEX "QueueEntry_tenantId_idx" ON "QueueEntry"("tenantId");
CREATE TABLE "new_Reservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "ocppReservationId" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reservation_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reservation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Reservation" ("tenantId", "connectorId", "createdAt", "expiresAt", "id", "ocppReservationId", "queueEntryId", "stationId", "status") SELECT 'default', "connectorId", "createdAt", "expiresAt", "id", "ocppReservationId", "queueEntryId", "stationId", "status" FROM "Reservation";
DROP TABLE "Reservation";
ALTER TABLE "new_Reservation" RENAME TO "Reservation";
CREATE UNIQUE INDEX "Reservation_queueEntryId_key" ON "Reservation"("queueEntryId");
CREATE INDEX "Reservation_tenantId_idx" ON "Reservation"("tenantId");
CREATE TABLE "new_SamlConfig" (
    "tenantId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "idpEntityId" TEXT,
    "idpSsoUrl" TEXT,
    "idpCertificate" TEXT,
    "autoProvision" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SamlConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SamlConfig" ("tenantId", "autoProvision", "enabled", "idpCertificate", "idpEntityId", "idpSsoUrl", "updatedAt") SELECT 'default', "autoProvision", "enabled", "idpCertificate", "idpEntityId", "idpSsoUrl", "updatedAt" FROM "SamlConfig" WHERE "id" = 'singleton';
DROP TABLE "SamlConfig";
ALTER TABLE "new_SamlConfig" RENAME TO "SamlConfig";
CREATE TABLE "new_Settings" (
    "tenantId" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL DEFAULT 'EV Waitlist',
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0d7a5f',
    "secondaryColor" TEXT NOT NULL DEFAULT '#1565c0',
    "fontFamily" TEXT,
    "identifierMode" TEXT NOT NULL DEFAULT 'LICENSE_PLATE',
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Settings" ("tenantId", "companyName", "fontFamily", "identifierMode", "logoUrl", "mfaRequired", "primaryColor", "secondaryColor", "setupCompleted", "updatedAt") SELECT 'default', "companyName", "fontFamily", "identifierMode", "logoUrl", "mfaRequired", "primaryColor", "secondaryColor", "setupCompleted", "updatedAt" FROM "Settings" WHERE "id" = 'singleton';
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE TABLE "new_Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "model" TEXT,
    "location" TEXT,
    "zoneId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Station_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Station_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Station" ("tenantId", "createdAt", "id", "identity", "location", "model", "name", "updatedAt", "vendor", "zoneId") SELECT 'default', "createdAt", "id", "identity", "location", "model", "name", "updatedAt", "vendor", "zoneId" FROM "Station";
DROP TABLE "Station";
ALTER TABLE "new_Station" RENAME TO "Station";
CREATE UNIQUE INDEX "Station_identity_key" ON "Station"("identity");
CREATE INDEX "Station_tenantId_idx" ON "Station"("tenantId");
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "idTag" TEXT NOT NULL,
    "ocppTransactionId" INTEGER NOT NULL,
    "meterStart" INTEGER,
    "meterStop" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" DATETIME,
    CONSTRAINT "Transaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("tenantId", "connectorId", "id", "idTag", "meterStart", "meterStop", "ocppTransactionId", "startedAt", "stationId", "stoppedAt") SELECT 'default', "connectorId", "id", "idTag", "meterStart", "meterStop", "ocppTransactionId", "startedAt", "stationId", "stoppedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_tenantId_idx" ON "Transaction"("tenantId");
CREATE TABLE "new_Zone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Zone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Zone" ("tenantId", "createdAt", "id", "name") SELECT 'default', "createdAt", "id", "name" FROM "Zone";
DROP TABLE "Zone";
ALTER TABLE "new_Zone" RENAME TO "Zone";
CREATE UNIQUE INDEX "Zone_tenantId_name_key" ON "Zone"("tenantId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

