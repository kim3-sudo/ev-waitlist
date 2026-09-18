-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QueueEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "QueueEntry_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QueueEntry_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QueueEntry" ("contact", "createdAt", "id", "idTag", "licensePlate", "name", "parkingPermit", "position", "stationId", "status") SELECT "contact", "createdAt", "id", "idTag", "licensePlate", "name", "parkingPermit", "position", "stationId", "status" FROM "QueueEntry";
DROP TABLE "QueueEntry";
ALTER TABLE "new_QueueEntry" RENAME TO "QueueEntry";
CREATE TABLE "new_Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "model" TEXT,
    "location" TEXT,
    "zoneId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Station_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Station" ("createdAt", "id", "identity", "location", "model", "name", "updatedAt", "vendor") SELECT "createdAt", "id", "identity", "location", "model", "name", "updatedAt", "vendor" FROM "Station";
DROP TABLE "Station";
ALTER TABLE "new_Station" RENAME TO "Station";
CREATE UNIQUE INDEX "Station_identity_key" ON "Station"("identity");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Zone_name_key" ON "Zone"("name");
