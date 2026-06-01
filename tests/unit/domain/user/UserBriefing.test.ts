import { describe, expect, it } from "vitest";

import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { InvalidBriefingHourError } from "@/domain/user/errors/InvalidBriefingHourError";
import { InvalidBriefingTimezoneError } from "@/domain/user/errors/InvalidBriefingTimezoneError";

function makeUser(): User {
  return User.create({
    email: Email.create("user@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake"),
    displayName: "Jane",
  });
}

describe("User briefing preferences", () => {
  describe("create defaults", () => {
    it("briefingHour=8, timezone=Europe/Madrid, enabled=false por defecto", () => {
      const u = makeUser();
      expect(u.briefingHour).toBe(8);
      expect(u.briefingTimezone).toBe("Europe/Madrid");
      expect(u.briefingEnabled).toBe(false);
    });

    it("create rechaza briefingHour fuera de [0, 23]", () => {
      const base = {
        email: Email.create("u@x.com"),
        hashedPassword: HashedPassword.fromHash("$2a$10$h"),
        displayName: "X",
      };
      expect(() => User.create({ ...base, briefingHour: 24 })).toThrow(
        InvalidBriefingHourError,
      );
      expect(() => User.create({ ...base, briefingHour: -1 })).toThrow(
        InvalidBriefingHourError,
      );
      expect(() => User.create({ ...base, briefingHour: 8.5 })).toThrow(
        InvalidBriefingHourError,
      );
    });

    it("create rechaza timezone inválido (no IANA)", () => {
      const base = {
        email: Email.create("u@x.com"),
        hashedPassword: HashedPassword.fromHash("$2a$10$h"),
        displayName: "X",
      };
      expect(() =>
        User.create({ ...base, briefingTimezone: "Mars/OlympusMons" }),
      ).toThrow(InvalidBriefingTimezoneError);
      expect(() => User.create({ ...base, briefingTimezone: "" })).toThrow(
        InvalidBriefingTimezoneError,
      );
    });
  });

  describe("enableBriefing", () => {
    it("activa con hour y timezone válidos; devuelve nueva instancia", () => {
      const u = makeUser();
      const enabled = u.enableBriefing(7, "America/New_York");

      expect(enabled).not.toBe(u);
      expect(enabled.briefingEnabled).toBe(true);
      expect(enabled.briefingHour).toBe(7);
      expect(enabled.briefingTimezone).toBe("America/New_York");
      expect(u.briefingEnabled).toBe(false); // original intacto
    });

    it("acepta extremos hour=0 y hour=23", () => {
      const u = makeUser();
      expect(() => u.enableBriefing(0, "UTC")).not.toThrow();
      expect(() => u.enableBriefing(23, "UTC")).not.toThrow();
    });

    it("rechaza hour fuera de [0,23]", () => {
      const u = makeUser();
      expect(() => u.enableBriefing(24, "UTC")).toThrow(
        InvalidBriefingHourError,
      );
      expect(() => u.enableBriefing(-1, "UTC")).toThrow(
        InvalidBriefingHourError,
      );
    });

    it("rechaza timezone inválido", () => {
      const u = makeUser();
      expect(() => u.enableBriefing(8, "Bogus/Zone")).toThrow(
        InvalidBriefingTimezoneError,
      );
    });

    it("actualiza updatedAt", () => {
      const u = makeUser();
      const before = u.updatedAt.getTime();
      // Pequeña espera para diferencia clara.
      const enabled = u.enableBriefing(8, "UTC");
      expect(enabled.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe("disableBriefing", () => {
    it("apaga el toggle preservando hour/tz; nueva instancia", () => {
      const u = makeUser().enableBriefing(10, "UTC");
      const disabled = u.disableBriefing();

      expect(disabled).not.toBe(u);
      expect(disabled.briefingEnabled).toBe(false);
      expect(disabled.briefingHour).toBe(10);
      expect(disabled.briefingTimezone).toBe("UTC");
    });

    it("disable sobre disabled es idempotente (sigue siendo false)", () => {
      const u = makeUser();
      const disabled = u.disableBriefing();
      expect(disabled.briefingEnabled).toBe(false);
    });
  });

  describe("updateBriefingPreferences", () => {
    it("actualiza hour+timezone sin cambiar enabled; nueva instancia", () => {
      const u = makeUser().enableBriefing(8, "Europe/Madrid");
      const updated = u.updateBriefingPreferences(20, "Asia/Tokyo");

      expect(updated).not.toBe(u);
      expect(updated.briefingHour).toBe(20);
      expect(updated.briefingTimezone).toBe("Asia/Tokyo");
      expect(updated.briefingEnabled).toBe(true);
    });

    it("rechaza hour fuera de rango y tz inválido", () => {
      const u = makeUser();
      expect(() => u.updateBriefingPreferences(99, "UTC")).toThrow(
        InvalidBriefingHourError,
      );
      expect(() => u.updateBriefingPreferences(8, "X/Y")).toThrow(
        InvalidBriefingTimezoneError,
      );
    });
  });
});
