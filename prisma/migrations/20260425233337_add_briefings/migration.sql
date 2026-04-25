-- CreateTable
CREATE TABLE "briefings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "emails_considered" INTEGER NOT NULL,
    "emails_truncated" INTEGER NOT NULL,
    "tokens_used_input" INTEGER NOT NULL,
    "tokens_used_output" INTEGER NOT NULL,
    "model_used" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "briefings_user_id_created_at_idx" ON "briefings"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
