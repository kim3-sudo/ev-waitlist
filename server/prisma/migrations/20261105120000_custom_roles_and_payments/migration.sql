-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PaymentSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pricingModel" TEXT NOT NULL DEFAULT 'TIME',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ratePerMinuteCents" INTEGER NOT NULL DEFAULT 0,
    "peakRatePerMinuteCents" INTEGER,
    "peakStartHour" INTEGER,
    "peakEndHour" INTEGER,
    "ratePerKwhCents" INTEGER NOT NULL DEFAULT 0,
    "energyPricingAcknowledgedAt" DATETIME,
    "provider" TEXT NOT NULL DEFAULT 'NONE',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Charge_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Charge_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_name_key" ON "CustomRole"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_token_key" ON "Charge"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_transactionId_key" ON "Charge"("transactionId");
