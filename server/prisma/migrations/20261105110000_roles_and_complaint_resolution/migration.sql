-- AlterTable: existing accounts keep full access.
ALTER TABLE "Admin" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'ADMIN';

-- AlterTable
ALTER TABLE "LineCutterReport" ADD COLUMN "resolvedAt" DATETIME;
