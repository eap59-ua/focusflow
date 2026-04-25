import { describe, expect, it } from "vitest";

import { Briefing } from "@/domain/briefing/Briefing";
import { BriefingTooShortError } from "@/domain/briefing/errors/BriefingTooShortError";
import { InvalidBriefingError } from "@/domain/briefing/errors/InvalidBriefingError";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_SUMMARY =
  "Hoy tienes 3 reuniones importantes y un par de respuestas pendientes a clientes clave.";

function validInput(overrides: Partial<Parameters<typeof Briefing.create>[0]> = {}) {
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    summary: VALID_SUMMARY,
    emailsConsidered: 12,
    emailsTruncated: 0,
    tokensUsedInput: 1500,
    tokensUsedOutput: 300,
    modelUsed: "gpt-4o-mini",
    promptVersion: "v1.0.0",
    ...overrides,
  };
}

describe("Briefing entity", () => {
  describe("create", () => {
    it("happy path: genera UUID, fija createdAt ≈ now", () => {
      const before = Date.now();
      const briefing = Briefing.create(validInput());
      const after = Date.now();

      expect(briefing.id).toMatch(UUID_REGEX);
      expect(briefing.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(briefing.createdAt.getTime()).toBeLessThanOrEqual(after);
      expect(briefing.summary).toBe(VALID_SUMMARY);
      expect(briefing.modelUsed).toBe("gpt-4o-mini");
      expect(briefing.promptVersion).toBe("v1.0.0");
    });

    it("rechaza userId vacío", () => {
      expect(() => Briefing.create(validInput({ userId: "" }))).toThrow(
        InvalidBriefingError,
      );
    });

    it("rechaza modelUsed vacío", () => {
      expect(() => Briefing.create(validInput({ modelUsed: "" }))).toThrow(
        InvalidBriefingError,
      );
    });

    it("rechaza promptVersion vacío", () => {
      expect(() => Briefing.create(validInput({ promptVersion: "" }))).toThrow(
        InvalidBriefingError,
      );
    });

    it("lanza BriefingTooShortError si summary < 50 chars", () => {
      expect(() =>
        Briefing.create(validInput({ summary: "muy corto" })),
      ).toThrow(BriefingTooShortError);
      expect(() => Briefing.create(validInput({ summary: "" }))).toThrow(
        BriefingTooShortError,
      );
    });

    it("rechaza emailsConsidered < 0", () => {
      expect(() =>
        Briefing.create(validInput({ emailsConsidered: -1 })),
      ).toThrow(InvalidBriefingError);
    });

    it("rechaza emailsTruncated < 0", () => {
      expect(() =>
        Briefing.create(validInput({ emailsTruncated: -1 })),
      ).toThrow(InvalidBriefingError);
    });

    it("rechaza tokens < 0", () => {
      expect(() =>
        Briefing.create(validInput({ tokensUsedInput: -1 })),
      ).toThrow(InvalidBriefingError);
      expect(() =>
        Briefing.create(validInput({ tokensUsedOutput: -1 })),
      ).toThrow(InvalidBriefingError);
    });

    it("acepta métricas en 0 (caso emails vacíos / placeholder)", () => {
      const briefing = Briefing.create(
        validInput({
          emailsConsidered: 0,
          emailsTruncated: 0,
          tokensUsedInput: 0,
          tokensUsedOutput: 0,
        }),
      );
      expect(briefing.emailsConsidered).toBe(0);
      expect(briefing.tokensUsedInput).toBe(0);
    });
  });

  describe("restore", () => {
    it("reconstituye desde props sin disparar invariantes", () => {
      const props = {
        id: "11111111-1111-1111-1111-111111111111",
        userId: "22222222-2222-2222-2222-222222222222",
        summary: "x",
        emailsConsidered: -5,
        emailsTruncated: 0,
        tokensUsedInput: 0,
        tokensUsedOutput: 0,
        modelUsed: "",
        promptVersion: "",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      };
      const briefing = Briefing.restore(props);
      expect(briefing.id).toBe(props.id);
      expect(briefing.summary).toBe("x");
    });
  });
});
