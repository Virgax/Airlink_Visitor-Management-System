-- AlterEnum
ALTER TYPE "GateKind" ADD VALUE 'checkpoint';

-- AlterTable
ALTER TABLE "Pass" ADD COLUMN     "registeredAt" TIMESTAMP(3),
ADD COLUMN     "selfRegistration" BOOLEAN NOT NULL DEFAULT false;

