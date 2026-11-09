-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "address" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "amenities" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "city" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "country" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "hours" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "latitude" REAL;
ALTER TABLE "Tenant" ADD COLUMN "longitude" REAL;
ALTER TABLE "Tenant" ADD COLUMN "postalCode" TEXT;

-- AlterTable
ALTER TABLE "Station" ADD COLUMN "amenities" TEXT;
ALTER TABLE "Station" ADD COLUMN "city" TEXT;
ALTER TABLE "Station" ADD COLUMN "country" TEXT;
ALTER TABLE "Station" ADD COLUMN "hours" TEXT;
ALTER TABLE "Station" ADD COLUMN "postalCode" TEXT;

