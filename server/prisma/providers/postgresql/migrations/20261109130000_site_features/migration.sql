-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "amenityKeys" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "parkingKeys" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "accessControlled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Station" ADD COLUMN "parkingKeys" TEXT;
