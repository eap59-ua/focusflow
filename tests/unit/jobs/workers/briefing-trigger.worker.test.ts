import { describe, expect, it, vi } from "vitest";

import {
  runBriefingTriggerJob,
  type BriefingTriggerJobData,
} from "@/jobs/workers/briefing-trigger";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeJob(data: BriefingTriggerJobData) {
  return {
    data,
    updateData: vi.fn(async () => undefined),
  };
}

describe("runBriefingTriggerJob (zero-retention)", () => {
  it("happy path: devuelve flowId y NO wipea job.data", async () => {
    const job = makeJob({ userId: USER_ID });
    const triggerBriefingForUser = {
      execute: vi.fn(async () => ({ flowId: "flow-1" })),
    };

    const result = await runBriefingTriggerJob(
      job,
      triggerBriefingForUser as unknown as Parameters<
        typeof runBriefingTriggerJob
      >[1],
    );

    expect(result.flowId).toBe("flow-1");
    expect(job.updateData).not.toHaveBeenCalled();
  });

  it("error: wipea job.data (userId+_wiped) y re-lanza", async () => {
    const job = makeJob({ userId: USER_ID });
    const boom = new Error("trigger failed");
    const triggerBriefingForUser = {
      execute: vi.fn(async () => {
        throw boom;
      }),
    };

    await expect(
      runBriefingTriggerJob(
        job,
        triggerBriefingForUser as unknown as Parameters<
          typeof runBriefingTriggerJob
        >[1],
      ),
    ).rejects.toBe(boom);

    expect(job.updateData).toHaveBeenCalledTimes(1);
    expect(job.updateData).toHaveBeenCalledWith({
      userId: USER_ID,
      _wiped: true,
    });
  });
});
