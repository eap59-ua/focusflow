import { describe, expect, it, vi } from "vitest";

import type { BriefingSchedulerPort } from "@/application/ports/BriefingSchedulerPort";
import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { DisconnectGmail } from "@/application/use-cases/gmail/DisconnectGmail";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeUserWithBriefingEnabled(): User {
  return User.create({
    email: Email.create("u@x.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$h"),
    displayName: "U",
  }).enableBriefing(8, "UTC");
}

function makeDeps(opts: { user?: User | null } = {}) {
  const deleteByUserId = vi.fn(async () => undefined);
  const findById = vi.fn(async () =>
    "user" in opts ? (opts.user ?? null) : null,
  );
  const userSave = vi.fn(async (_: User): Promise<void> => undefined);
  const unscheduleForUser = vi.fn(async () => undefined);

  const gmailIntegrationRepo: GmailIntegrationRepositoryPort = {
    save: vi.fn(),
    findByUserId: vi.fn(),
    deleteByUserId,
  };
  const userRepo: UserRepositoryPort = {
    findByEmail: vi.fn(),
    findById,
    findAllWithBriefingEnabled: vi.fn(async () => []),
    save: userSave,
  };
  const scheduler: BriefingSchedulerPort = {
    scheduleForUser: vi.fn(),
    unscheduleForUser,
    triggerNow: vi.fn(),
  };

  return {
    deps: { gmailIntegrationRepo, userRepo, scheduler },
    deleteByUserId,
    userSave,
    unscheduleForUser,
  };
}

describe("DisconnectGmail use case", () => {
  it("delega en repo.deleteByUserId y desprograma del scheduler", async () => {
    const { deps, deleteByUserId, unscheduleForUser } = makeDeps();
    await new DisconnectGmail(deps).execute({ userId: USER_ID });

    expect(deleteByUserId).toHaveBeenCalledWith(USER_ID);
    expect(unscheduleForUser).toHaveBeenCalledWith(USER_ID);
  });

  it("si user existe y briefingEnabled=true: persiste user con disableBriefing", async () => {
    const u = makeUserWithBriefingEnabled();
    const { deps, userSave } = makeDeps({ user: u });
    await new DisconnectGmail(deps).execute({ userId: USER_ID });

    const saved = userSave.mock.calls[0]![0] as User;
    expect(saved.briefingEnabled).toBe(false);
  });

  it("idempotente: sin integración previa no lanza, scheduler.unschedule igual se llama", async () => {
    const { deps, unscheduleForUser } = makeDeps({ user: null });
    await expect(
      new DisconnectGmail(deps).execute({ userId: USER_ID }),
    ).resolves.toBeUndefined();
    expect(unscheduleForUser).toHaveBeenCalled();
  });
});
