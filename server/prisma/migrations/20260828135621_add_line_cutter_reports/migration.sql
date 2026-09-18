-- CreateTable
CREATE TABLE "LineCutterReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LineCutterReport_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineCutterReport_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
