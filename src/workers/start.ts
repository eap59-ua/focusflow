import type { Worker } from "bullmq";

import { getPrismaClient, getRedisClient } from "@/infrastructure/clients";
import { buildContainer } from "@/infrastructure/container";
import {
  buildBriefingTriggerWorker,
  buildGenerateBriefingWorker,
  buildGmailInboxSyncWorker,
  buildSendBriefingEmailWorker,
} from "@/jobs";

async function main(): Promise<void> {
  if (process.env.SCHEDULER_ENABLED === "false") {
    console.log("[workers] SCHEDULER_ENABLED=false, exiting.");
    process.exit(0);
  }

  const prisma = getPrismaClient();
  const redis = getRedisClient();
  const container = buildContainer({ prisma, redis });

  const workers: Worker[] = [
    buildGmailInboxSyncWorker({
      fetchInboxEmails: container.fetchInboxEmails,
      connection: redis,
    }),
    buildGenerateBriefingWorker({
      generateBriefing: container.generateBriefing,
      connection: redis,
    }),
    buildSendBriefingEmailWorker({
      sendBriefingEmail: container.sendBriefingEmail,
      connection: redis,
    }),
    buildBriefingTriggerWorker({
      triggerBriefingForUser: container.triggerBriefingForUser,
      connection: redis,
    }),
  ];

  await Promise.all(workers.map((w) => w.waitUntilReady()));

  const { scheduledCount } = await container.scheduleAllActiveBriefings.execute();
  console.log(
    `[workers] ${workers.length} workers running. ${scheduledCount} users con briefing programado. SIGINT para detener.`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[workers] ${signal} recibido, cerrando workers...`);
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((err: unknown) => {
  console.error("[workers] startup failed:", err);
  process.exit(1);
});
