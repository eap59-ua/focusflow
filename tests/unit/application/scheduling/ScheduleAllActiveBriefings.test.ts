import { describe, expect, it, vi } from "vitest";

import type { BriefingSchedulerPort } from "@/application/ports/BriefingSchedulerPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { ScheduleAllActiveBriefings } from "@/application/use-cases/scheduling/ScheduleAllActiveBriefings";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";

function makeUser(name: string) {
  return User.create({
    email: Email.create(`${name}@x.com`),
    hashedPassword: HashedPassword.fromHash("$2a$10$h"),
    displayName: name,
  }).enableBriefing(8, "UTC");
}

describe("ScheduleAllActiveBriefings use case", () => {
  it("programa cada user con briefingEnabled y devuelve el conteo", async () => {
    const users = [makeUser("a"), makeUser("b"), makeUser("c")];
    const findAll = vi.fn(async (): Promise<readonly User[]> => users);
    const schedule = vi.fn(async (_: User): Promise<void> => undefined);

    const userRepo: UserRepositoryPort = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      findAllWithBriefingEnabled: findAll,
      save: vi.fn(),
    };
    const scheduler: BriefingSchedulerPort = {
      scheduleForUser: schedule,
      unscheduleForUser: vi.fn(),
      triggerNow: vi.fn(),
    };

    const useCase = new ScheduleAllActiveBriefings({ userRepo, scheduler });
    const { scheduledCount } = await useCase.execute();

    expect(scheduledCount).toBe(3);
    expect(schedule).toHaveBeenCalledTimes(3);
    expect(schedule.mock.calls[0]![0]).toBe(users[0]);
    expect(schedule.mock.calls[1]![0]).toBe(users[1]);
    expect(schedule.mock.calls[2]![0]).toBe(users[2]);
  });

  it("ningún user activo: scheduledCount=0, no llama al scheduler", async () => {
    const findAll = vi.fn(async () => []);
    const schedule = vi.fn(async () => undefined);
    const userRepo: UserRepositoryPort = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      findAllWithBriefingEnabled: findAll,
      save: vi.fn(),
    };
    const scheduler: BriefingSchedulerPort = {
      scheduleForUser: schedule,
      unscheduleForUser: vi.fn(),
      triggerNow: vi.fn(),
    };

    const { scheduledCount } = await new ScheduleAllActiveBriefings({
      userRepo,
      scheduler,
    }).execute();

    expect(scheduledCount).toBe(0);
    expect(schedule).not.toHaveBeenCalled();
  });
});
