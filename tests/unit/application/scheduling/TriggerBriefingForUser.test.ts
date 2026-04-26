import { describe, expect, it, vi } from "vitest";

import type { BriefingSchedulerPort } from "@/application/ports/BriefingSchedulerPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { TriggerBriefingForUser } from "@/application/use-cases/scheduling/TriggerBriefingForUser";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { UserNotFoundError } from "@/domain/user/errors/UserNotFoundError";

function makeUser() {
  return User.create({
    email: Email.create("u@x.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$h"),
    displayName: "U",
  });
}

describe("TriggerBriefingForUser use case", () => {
  it("happy path: delega en scheduler.triggerNow con el id del user", async () => {
    const user = makeUser();
    const triggerNow = vi.fn(async () => ({ flowId: "flow-123" }));
    const userRepo: UserRepositoryPort = {
      findByEmail: vi.fn(),
      findById: vi.fn(async () => user),
      findAllWithBriefingEnabled: vi.fn(),
      save: vi.fn(),
    };
    const scheduler: BriefingSchedulerPort = {
      scheduleForUser: vi.fn(),
      unscheduleForUser: vi.fn(),
      triggerNow,
    };

    const result = await new TriggerBriefingForUser({
      userRepo,
      scheduler,
    }).execute({ userId: user.id });

    expect(triggerNow).toHaveBeenCalledWith(user.id);
    expect(result.flowId).toBe("flow-123");
  });

  it("user no existe: UserNotFoundError, no llama al scheduler", async () => {
    const triggerNow = vi.fn(async () => ({ flowId: "x" }));
    const userRepo: UserRepositoryPort = {
      findByEmail: vi.fn(),
      findById: vi.fn(async () => null),
      findAllWithBriefingEnabled: vi.fn(),
      save: vi.fn(),
    };
    const scheduler: BriefingSchedulerPort = {
      scheduleForUser: vi.fn(),
      unscheduleForUser: vi.fn(),
      triggerNow,
    };

    await expect(
      new TriggerBriefingForUser({ userRepo, scheduler }).execute({
        userId: "missing",
      }),
    ).rejects.toBeInstanceOf(UserNotFoundError);

    expect(triggerNow).not.toHaveBeenCalled();
  });
});
