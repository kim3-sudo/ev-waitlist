-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "name" TEXT NOT NULL DEFAULT '',
    "countryCode" TEXT NOT NULL DEFAULT '',
    "partyId" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roamingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "roamingTermsAcknowledgedAt" TIMESTAMP(3),
    "roamingTermsAcknowledgedBy" TEXT,
    "roamingTermsAcknowledgedVersion" TEXT,
    "roamingWarningExtra" TEXT,
    "queueRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "financialRetentionDays" INTEGER DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "tenantId" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "SamlConfig" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "idpEntityId" TEXT,
    "idpSsoUrl" TEXT,
    "idpCertificate" TEXT,
    "autoProvision" BOOLEAN NOT NULL DEFAULT false,
    "nameIdFormat" TEXT NOT NULL DEFAULT 'emailAddress',
    "groupAttribute" TEXT,
    "groupRoleMappings" TEXT NOT NULL DEFAULT '[]',
    "defaultRole" TEXT DEFAULT 'VIEWER',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamlConfig_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "model" TEXT,
    "location" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "serialNumber" TEXT,
    "firmwareVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "offlineSince" TIMESTAMP(3),
    "offlineAlertSent" BOOLEAN NOT NULL DEFAULT false,
    "firmwareStatus" TEXT,
    "diagnosticsStatus" TEXT,
    "meterStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "configurationJson" TEXT,
    "configurationAt" TIMESTAMP(3),
    "zoneId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "queueEntryId" TEXT,
    "idTag" TEXT,
    "note" TEXT,
    "createdByAdminId" TEXT,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "ocppReservationId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineCutterReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LineCutterReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "idTag" TEXT NOT NULL,
    "ocppTransactionId" INTEGER NOT NULL,
    "meterStart" INTEGER,
    "meterStop" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "partnerId" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdleEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "IdleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterSample" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "ocppTransactionId" INTEGER,
    "measurand" TEXT NOT NULL,
    "context" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeterSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSettings" (
    "tenantId" TEXT NOT NULL,
    "pricingModel" TEXT NOT NULL DEFAULT 'TIME',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timeBillingUnit" TEXT NOT NULL DEFAULT 'MINUTE',
    "ratePerMinuteCents" INTEGER NOT NULL DEFAULT 0,
    "peakRatePerMinuteCents" INTEGER,
    "peakStartHour" INTEGER,
    "peakEndHour" INTEGER,
    "ratePerKwhCents" INTEGER NOT NULL DEFAULT 0,
    "energyPricingAcknowledgedAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL DEFAULT 'NONE',
    "rateSchedule" TEXT,
    "referencePowerKw" DOUBLE PRECISION,
    "meterSampleSeconds" INTEGER NOT NULL DEFAULT 60,
    "meterToleranceWh" INTEGER NOT NULL DEFAULT 100,
    "meterTolerancePct" INTEGER NOT NULL DEFAULT 5,
    "meterMinSessionMinutes" INTEGER NOT NULL DEFAULT 2,
    "meterMaxJumpWh" INTEGER NOT NULL DEFAULT 50000,
    "rateCalculatorInputs" TEXT,
    "providerOutageMode" TEXT NOT NULL DEFAULT 'LOCKOUT',
    "preauthCents" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
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
    "pricingNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "holdCapturedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentHold" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "scope" TEXT NOT NULL,
    "stationId" TEXT,
    "location" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderOutage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderOutage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "zoneId" TEXT,
    "stationId" TEXT,
    "powerClass" TEXT,
    "percent" INTEGER,
    "label" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigValue" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigValue_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateTable
CREATE TABLE "OcpiPartner" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcpiPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcpiToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "whitelist" TEXT NOT NULL DEFAULT 'ALLOWED',
    "lastUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcpiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcpiOutbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcpiOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "smsBody" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "ServiceAccount_tenantId_name_key" ON "ServiceAccount"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");

-- CreateIndex
CREATE INDEX "ApiKey_serviceAccountId_idx" ON "ApiKey"("serviceAccountId");

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
CREATE INDEX "Alert_tenantId_idx" ON "Alert"("tenantId");

-- CreateIndex
CREATE INDEX "Alert_stationId_idx" ON "Alert"("stationId");

-- CreateIndex
CREATE INDEX "ProviderOutage_tenantId_endedAt_idx" ON "ProviderOutage"("tenantId", "endedAt");

-- CreateIndex
CREATE INDEX "PriceRule_tenantId_idx" ON "PriceRule"("tenantId");

-- CreateIndex
CREATE INDEX "PriceRule_stationId_idx" ON "PriceRule"("stationId");

-- CreateIndex
CREATE INDEX "PriceRule_zoneId_idx" ON "PriceRule"("zoneId");

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

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamlConfig" ADD CONSTRAINT "SamlConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineCutterReport" ADD CONSTRAINT "LineCutterReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineCutterReport" ADD CONSTRAINT "LineCutterReport_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineCutterReport" ADD CONSTRAINT "LineCutterReport_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdleEvent" ADD CONSTRAINT "IdleEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdleEvent" ADD CONSTRAINT "IdleEvent_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterSample" ADD CONSTRAINT "MeterSample_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterSample" ADD CONSTRAINT "MeterSample_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationEvent" ADD CONSTRAINT "StationEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationEvent" ADD CONSTRAINT "StationEvent_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRole" ADD CONSTRAINT "CustomRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAccount" ADD CONSTRAINT "ServiceAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettings" ADD CONSTRAINT "PaymentSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentHold" ADD CONSTRAINT "PaymentHold_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderOutage" ADD CONSTRAINT "ProviderOutage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigValue" ADD CONSTRAINT "ConfigValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcpiPartner" ADD CONSTRAINT "OcpiPartner_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcpiToken" ADD CONSTRAINT "OcpiToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcpiToken" ADD CONSTRAINT "OcpiToken_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "OcpiPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcpiOutbox" ADD CONSTRAINT "OcpiOutbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcpiOutbox" ADD CONSTRAINT "OcpiOutbox_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "OcpiPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "changes" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "exportedAt" TIMESTAMP(3),

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "ipLogging" TEXT NOT NULL DEFAULT 'TRUNCATED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_seq_key" ON "AuditEvent"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_hash_key" ON "AuditEvent"("hash");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_seq_idx" ON "AuditEvent"("tenantId", "seq");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");

-- CreateIndex
CREATE INDEX "AuditEvent_exportedAt_idx" ON "AuditEvent"("exportedAt");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
