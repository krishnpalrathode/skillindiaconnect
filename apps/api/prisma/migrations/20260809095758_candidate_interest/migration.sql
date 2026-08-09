-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EMPLOYER_INTERESTED';

-- CreateTable
CREATE TABLE "candidate_interests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "candidate_interests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_interests_companyId_createdAt_idx" ON "candidate_interests"("companyId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "candidate_interests_companyId_candidateId_key" ON "candidate_interests"("companyId", "candidateId");

-- AddForeignKey
ALTER TABLE "candidate_interests" ADD CONSTRAINT "candidate_interests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_interests" ADD CONSTRAINT "candidate_interests_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
