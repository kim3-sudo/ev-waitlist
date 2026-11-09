-- AlterTable
ALTER TABLE "Admin" ADD COLUMN "name" TEXT,
ADD COLUMN "phone" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "waitlistContactRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "driverAccounts" TEXT NOT NULL DEFAULT 'OPTIONAL';

-- CreateTable
CREATE TABLE "DriverVehicle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "licensePlate" TEXT,
    "plugs" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverSignInCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverSignInCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverVehicle_ownerId_idx" ON "DriverVehicle"("ownerId");

-- CreateIndex
CREATE INDEX "DriverSignInCode_tenantId_email_idx" ON "DriverSignInCode"("tenantId", "email");

-- AddForeignKey
ALTER TABLE "DriverVehicle" ADD CONSTRAINT "DriverVehicle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverVehicle" ADD CONSTRAINT "DriverVehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverSignInCode" ADD CONSTRAINT "DriverSignInCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
