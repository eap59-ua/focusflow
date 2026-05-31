import { describe, expect, it, vi } from "vitest";

import {
  runGmailInboxSyncJob,
  type GmailInboxSyncJobData,
} from "@/jobs/workers/gmail-inbox-sync";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeJob(data: GmailInboxSyncJobData) {
  return {
    data,
    updateData: vi.fn(async () => undefined),
  };
}

describe("runGmailInboxSyncJob (zero-retention)", () => {
  it("happy path: devuelve emails serializados y NO wipea job.data", async () => {
    const job = makeJob({ userId: USER_ID, sinceISO: null });
    const fetchInboxEmails = {
      execute: vi.fn(async () => ({
        integrationId: "int-1",
        emails: [
          {
            id: "m1",
            subject: "hola",
            snippet: "s",
            bodyText: "cuerpo",
            fromEmail: "a@b.com",
            fromName: "A",
            toEmails: ["me@x.com"],
            messageIdHeader: "<m1@x.com>",
            threadId: "t",
            receivedAt: new Date("2026-05-01T08:00:00Z"),
          },
        ],
      })),
    };

    const result = await runGmailInboxSyncJob(
      job,
      fetchInboxEmails as unknown as Parameters<typeof runGmailInboxSyncJob>[1],
    );

    expect(result.count).toBe(1);
    expect(result.integrationId).toBe("int-1");
    expect(job.updateData).not.toHaveBeenCalled();
  });

  it("error: wipea job.data (sólo userId+sinceISO+_wiped) y re-lanza", async () => {
    const job = makeJob({ userId: USER_ID, sinceISO: "2026-05-01T00:00:00Z" });
    const boom = new Error("gmail 503");
    const fetchInboxEmails = {
      execute: vi.fn(async () => {
        throw boom;
      }),
    };

    await expect(
      runGmailInboxSyncJob(
        job,
        fetchInboxEmails as unknown as Parameters<
          typeof runGmailInboxSyncJob
        >[1],
      ),
    ).rejects.toBe(boom);

    expect(job.updateData).toHaveBeenCalledTimes(1);
    expect(job.updateData).toHaveBeenCalledWith({
      userId: USER_ID,
      sinceISO: "2026-05-01T00:00:00Z",
      _wiped: true,
    });
  });
});
