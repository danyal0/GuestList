-- AlterTable
ALTER TABLE "users" ADD COLUMN "phone" TEXT;

-- AlterTable
ALTER TABLE "events" ADD COLUMN "whatsappMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "events_whatsappMessageId_key" ON "events"("whatsappMessageId");
