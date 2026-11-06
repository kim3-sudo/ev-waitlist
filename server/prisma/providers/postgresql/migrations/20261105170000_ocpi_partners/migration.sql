-- OCPI roaming: partners, their tokens, the outbox of messages to send, station coordinates, and the partner on roaming sessions. Only additions; existing data is unchanged.

-- AlterTable
ALTER TABLE "Station" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "partnerId" TEXT;

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

