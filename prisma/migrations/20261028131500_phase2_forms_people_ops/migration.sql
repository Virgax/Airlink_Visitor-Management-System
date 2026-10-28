-- CreateEnum
CREATE TYPE "FrequentSignIn" AS ENUM ('qr_card', 'pin');

-- AlterEnum
ALTER TYPE "MembershipRole" ADD VALUE 'warden';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "pinHash" TEXT;

-- AlterTable
ALTER TABLE "Gate" ADD COLUMN     "selfSignInToken" TEXT,
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "NdaVersion" ADD COLUMN     "attachmentKey" TEXT;

-- AlterTable
ALTER TABLE "Pass" ADD COLUMN     "extra" JSONB,
ADD COLUMN     "pinHash" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "autoClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "badgePhotoKey" TEXT,
ADD COLUMN     "extra" JSONB;

-- AlterTable
ALTER TABLE "VisitPolicy" ADD COLUMN     "autoPrintBadge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoSignOutAt" TEXT,
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "form" JSONB,
ADD COLUMN     "formTemplateId" TEXT,
ADD COLUMN     "notifyEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "elements" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrequentVisitor" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT,
    "docHash" TEXT,
    "docLast4" TEXT,
    "phone" TEXT,
    "photoKey" TEXT,
    "signIn" "FrequentSignIn" NOT NULL DEFAULT 'qr_card',
    "pinHash" TEXT,
    "passId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrequentVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePresence" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "EmployeePresence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormTemplate_siteId_idx" ON "FormTemplate"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "FrequentVisitor_passId_key" ON "FrequentVisitor"("passId");

-- CreateIndex
CREATE INDEX "FrequentVisitor_siteId_active_idx" ON "FrequentVisitor"("siteId", "active");

-- CreateIndex
CREATE INDEX "FrequentVisitor_docHash_idx" ON "FrequentVisitor"("docHash");

-- CreateIndex
CREATE INDEX "EmployeePresence_siteId_leftAt_idx" ON "EmployeePresence"("siteId", "leftAt");

-- CreateIndex
CREATE INDEX "EmployeePresence_employeeId_enteredAt_idx" ON "EmployeePresence"("employeeId", "enteredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Gate_selfSignInToken_key" ON "Gate"("selfSignInToken");

-- AddForeignKey
ALTER TABLE "VisitPolicy" ADD CONSTRAINT "VisitPolicy_formTemplateId_fkey" FOREIGN KEY ("formTemplateId") REFERENCES "FormTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrequentVisitor" ADD CONSTRAINT "FrequentVisitor_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrequentVisitor" ADD CONSTRAINT "FrequentVisitor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrequentVisitor" ADD CONSTRAINT "FrequentVisitor_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrequentVisitor" ADD CONSTRAINT "FrequentVisitor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePresence" ADD CONSTRAINT "EmployeePresence_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePresence" ADD CONSTRAINT "EmployeePresence_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "Gate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePresence" ADD CONSTRAINT "EmployeePresence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

