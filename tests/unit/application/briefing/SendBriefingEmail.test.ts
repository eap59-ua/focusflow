import { describe, expect, it, vi } from "vitest";

import type { BriefingEmailRendererPort } from "@/application/ports/BriefingEmailRendererPort";
import type { BriefingRepositoryPort } from "@/application/ports/BriefingRepositoryPort";
import type { EmailSenderPort } from "@/application/ports/EmailSenderPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { SendBriefingEmail } from "@/application/use-cases/briefing/SendBriefingEmail";
import { Briefing } from "@/domain/briefing/Briefing";
import { BriefingNotFoundError } from "@/domain/briefing/errors/BriefingNotFoundError";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { UserNotFoundError } from "@/domain/user/errors/UserNotFoundError";

function makeUser() {
  return User.create({
    email: Email.create("user@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake"),
    displayName: "Jane",
  });
}

function makeBriefing(userId: string) {
  return Briefing.create({
    userId,
    summary:
      "Hoy tienes 3 reuniones importantes y dos respuestas pendientes a clientes clave.",
    emailsConsidered: 5,
    emailsTruncated: 0,
    tokensUsedInput: 1000,
    tokensUsedOutput: 200,
    modelUsed: "gpt-4o-mini",
    promptVersion: "v1.0.0",
  });
}

function makeDeps(
  overrides: Partial<{
    findById: BriefingRepositoryPort["findById"];
    findUserById: UserRepositoryPort["findById"];
    render: BriefingEmailRendererPort["render"];
    send: EmailSenderPort["send"];
  }> = {},
) {
  const user = makeUser();
  const briefing = makeBriefing(user.id);

  const findById = vi.fn(overrides.findById ?? (async () => briefing));
  const findUserById = vi.fn(overrides.findUserById ?? (async () => user));
  const render = vi.fn(
    overrides.render ??
      (() => ({
        subject: "Tu briefing matutino",
        html: "<p>HTML</p>",
        text: "Texto plano",
      })),
  );
  const send = vi.fn(
    overrides.send ?? (async () => ({ messageId: "<smtp-1@local>" })),
  );

  const briefingRepo: BriefingRepositoryPort = {
    save: vi.fn(),
    findById,
    findLatestByUserId: vi.fn(),
  };
  const userRepo: UserRepositoryPort = {
    save: vi.fn(),
    findByEmail: vi.fn(),
    findById: findUserById,
  };
  const renderer: BriefingEmailRendererPort = { render };
  const emailSender: EmailSenderPort = { send };

  return {
    user,
    briefing,
    deps: {
      briefingRepo,
      userRepo,
      renderer,
      emailSender,
      fromAddress: { email: "no-reply@focusflow.local", name: "FocusFlow" },
    },
    findById,
    findUserById,
    render,
    send,
  };
}

describe("SendBriefingEmail use case", () => {
  it("happy path: render → send → devuelve EmailDelivery", async () => {
    const { user, briefing, deps, render, send } = makeDeps();
    const useCase = new SendBriefingEmail(deps);

    const delivery = await useCase.execute({ briefingId: briefing.id });

    expect(render).toHaveBeenCalledWith(briefing, user);
    expect(send).toHaveBeenCalledWith({
      to: { email: user.email.value, name: user.displayName },
      from: { email: "no-reply@focusflow.local", name: "FocusFlow" },
      subject: "Tu briefing matutino",
      html: "<p>HTML</p>",
      text: "Texto plano",
    });
    expect(delivery.briefingId).toBe(briefing.id);
    expect(delivery.recipientEmail).toBe(user.email.value);
    expect(delivery.messageId).toBe("<smtp-1@local>");
  });

  it("BriefingNotFoundError si findById devuelve null; no llama user/render/send", async () => {
    const { deps, findUserById, render, send } = makeDeps({
      findById: async () => null,
    });
    const useCase = new SendBriefingEmail(deps);

    await expect(
      useCase.execute({ briefingId: "missing" }),
    ).rejects.toBeInstanceOf(BriefingNotFoundError);
    expect(findUserById).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("UserNotFoundError si findById de user devuelve null; no llama render/send", async () => {
    const { deps, render, send } = makeDeps({
      findUserById: async () => null,
    });
    const useCase = new SendBriefingEmail(deps);

    await expect(useCase.execute({ briefingId: "id" })).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
    expect(render).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("propaga error del sender", async () => {
    const smtpErr = new Error("smtp connection refused");
    const { deps } = makeDeps({
      send: async () => {
        throw smtpErr;
      },
    });
    const useCase = new SendBriefingEmail(deps);

    await expect(useCase.execute({ briefingId: "id" })).rejects.toBe(smtpErr);
  });

  it("propaga error del renderer", async () => {
    const renderErr = new Error("render template failed");
    const { deps } = makeDeps({
      render: () => {
        throw renderErr;
      },
    });
    const useCase = new SendBriefingEmail(deps);

    await expect(useCase.execute({ briefingId: "id" })).rejects.toBe(renderErr);
  });
});
