-- AlterTable
ALTER TABLE "contact_persons" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "purgedAt" TIMESTAMP(3);
