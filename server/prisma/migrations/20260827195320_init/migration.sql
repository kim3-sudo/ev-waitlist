-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "model" TEXT,
    "location" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Unavailable',
    "errorCode" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Connector_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QueueEntry_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "queueEntryId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "ocppReservationId" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reservation_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reservation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "idTag" TEXT NOT NULL,
    "ocppTransactionId" INTEGER NOT NULL,
    "meterStart" INTEGER,
    "meterStop" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" DATETIME,
    CONSTRAINT "Transaction_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Station_identity_key" ON "Station"("identity");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_stationId_connectorId_key" ON "Connector"("stationId", "connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_queueEntryId_key" ON "Reservation"("queueEntryId");
