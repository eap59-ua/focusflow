-- AlterTable
ALTER TABLE "users" ADD COLUMN     "briefing_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "briefing_hour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "briefing_timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid';
