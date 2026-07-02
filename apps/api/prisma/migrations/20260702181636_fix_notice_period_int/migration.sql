/*
  Warnings:

  - The `noticePeriod` column on the `candidate_profiles` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "candidate_profiles" DROP COLUMN "noticePeriod",
ADD COLUMN     "noticePeriod" INTEGER;
