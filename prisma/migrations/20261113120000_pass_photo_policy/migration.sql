-- AlterTable
ALTER TABLE "Pass" ADD COLUMN     "photoKey" TEXT;

-- AlterTable
ALTER TABLE "VisitPolicy" ADD COLUMN     "requiresPhoto" BOOLEAN NOT NULL DEFAULT false;

