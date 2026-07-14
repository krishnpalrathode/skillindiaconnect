/*
  Warnings:

  - You are about to alter the column `body` on the `application_notes` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(2000)`.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'JOB_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_REJECTED';

-- AlterTable
ALTER TABLE "application_notes" ADD COLUMN     "authorRole" "UserRole",
ALTER COLUMN "body" SET DATA TYPE VARCHAR(2000);

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "moderatedAt" TIMESTAMP(3),
ADD COLUMN     "moderatedById" TEXT,
ADD COLUMN     "moderationReason" VARCHAR(500);

-- CreateIndex
CREATE INDEX "application_notes_applicationId_createdAt_idx" ON "application_notes"("applicationId", "createdAt");
