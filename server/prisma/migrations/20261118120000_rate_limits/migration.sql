-- CreateTable
CREATE TABLE "RateLimitSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "rules" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);
