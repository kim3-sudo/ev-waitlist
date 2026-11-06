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
    "roamingWarningExtra" TEXT,
    "queueRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "financialRetentionDays" INTEGER DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "samlNameId" TEXT,
    "passwordHash" TEXT,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "alertOnFault" BOOLEAN NOT NULL DEFAULT false,
    "alertOffline" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "instanceAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Admin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "tenantId" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL DEFAULT 'Plugyard',
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0d7a5f',
    "secondaryColor" TEXT NOT NULL DEFAULT '#1565c0',
    "fontFamily" TEXT,
    "plateRegions" TEXT,
    "defaultPlateRegion" TEXT,
    "identifierMode" TEXT NOT NULL DEFAULT 'LICENSE_PLATE',
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SamlConfig" (
    "tenantId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "idpEntityId" TEXT,
    "idpSsoUrl" TEXT,
    "idpCertificate" TEXT,
    "autoProvision" BOOLEAN NOT NULL DEFAULT false,
    "nameIdFormat" TEXT NOT NULL DEFAULT 'emailAddress',
    "groupAttribute" TEXT,
    "groupRoleMappings" TEXT NOT NULL DEFAULT '[]',
    "defaultRole" TEXT DEFAULT 'VIEWER',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SamlConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Zone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "model" TEXT,
    "location" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "serialNumber" TEXT,
    "firmwareVersion" TEXT,
    "lastSeenAt" DATETIME,
    "offlineSince" DATETIME,
    "offlineAlertSent" BOOLEAN NOT NULL DEFAULT false,
    "firmwareStatus" TEXT,
    "diagnosticsStatus" TEXT,
    "meterStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "configurationJson" TEXT,
    "configurationAt" DATETIME,
    "zoneId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Station_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Station_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Unavailable',
    "errorCode" TEXT,
    "standard" TEXT,
    "format" TEXT,
    "powerType" TEXT,
    "maxVoltage" INTEGER,
    "maxAmperage" INTEGER,
    "info" TEXT,
    "vendorErrorCode" TEXT,
    "operative" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Connector_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT,
    "zoneId" TEXT,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "smsNumber" TEXT,
    "idTag" TEXT NOT NULL,
    "licensePlate" TEXT,
    "plateRegion" TEXT,
    "parkingPermit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "QueueEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QueueEntry_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QueueEntry_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "queueEntryId" TEXT,
    "idTag" TEXT,
    "note" TEXT,
    "createdByAdminId" TEXT,
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

