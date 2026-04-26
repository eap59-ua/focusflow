import { describe, expect, it, vi } from "vitest";

import type { BriefingSchedulerPort } from "@/application/ports/BriefingSchedulerPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { UpdateBriefingPreferences } from "@/application/use-cases/scheduling/UpdateBriefingPreferences";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { UserNotFoundError } from "@/domain/user/errors/UserNotFoundError";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeUser() {
  return User.create({
    email: Email.create("u@x.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$h"),
    displayName: "Jane",
  });
}

function makeDeps(
  overrides: {
    user?: User | null;
    save?: UserRepositoryPort["save"];
    schedule?: BriefingSchedulerPort["scheduleForUser"];
    unschedule?: BriefingSchedulerPort["unscheduleForUser"];
  } = {},
) {
  const findById = vi.fn(async (): Promise<User | null> => {
    if ("user" in overrides) return overrides.user ?? null;
    return makeUser();
  });
  const save = vi.fn(overrides.save ?? (async () => undefined));
  const schedule = vi.fn(overrides.schedule ?? (async () => undefined));
  const unschedule = vi.fn(overrides.unschedule ?? (async () => undefined));

  const userRepo: UserRepositoryPort = {
    findByEmail: vi.fn(),
    findById,
    findAllWithBriefingEnabled: vi.fn(async () => []),
    save,
  };
  const scheduler: BriefingSchedulerPort = {
    scheduleForUser: schedule,
    unscheduleForUser: unschedule,
    triggerNow: vi.fn(),
  };
  return { deps: { userRepo, scheduler }, save, schedule, unschedule };
}

describe("UpdateBriefingPreferences use case", () => {
  it("enabled=true: enableBriefing → save → scheduleForUser", async () => {
    const { deps, save, schedule, unschedule } = makeDeps();
    const useCase = new UpdateBriefingPreferences(deps);
    await useCase.execute({
      userId: USER_ID,
      hour: 9,
      timezone: "UTC",
      enabled: true,
    });

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0] as User;
    expect(saved.briefingEnabled).toBe(true);
    expect(saved.briefingHour).toBe(9);
    expect(saved.briefingTimezone).toBe("UTC");

    expect(schedule).toHaveBeenCalledWith(saved);
    expect(unschedule).not.toHaveBeenCalled();
  });

  it("enabled=false: actualiza prefs, disableBriefing, save → unscheduleForUser", async () => {
    const u = makeUser().enableBriefing(9, "UTC");
    const { deps, save, schedule, unschedule } = makeDeps({ user: u });
    const useCase = new UpdateBriefingPreferences(deps);

    await useCase.execute({
      userId: USER_ID,
      hour: 18,
      timezone: "America/New_York",
      enabled: false,
    });

    const saved = save.mock.calls[0]![0] as User;
    expect(saved.briefingEnabled).toBe(false);
    expect(saved.briefingHour).toBe(18);
    expect(saved.briefingTimezone).toBe("America/New_York");

    expect(unschedule).toHaveBeenCalledWith(saved.id);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("user no existe: UserNotFoundError, no save ni scheduler", async () => {
    const { deps, save, schedule, unschedule } = makeDeps({ user: null });
    const useCase = new UpdateBriefingPreferences(deps);

    await expect(
      useCase.execute({
        userId: "missing",
        hour: 8,
        timezone: "UTC",
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(UserNotFoundError);

    expect(save).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(unschedule).not.toHaveBeenCalled();
  });
});
