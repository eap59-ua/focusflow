import { describe, expect, it } from "vitest";

import { EmailMessage } from "@/domain/email-message/EmailMessage";
import { InvalidEmailMessageError } from "@/domain/email-message/errors/InvalidEmailMessageError";

function validInput(overrides: Partial<Parameters<typeof EmailMessage.create>[0]> = {}) {
  return {
    id: "gmail-msg-1",
    messageIdHeader: "<abc@gmail.com>",
    threadId: "thread-1",
    subject: "Hola",
    fromEmail: "alice@example.com",
    fromName: "Alice",
    toEmails: ["me@gmail.com"],
    snippet: "Te escribo para...",
    receivedAt: new Date("2026-04-25T08:00:00Z"),
    bodyText: "Te escribo para confirmar la reunión.",
    ...overrides,
  };
}

describe("EmailMessage value object", () => {
  it("happy path: crea EmailMessage con todos los campos", () => {
    const msg = EmailMessage.create(validInput());

    expect(msg.id).toBe("gmail-msg-1");
    expect(msg.messageIdHeader).toBe("<abc@gmail.com>");
    expect(msg.threadId).toBe("thread-1");
    expect(msg.subject).toBe("Hola");
    expect(msg.fromEmail.value).toBe("alice@example.com");
    expect(msg.fromName).toBe("Alice");
    expect(msg.toEmails).toEqual(["me@gmail.com"]);
    expect(msg.snippet).toBe("Te escribo para...");
    expect(msg.bodyText).toContain("reunión");
  });

  it("acepta subject vacío (algunos emails reales lo tienen)", () => {
    const msg = EmailMessage.create(validInput({ subject: "" }));
    expect(msg.subject).toBe("");
  });

  it("acepta fromName null", () => {
    const msg = EmailMessage.create(validInput({ fromName: null }));
    expect(msg.fromName).toBe(null);
  });

  it("acepta toEmails vacío (BCC-only o similar)", () => {
    const msg = EmailMessage.create(validInput({ toEmails: [] }));
    expect(msg.toEmails).toEqual([]);
  });

  it("rechaza id vacío", () => {
    expect(() => EmailMessage.create(validInput({ id: "" }))).toThrow(
      InvalidEmailMessageError,
    );
    expect(() => EmailMessage.create(validInput({ id: "   " }))).toThrow(
      InvalidEmailMessageError,
    );
  });

  it("rechaza messageIdHeader vacío", () => {
    expect(() =>
      EmailMessage.create(validInput({ messageIdHeader: "" })),
    ).toThrow(InvalidEmailMessageError);
  });

  it("rechaza threadId vacío", () => {
    expect(() => EmailMessage.create(validInput({ threadId: "" }))).toThrow(
      InvalidEmailMessageError,
    );
  });

  it("rechaza fromEmail con formato inválido", () => {
    expect(() =>
      EmailMessage.create(validInput({ fromEmail: "not-an-email" })),
    ).toThrow(InvalidEmailMessageError);
    expect(() =>
      EmailMessage.create(validInput({ fromEmail: "@no-local-part.com" })),
    ).toThrow(InvalidEmailMessageError);
  });

  it("rechaza receivedAt en el futuro (>60s skew)", () => {
    const future = new Date(Date.now() + 5 * 60 * 1000);
    expect(() =>
      EmailMessage.create(validInput({ receivedAt: future })),
    ).toThrow(InvalidEmailMessageError);
  });

  it("acepta receivedAt dentro del skew tolerable (<=60s en el futuro)", () => {
    const slightlyFuture = new Date(Date.now() + 30 * 1000);
    expect(() =>
      EmailMessage.create(validInput({ receivedAt: slightlyFuture })),
    ).not.toThrow();
  });
});