-- CreateTable
CREATE TABLE "LineCutterReport" (
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

-- CreateTable
CREATE TABLE "Transaction" (
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
    "stopReason" TEXT,
    "partnerId" TEXT,
    CONSTRAINT "Transaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdleEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "IdleEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IdleEvent_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MeterSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "ocppTransactionId" INTEGER,
    "measurand" TEXT NOT NULL,
    "context" TEXT,
    "value" REAL NOT NULL,
    "at" DATETIME NOT NULL,
    CONSTRAINT "MeterSample_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeterSample_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "actorId" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StationEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StationEvent_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentSettings" (
    "tenantId" TEXT NOT NULL PRIMARY KEY,
    "pricingModel" TEXT NOT NULL DEFAULT 'TIME',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timeBillingUnit" TEXT NOT NULL DEFAULT 'MINUTE',
    "ratePerMinuteCents" INTEGER NOT NULL DEFAULT 0,
    "peakRatePerMinuteCents" INTEGER,
    "peakStartHour" INTEGER,
    "peakEndHour" INTEGER,
    "ratePerKwhCents" INTEGER NOT NULL DEFAULT 0,
    "energyPricingAcknowledgedAt" DATETIME,
    "provider" TEXT NOT NULL DEFAULT 'NONE',
    "rateSchedule" TEXT,
    "referencePowerKw" REAL,
    "meterSampleSeconds" INTEGER NOT NULL DEFAULT 60,
    "meterToleranceWh" INTEGER NOT NULL DEFAULT 100,
    "meterTolerancePct" INTEGER NOT NULL DEFAULT 5,
    "meterMinSessionMinutes" INTEGER NOT NULL DEFAULT 2,
    "meterMaxJumpWh" INTEGER NOT NULL DEFAULT 50000,
    "rateCalculatorInputs" TEXT,
    "preauthCents" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Charge" (
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
    "durationSeconds" INTEGER NOT NULL,
    "energyWh" INTEGER,
    "energySource" TEXT,
    "energyNote" TEXT,
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

-- CreateTable
CREATE TABLE "ConfigValue" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("tenantId", "key"),
    CONSTRAINT "ConfigValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OcpiPartner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "registrationTokenHash" TEXT,
    "ourTokenHash" TEXT,
    "theirTokenEnc" TEXT,
    "theirVersionsUrl" TEXT,
    "theirCountryCode" TEXT,
    "theirPartyId" TEXT,
    "endpoints" TEXT NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OcpiPartner_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OcpiToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "whitelist" TEXT NOT NULL DEFAULT 'ALLOWED',
    "lastUpdated" DATETIME NOT NULL,
    CONSTRAINT "OcpiToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OcpiToken_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "OcpiPartner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OcpiOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OcpiOutbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OcpiOutbox_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "OcpiPartner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "smsBody" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MessageTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE INDEX "Admin_tenantId_idx" ON "Admin"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_tenantId_samlNameId_key" ON "Admin"("tenantId", "samlNameId");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_tenantId_name_key" ON "Zone"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Station_identity_key" ON "Station"("identity");

-- CreateIndex
CREATE INDEX "Station_tenantId_idx" ON "Station"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_stationId_connectorId_key" ON "Connector"("stationId", "connectorId");

-- CreateIndex
CREATE INDEX "QueueEntry_tenantId_idx" ON "QueueEntry"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_queueEntryId_key" ON "Reservation"("queueEntryId");

-- CreateIndex
CREATE INDEX "Reservation_tenantId_idx" ON "Reservation"("tenantId");

-- CreateIndex
CREATE INDEX "LineCutterReport_tenantId_idx" ON "LineCutterReport"("tenantId");

-- CreateIndex
CREATE INDEX "Transaction_tenantId_idx" ON "Transaction"("tenantId");

-- CreateIndex
CREATE INDEX "IdleEvent_stationId_connectorId_endedAt_idx" ON "IdleEvent"("stationId", "connectorId", "endedAt");

-- CreateIndex
CREATE INDEX "IdleEvent_tenantId_idx" ON "IdleEvent"("tenantId");

-- CreateIndex
CREATE INDEX "MeterSample_stationId_ocppTransactionId_idx" ON "MeterSample"("stationId", "ocppTransactionId");

-- CreateIndex
CREATE INDEX "MeterSample_stationId_connectorId_measurand_at_idx" ON "MeterSample"("stationId", "connectorId", "measurand", "at");

-- CreateIndex
CREATE INDEX "MeterSample_tenantId_idx" ON "MeterSample"("tenantId");

-- CreateIndex
CREATE INDEX "StationEvent_stationId_at_idx" ON "StationEvent"("stationId", "at");

-- CreateIndex
CREATE INDEX "StationEvent_tenantId_idx" ON "StationEvent"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_tenantId_name_key" ON "CustomRole"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_token_key" ON "Charge"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_transactionId_key" ON "Charge"("transactionId");

-- CreateIndex
CREATE INDEX "Charge_tenantId_idx" ON "Charge"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentHold_token_key" ON "PaymentHold"("token");

-- CreateIndex
CREATE INDEX "PaymentHold_tenantId_idx" ON "PaymentHold"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentHold_tenantId_idTag_idx" ON "PaymentHold"("tenantId", "idTag");

-- CreateIndex
CREATE UNIQUE INDEX "OcpiPartner_registrationTokenHash_key" ON "OcpiPartner"("registrationTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "OcpiPartner_ourTokenHash_key" ON "OcpiPartner"("ourTokenHash");

-- CreateIndex
CREATE INDEX "OcpiPartner_tenantId_idx" ON "OcpiPartner"("tenantId");

-- CreateIndex
CREATE INDEX "OcpiToken_tenantId_idx" ON "OcpiToken"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OcpiToken_partnerId_uid_key" ON "OcpiToken"("partnerId", "uid");

-- CreateIndex
CREATE INDEX "OcpiOutbox_status_nextAttemptAt_idx" ON "OcpiOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OcpiOutbox_tenantId_idx" ON "OcpiOutbox"("tenantId");

-- CreateIndex
CREATE INDEX "MessageTemplate_tenantId_idx" ON "MessageTemplate"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_tenantId_key_key" ON "MessageTemplate"("tenantId", "key");

