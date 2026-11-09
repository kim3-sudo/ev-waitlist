-- AlterTable
ALTER TABLE "Station" ADD COLUMN     "firmwareUpdateEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "localListEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smartChargingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FirmwarePackage" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirmwarePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticsLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "tokenHash" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "fileName" TEXT,
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,

    CONSTRAINT "DiagnosticsLog_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "FirmwarePackage" ADD CONSTRAINT "FirmwarePackage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticsLog" ADD CONSTRAINT "DiagnosticsLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticsLog" ADD CONSTRAINT "DiagnosticsLog_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

