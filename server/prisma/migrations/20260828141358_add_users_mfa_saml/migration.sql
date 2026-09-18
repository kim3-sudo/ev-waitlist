-- CreateTable
CREATE TABLE "SamlConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "idpEntityId" TEXT,
    "idpSsoUrl" TEXT,
    "idpCertificate" TEXT,
    "autoProvision" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Admin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Admin" ("createdAt", "email", "id", "passwordHash") SELECT "createdAt", "email", "id", "passwordHash" FROM "Admin";
DROP TABLE "Admin";
ALTER TABLE "new_Admin" RENAME TO "Admin";
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL DEFAULT 'EV Waitlist',
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0d7a5f',
    "secondaryColor" TEXT NOT NULL DEFAULT '#1565c0',
    "fontFamily" TEXT,
    "identifierMode" TEXT NOT NULL DEFAULT 'LICENSE_PLATE',
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("companyName", "fontFamily", "id", "identifierMode", "logoUrl", "primaryColor", "secondaryColor", "updatedAt") SELECT "companyName", "fontFamily", "id", "identifierMode", "logoUrl", "primaryColor", "secondaryColor", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
