-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT 'EV Waitlist',
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0d7a5f',
    "secondaryColor" TEXT NOT NULL DEFAULT '#1565c0',
    "fontFamily" TEXT,
    "identifierMode" TEXT NOT NULL DEFAULT 'LICENSE_PLATE',
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamlConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "idpEntityId" TEXT,
    "idpSsoUrl" TEXT,
    "idpCertificate" TEXT,
    "autoProvision" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamlConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "model" TEXT,
    "location" TEXT,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "stationId" TEXT,
    "zoneId" TEXT,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "licensePlate" TEXT,
    "parkingPermit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
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
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "idTag" TEXT NOT NULL,
    "ocppTransactionId" INTEGER NOT NULL,
    "meterStart" INTEGER,
    "meterStop" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdleEvent" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "IdleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSettings" (
    "id" TEXT NOT NULL,
    "pricingModel" TEXT NOT NULL DEFAULT 'TIME',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ratePerMinuteCents" INTEGER NOT NULL DEFAULT 0,
    "peakRatePerMinuteCents" INTEGER,
    "peakStartHour" INTEGER,
    "peakEndHour" INTEGER,
    "ratePerKwhCents" INTEGER NOT NULL DEFAULT 0,
    "energyPricingAcknowledgedAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL DEFAULT 'NONE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
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
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigValue" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigValue_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_name_key" ON "Zone"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Station_identity_key" ON "Station"("identity");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_stationId_connectorId_key" ON "Connector"("stationId", "connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_queueEntryId_key" ON "Reservation"("queueEntryId");

-- CreateIndex
CREATE INDEX "IdleEvent_stationId_connectorId_endedAt_idx" ON "IdleEvent"("stationId", "connectorId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_name_key" ON "CustomRole"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_token_key" ON "Charge"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_transactionId_key" ON "Charge"("transactionId");

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineCutterReport" ADD CONSTRAINT "LineCutterReport_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineCutterReport" ADD CONSTRAINT "LineCutterReport_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdleEvent" ADD CONSTRAINT "IdleEvent_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

