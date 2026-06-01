import { describe, expect, it, vi } from "vitest";

import {
  runGenerateBriefingJob,
  type GenerateBriefingJobData,
} from "@/jobs/workers/generate-briefing";

const USER_ID = "00000000-0000-0000-0000-000000000001";

const SENSITIVE_EMAILS = [
  {
    id: "m1",
    subject: "Asunto confidencial",
    snippet: "snippet privado",
    bodyText: "cuerpo del email con datos sensibles",
    fromEmail: "a@b.com",
    fromName: "A",
    toEmails: ["me@x.com"],
    messageIdHeader: "<m1@x.com>",
    threadId: "t",
    receivedAtISO: "2026-05-01T08:00:00Z",
  },
] as unknown as GenerateBriefingJobData["emails"];

function makeJob(data: GenerateBriefingJobData) {
  return {
    data,
    updateData: vi.fn(async (_data: GenerateBriefingJobData) => undefined),
    getChildrenValues: vi.fn(async () => ({})),
  };
}

describe("runGenerateBriefingJob (zero-retention)", () => {
  it("happy path: genera briefing y NO wipea job.data", async () => {
    const job = makeJob({ userId: USER_ID, emails: [] });
    const generateBriefing = {
      execute: vi.fn(async () => ({ briefingId: "b-1" })),
    };

    const result = await runGenerateBriefingJob(
      job,
      generateBriefing as unknown as Parameters<
        typeof runGenerateBriefingJob
      >[1],
    );

    expect(result.briefingId).toBe("b-1");
    expect(job.updateData).not.toHaveBeenCalled();
  });

  it("error: wipea job.data dejando FUERA los emails (bodyText) y re-lanza", async () => {
    const job = makeJob({ userId: USER_ID, emails: SENSITIVE_EMAILS });
    const boom = new Error("openai 500");
    const generateBriefing = {
      execute: vi.fn(async () => {
        throw boom;
      }),
    };

    await expect(
      runGenerateBriefingJob(
        job,
        generateBriefing as unknown as Parameters<
          typeof runGenerateBriefingJob
        >[1],
      ),
    ).rejects.toBe(boom);

    expect(job.updateData).toHaveBeenCalledTimes(1);
    const wiped = job.updateData.mock.calls[0]![0];
    expect(wiped).toEqual({ userId: USER_ID, _wiped: true });
    // Garantía explícita: el contenido sensible NO viaja en el payload wipeado.
    expect("emails" in wiped).toBe(false);
    expect(JSON.stringify(wiped)).not.toContain("bodyText");
    expect(JSON.stringify(wiped)).not.toContain("sensibles");
  });
});
