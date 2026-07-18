-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RESUME_READY';

-- AlterTable
ALTER TABLE "resume_generations" ADD COLUMN     "viewSnapshot" JSONB;
