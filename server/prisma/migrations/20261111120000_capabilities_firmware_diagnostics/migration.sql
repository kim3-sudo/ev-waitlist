-- CreateTable
CREATE TABLE "FirmwarePackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "vendor" TEXT,
    "model" TEXT,
    "notes" TEXT,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FirmwarePackage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiagnosticsLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "tokenHash" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "uploadedAt" DATETIME,
    "fileName" TEXT,
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    CONSTRAINT "DiagnosticsLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DiagnosticsLog_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "walletTap" BOOLEAN NOT NULL DEFAULT false,
    "smartChargingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "firmwareUpdateEnabled" BOOLEAN NOT NULL DEFAULT false,
    "localListEnabled" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_Station" ("amenities", "city", "configurationAt", "configurationJson", "country", "createdAt", "diagnosticsStatus", "firmwareStatus", "firmwareVersion", "hours", "id", "identity", "lastSeenAt", "latitude", "location", "longitude", "meterStatus", "model", "name", "offlineAlertSent", "offlineSince", "parkingKeys", "postalCode", "serialNumber", "tenantId", "tips", "updatedAt", "vendor", "walletTap", "zoneId") SELECT "amenities", "city", "configurationAt", "configurationJson", "country", "createdAt", "diagnosticsStatus", "firmwareStatus", "firmwareVersion", "hours", "id", "identity", "lastSeenAt", "latitude", "location", "longitude", "meterStatus", "model", "name", "offlineAlertSent", "offlineSince", "parkingKeys", "postalCode", "serialNumber", "tenantId", "tips", "updatedAt", "vendor", "walletTap", "zoneId" FROM "Station";
DROP TABLE "Station";
ALTER TABLE "new_Station" RENAME TO "Station";
CREATE UNIQUE INDEX "Station_identity_key" ON "Station"("identity");
CREATE INDEX "Station_tenantId_idx" ON "Station"("tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "FirmwarePackage_storageKey_key" ON "FirmwarePackage"("storageKey");

-- CreateIndex
CREATE INDEX "FirmwarePackage_tenantId_idx" ON "FirmwarePackage"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticsLog_tokenHash_key" ON "DiagnosticsLog"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticsLog_storageKey_key" ON "DiagnosticsLog"("storageKey");

-- CreateIndex
CREATE INDEX "DiagnosticsLog_tenantId_idx" ON "DiagnosticsLog"("tenantId");

-- CreateIndex
CREATE INDEX "DiagnosticsLog_stationId_idx" ON "DiagnosticsLog"("stationId");

