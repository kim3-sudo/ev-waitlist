-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN "licensePlate" TEXT;
ALTER TABLE "QueueEntry" ADD COLUMN "parkingPermit" TEXT;

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL DEFAULT 'EV Waitlist',
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0d7a5f',
    "secondaryColor" TEXT NOT NULL DEFAULT '#1565c0',
    "fontFamily" TEXT,
    "identifierMode" TEXT NOT NULL DEFAULT 'LICENSE_PLATE',
    "updatedAt" DATETIME NOT NULL
);
