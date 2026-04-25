// @vitest-environment node
import { Queue, QueueEvents, type Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FetchInboxEmails } from "@/application/use-cases/email/FetchInboxEmails";
import { EmailMessage } from "@/domain/email-message/EmailMessage";
import {
  QUEUE_NAMES,
  buildGmailInboxSyncQueue,
  buildGmailInboxSyncWorker,
  type GmailInboxSyncJobResult,
} from "@/jobs";

const USER_ID = "user-test-1";

let redis: Redis;
let queue: Queue;
let queueEvents: QueueEvents;
let worker: Worker | null = null;

beforeAll(async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL no está definida (¿.env.test?)");
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  queue = buildGmailInboxSyncQueue(redis);
  queueEvents = new QueueEvents(QUEUE_NAMES.GMAIL_INBOX_SYNC, { connection: redis });
  await queueEvents.waitUntilReady();
});

afterAll(async () => {
  await worker?.close();
  await queueEvents.close();
  await queue.close();
  await redis.quit();
});

beforeEach(async () => {
  await queue.obliterate({ force: true }).catch(() => undefined);
});

function makeEmail(messageIdHeader: string): EmailMessage {
  return EmailMessage.create({
    id: messageIdHeader,
    messageIdHeader,
    threadId: "thread-1",
    subject: "Subject",
    fromEmail: "alice@example.com",
    fromName: "Alice",
    toEmails: ["me@gmail.com"],
    snippet: "snippet",
    receivedAt: new Date(Date.now() - 60_000),
    bodyText: "body",
  });
}

describe("Worker gmail-inbox-sync (integration con BullMQ + Redis reales)", () => {
  it("happy path: procesa job, devuelve count + integrationId", async () => {
    const fakeFetchInboxEmails = {
      execute: vi.fn(async () => ({
        emails: [makeEmail("<a@x.com>"), makeEmail("<b@x.com>")],
        integrationId: "integration-123",
      })),
    } as unknown as FetchInboxEmails;

    worker = buildGmailInboxSyncWorker({
      fetchInboxEmails: fakeFetchInboxEmails,
      connection: redis,
    });
    await worker.waitUntilReady();

    const job = await queue.add("sync-test", {
      userId: USER_ID,
      sinceISO: null,
    });

    const rawResult = await job.waitUntilFinished(queueEvents, 10_000);
    const result = rawResult as GmailInboxSyncJobResult;

    expect(result.count).toBe(2);
    expect(result.integrationId).toBe("integration-123");
    expect(fakeFetchInboxEmails.execute).toHaveBeenCalledWith({
      userId: USER_ID,
      since: undefined,
    });

    await worker.close();
    worker = null;
  });

  it("propaga sinceISO como Date al use case", async () => {
    const sinceISO = "2026-04-24T08:00:00.000Z";
    const fakeFetchInboxEmails = {
      execute: vi.fn(async () => ({
        emails: [],
        integrationId: "i",
      })),
    } as unknown as FetchInboxEmails;

    worker = buildGmailInboxSyncWorker({
      fetchInboxEmails: fakeFetchInboxEmails,
      connection: redis,
    });
    await worker.waitUntilReady();

    const job = await queue.add("sync-since", { userId: USER_ID, sinceISO });
    await job.waitUntilFinished(queueEvents, 10_000);

    expect(fakeFetchInboxEmails.execute).toHaveBeenCalledWith({
      userId: USER_ID,
      since: new Date(sinceISO),
    });

    await worker.close();
    worker = null;
  });

  it("count=0 cuando el use case devuelve emails vacíos", async () => {
    const fakeFetchInboxEmails = {
      execute: vi.fn(async () => ({
        emails: [],
        integrationId: "empty",
      })),
    } as unknown as FetchInboxEmails;

    worker = buildGmailInboxSyncWorker({
      fetchInboxEmails: fakeFetchInboxEmails,
      connection: redis,
    });
    await worker.waitUntilReady();

    const job = await queue.add("sync-empty", {
      userId: USER_ID,
      sinceISO: null,
    });
    const rawResult = await job.waitUntilFinished(queueEvents, 10_000);
    const result = rawResult as GmailInboxSyncJobResult;

    expect(result.count).toBe(0);
    expect(result.integrationId).toBe("empty");

    await worker.close();
    worker = null;
  });
});
