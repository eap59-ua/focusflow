-- CreateTable
CREATE TABLE "gmail_integrations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "google_account_email" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "token_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "connected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_refreshed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gmail_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gmail_integrations_user_id_key" ON "gmail_integrations"("user_id");

-- AddForeignKey
ALTER TABLE "gmail_integrations" ADD CONSTRAINT "gmail_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
