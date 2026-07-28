-- AlterTable
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "whatsappLid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_whatsappLid_key" ON "users"("whatsappLid");
