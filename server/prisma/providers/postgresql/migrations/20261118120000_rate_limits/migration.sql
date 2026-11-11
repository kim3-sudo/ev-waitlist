-- CreateTable
CREATE TABLE "RateLimitSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "rules" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitSettings_pkey" PRIMARY KEY ("id")
);
