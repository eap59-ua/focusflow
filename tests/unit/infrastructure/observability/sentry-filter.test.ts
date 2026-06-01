import { describe, expect, it } from "vitest";

import { SessionExpiredError } from "@/domain/session/errors/SessionExpiredError";
import { InvalidCredentialsError } from "@/domain/user/errors/InvalidCredentialsError";
import { UserNotFoundError } from "@/domain/user/errors/UserNotFoundError";
import {
  isIgnoredError,
  scrubSensitive,
  sentryBeforeSend,
} from "@/infrastructure/observability/sentry-filter";

// Tipos estructurales mínimos: evitamos depender de la forma exacta de Sentry en
// el test. El filtro opera sobre objetos planos.
type AnyEvent = Parameters<typeof sentryBeforeSend>[0];
type AnyHint = NonNullable<Parameters<typeof sentryBeforeSend>[1]>;

function hintFor(err: unknown): AnyHint {
  return { originalException: err } as AnyHint;
}

describe("sentry-filter", () => {
  describe("isIgnoredError", () => {
    it("true para errores de aplicación esperados", () => {
      expect(isIgnoredError(hintFor(new SessionExpiredError()))).toBe(true);
      expect(isIgnoredError(hintFor(new InvalidCredentialsError()))).toBe(true);
      expect(isIgnoredError(hintFor(new UserNotFoundError()))).toBe(true);
    });

    it("false para un Error genérico (bug real)", () => {
      expect(isIgnoredError(hintFor(new Error("boom")))).toBe(false);
    });

    it("false cuando no hay hint ni originalException", () => {
      expect(isIgnoredError(undefined)).toBe(false);
      expect(isIgnoredError({} as AnyHint)).toBe(false);
    });
  });

  describe("scrubSensitive", () => {
    it("redacta tokens y contenido de email a cualquier profundidad", () => {
      const input = {
        userId: "u-1",
        contexts: {
          gmail: {
            accessToken: "ya29.SECRET",
            refreshToken: "1//SECRET",
            messageId: "msg-9",
          },
          email: { subject: "asunto privado", snippet: "snip", bodyText: "cuerpo" },
        },
        breadcrumbs: [{ data: { bodyText: "otro cuerpo", briefingId: "b-1" } }],
      };

      const out = scrubSensitive(input);

      expect(out.contexts.gmail.accessToken).toBe("[redacted]");
      expect(out.contexts.gmail.refreshToken).toBe("[redacted]");
      expect(out.contexts.email.subject).toBe("[redacted]");
      expect(out.contexts.email.snippet).toBe("[redacted]");
      expect(out.contexts.email.bodyText).toBe("[redacted]");
      expect(out.breadcrumbs[0]!.data.bodyText).toBe("[redacted]");
      // Whitelist: identificadores no sensibles se preservan.
      expect(out.contexts.gmail.messageId).toBe("msg-9");
      expect(out.breadcrumbs[0]!.data.briefingId).toBe("b-1");
      expect(out.userId).toBe("u-1");
    });

    it("no muta el objeto original", () => {
      const input = { accessToken: "ya29.SECRET" };
      scrubSensitive(input);
      expect(input.accessToken).toBe("ya29.SECRET");
    });

    it("soporta referencias cíclicas sin desbordar", () => {
      const cyclic: Record<string, unknown> = { accessToken: "x" };
      cyclic.self = cyclic;
      expect(() => scrubSensitive(cyclic)).not.toThrow();
    });
  });

  describe("sentryBeforeSend", () => {
    it("descarta (null) los errores esperados", () => {
      const event = { message: "x" } as AnyEvent;
      expect(sentryBeforeSend(event, hintFor(new SessionExpiredError()))).toBeNull();
    });

    it("deja pasar bugs reales pero redactando campos sensibles", () => {
      const event = {
        message: "kaboom",
        extra: { refreshToken: "1//SECRET", userId: "u-1" },
      } as unknown as AnyEvent;

      const out = sentryBeforeSend(event, hintFor(new Error("kaboom")));

      expect(out).not.toBeNull();
      const extra = (out as unknown as { extra: Record<string, string> }).extra;
      expect(extra.refreshToken).toBe("[redacted]");
      expect(extra.userId).toBe("u-1");
    });
  });
});
