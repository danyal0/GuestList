-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "shadowBannedAt" TIMESTAMP(3);
