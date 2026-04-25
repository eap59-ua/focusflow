import { describe, expect, it } from "vitest";

import { EmailDelivery } from "@/domain/briefing/EmailDelivery";
import { InvalidBriefingError } from "@/domain/briefing/errors/InvalidBriefingError";

const VALID = {
  briefingId: "11111111-1111-1111-1111-111111111111",
  recipientEmail: "user@example.com",
  sentAt: new Date("2026-04-25T08:00:00Z"),
  messageId: "<smtp-msg@focusflow>",
};

describe("EmailDelivery VO", () => {
  it("acepta inputs válidos", () => {
    const d = EmailDelivery.create(VALID);
    expect(d.briefingId).toBe(VALID.briefingId);
    expect(d.recipientEmail).toBe(VALID.recipientEmail);
    expect(d.sentAt).toEqual(VALID.sentAt);
    expect(d.messageId).toBe(VALID.messageId);
  });

  it("rechaza briefingId vacío", () => {
    expect(() =>
      EmailDelivery.create({ ...VALID, briefingId: "" }),
    ).toThrow(InvalidBriefingError);
  });

  it("rechaza recipientEmail vacío", () => {
    expect(() =>
      EmailDelivery.create({ ...VALID, recipientEmail: "" }),
    ).toThrow(InvalidBriefingError);
  });

  it("rechaza messageId vacío", () => {
    expect(() => EmailDelivery.create({ ...VALID, messageId: "" })).toThrow(
      InvalidBriefingError,
    );
  });
});
