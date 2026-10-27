-- CreateTable
CREATE TABLE "SystemSecret" (
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSecret_pkey" PRIMARY KEY ("name")
);
