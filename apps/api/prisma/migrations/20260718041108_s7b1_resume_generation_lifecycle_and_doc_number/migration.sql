-- CreateEnum
CREATE TYPE "ResumeGenerationStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "candidate_documents" ADD COLUMN     "documentNumber" VARCHAR(50);

-- AlterTable
ALTER TABLE "resume_generations" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ResumeGenerationStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "contentHash" DROP NOT NULL,
ALTER COLUMN "r2Key" DROP NOT NULL,
ALTER COLUMN "sizeBytes" DROP NOT NULL;
