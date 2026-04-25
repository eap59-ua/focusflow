import { describe, expect, it } from "vitest";

import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeToken(label: string): EncryptedToken {
  return EncryptedToken.fromBase64(Buffer.from(label).toString("base64"));
}

function makeCreateInput() {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    googleAccountEmail: "test@gmail.com",
    accessToken: makeToken("access-1"),
    refreshToken: makeToken("refresh-1"),
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
}

describe("GmailIntegration entity", () => {
  describe("create", () => {
    it("genera id UUID y fija connectedAt = lastRefreshedAt ≈ now", () => {
      const before = Date.now();
      const integration = GmailIntegration.create(makeCreateInput());
      const after = Date.now();

      expect(integration.id).toMatch(UUID_REGEX);
      expect(integration.connectedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(integration.connectedAt.getTime()).toBeLessThanOrEqual(after);
      expect(integration.lastRefreshedAt.getTime()).toBe(
        integration.connectedAt.getTime(),
      );
    });

    it("conserva los inputs (userId, email, tokens, scope, tokenExpiresAt)", () => {
      const input = makeCreateInput();
      const integration = GmailIntegration.create(input);

      expect(integration.userId).toBe(input.userId);
      expect(integration.googleAccountEmail).toBe(input.googleAccountEmail);
      expect(integration.accessToken.equals(input.accessToken)).toBe(true);
      expect(integration.refreshToken.equals(input.refreshToken)).toBe(true);
      expect(integration.scope).toBe(input.scope);
      expect(integration.tokenExpiresAt).toBe(input.tokenExpiresAt);
    });
  });

  describe("restore", () => {
    it("reconstituye desde props sin disparar invariantes", () => {
      const props = {
        id: "22222222-2222-2222-2222-222222222222",
        userId: "33333333-3333-3333-3333-333333333333",
        googleAccountEmail: "restored@gmail.com",
        accessToken: makeToken("ar"),
        refreshToken: makeToken("rr"),
        scope: "openid email",
        tokenExpiresAt: new Date("2026-01-01T00:00:00Z"),
        connectedAt: new Date("2025-12-01T00:00:00Z"),
        lastRefreshedAt: new Date("2025-12-15T00:00:00Z"),
      };
      const integration = GmailIntegration.restore(props);

      expect(integration.id).toBe(props.id);
      expect(integration.connectedAt).toEqual(props.connectedAt);
      expect(integration.lastRefreshedAt).toEqual(props.lastRefreshedAt);
    });
  });

  describe("isAccessTokenExpired", () => {
    it("devuelve true si el token ya expiró", () => {
      const integration = GmailIntegration.create({
        ...makeCreateInput(),
        tokenExpiresAt: new Date("2020-01-01T00:00:00Z"),
      });
      expect(integration.isAccessTokenExpired(new Date())).toBe(true);
    });

    it("devuelve false si el token expira más allá del skew", () => {
      const now = new Date("2026-04-25T10:00:00Z");
      const integration = GmailIntegration.create({
        ...makeCreateInput(),
        tokenExpiresAt: new Date("2026-04-25T11:00:00Z"),
      });
      expect(integration.isAccessTokenExpired(now)).toBe(false);
    });

    it("devuelve true si el token expira dentro del skew (default 30s)", () => {
      const now = new Date("2026-04-25T10:00:00Z");
      const integration = GmailIntegration.create({
        ...makeCreateInput(),
        tokenExpiresAt: new Date("2026-04-25T10:00:15Z"),
      });
      expect(integration.isAccessTokenExpired(now)).toBe(true);
    });

    it("respeta un skew custom", () => {
      const now = new Date("2026-04-25T10:00:00Z");
      const integration = GmailIntegration.create({
        ...makeCreateInput(),
        tokenExpiresAt: new Date("2026-04-25T10:00:45Z"),
      });
      expect(integration.isAccessTokenExpired(now, 30)).toBe(false);
      expect(integration.isAccessTokenExpired(now, 60)).toBe(true);
    });

    it("devuelve true cuando expiresAt es exactamente now", () => {
      const now = new Date("2026-04-25T10:00:00Z");
      const integration = GmailIntegration.create({
        ...makeCreateInput(),
        tokenExpiresAt: new Date("2026-04-25T10:00:00Z"),
      });
      expect(integration.isAccessTokenExpired(now, 0)).toBe(true);
    });
  });

  describe("withRefreshedAccessToken", () => {
    it("devuelve nueva instancia (no muta) con accessToken/tokenExpiresAt/lastRefreshedAt actualizados", () => {
      const original = GmailIntegration.create(makeCreateInput());
      const newAccess = makeToken("access-2");
      const newExpires = new Date("2027-01-01T00:00:00Z");
      const refreshAt = new Date("2026-04-25T11:00:00Z");

      const updated = original.withRefreshedAccessToken({
        accessToken: newAccess,
        tokenExpiresAt: newExpires,
        now: refreshAt,
      });

      expect(updated).not.toBe(original);
      expect(updated.accessToken.equals(newAccess)).toBe(true);
      expect(updated.tokenExpiresAt).toEqual(newExpires);
      expect(updated.lastRefreshedAt).toEqual(refreshAt);

      // original intacto
      expect(original.accessToken.equals(newAccess)).toBe(false);
      expect(original.lastRefreshedAt).not.toEqual(refreshAt);
    });

    it("preserva id, userId, refreshToken, scope, connectedAt", () => {
      const original = GmailIntegration.create(makeCreateInput());
      const updated = original.withRefreshedAccessToken({
        accessToken: makeToken("new"),
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        now: new Date(),
      });

      expect(updated.id).toBe(original.id);
      expect(updated.userId).toBe(original.userId);
      expect(updated.refreshToken.equals(original.refreshToken)).toBe(true);
      expect(updated.scope).toBe(original.scope);
      expect(updated.connectedAt).toEqual(original.connectedAt);
    });
  });
});
