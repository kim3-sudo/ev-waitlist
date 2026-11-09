-- CreateTable
CREATE TABLE "WalletCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "WalletCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WalletCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Admin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "walletTap" BOOLEAN NOT NULL DEFAULT false,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "model" TEXT,
    "location" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "hours" TEXT,
    "amenities" TEXT,
    "tips" TEXT,
    "parkingKeys" TEXT,
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
INSERT INTO "new_Station" ("amenities", "city", "configurationAt", "configurationJson", "country", "createdAt", "diagnosticsStatus", "firmwareStatus", "firmwareVersion", "hours", "id", "identity", "lastSeenAt", "latitude", "location", "longitude", "meterStatus", "model", "name", "offlineAlertSent", "offlineSince", "parkingKeys", "postalCode", "serialNumber", "tenantId", "tips", "updatedAt", "vendor", "zoneId") SELECT "amenities", "city", "configurationAt", "configurationJson", "country", "createdAt", "diagnosticsStatus", "firmwareStatus", "firmwareVersion", "hours", "id", "identity", "lastSeenAt", "latitude", "location", "longitude", "meterStatus", "model", "name", "offlineAlertSent", "offlineSince", "parkingKeys", "postalCode", "serialNumber", "tenantId", "tips", "updatedAt", "vendor", "zoneId" FROM "Station";
DROP TABLE "Station";
ALTER TABLE "new_Station" RENAME TO "Station";
CREATE UNIQUE INDEX "Station_identity_key" ON "Station"("identity");
CREATE INDEX "Station_tenantId_idx" ON "Station"("tenantId");
CREATE TABLE "new_QueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT,
    "zoneId" TEXT,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "accountId" TEXT,
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
    CONSTRAINT "QueueEntry_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QueueEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Admin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_QueueEntry" ("closedAt", "contact", "createdAt", "id", "idTag", "licensePlate", "name", "parkingPermit", "plateRegion", "position", "smsNumber", "stationId", "status", "tenantId", "zoneId") SELECT "closedAt", "contact", "createdAt", "id", "idTag", "licensePlate", "name", "parkingPermit", "plateRegion", "position", "smsNumber", "stationId", "status", "tenantId", "zoneId" FROM "QueueEntry";
DROP TABLE "QueueEntry";
ALTER TABLE "new_QueueEntry" RENAME TO "QueueEntry";
CREATE INDEX "QueueEntry_tenantId_idx" ON "QueueEntry"("tenantId");
CREATE INDEX "QueueEntry_accountId_idx" ON "QueueEntry"("accountId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WalletCredential_tenantId_accountId_idx" ON "WalletCredential"("tenantId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletCredential_tenantId_idTag_key" ON "WalletCredential"("tenantId", "idTag");

