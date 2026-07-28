-- AlterTable
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "previousStartTime" TIMESTAMP(3);
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "rescheduledAt" TIMESTAMP(3);
