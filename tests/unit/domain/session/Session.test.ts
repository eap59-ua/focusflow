import { describe, expect, it } from "vitest";

import { Session } from "@/domain/session/Session";
import { SessionId } from "@/domain/session/SessionId";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const USER_ID = "11111111-2222-3333-4444-555555555555";

describe("Session entity", () => {
  it("Session.create genera id único y fija expiresAt = createdAt + lifetimeDays", () => {
    const before = Date.now();
    const session = Session.create({ userId: USER_ID, lifetimeDays: 30 });
    const after = Date.now();

    expect(session.userId).toBe(USER_ID);
    expect(session.id.value).toMatch(/^[0-9a-f]{64}$/);
    expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(session.createdAt.getTime()).toBeLessThanOrEqual(after);

    const diff =
      session.expiresAt.getTime() - session.createdAt.getTime();
    expect(diff).toBe(30 * MS_PER_DAY);
  });

  it("crea ids distintos en llamadas sucesivas", () => {
    const a = Session.create({ userId: USER_ID, lifetimeDays: 7 });
    const b = Session.create({ userId: USER_ID, lifetimeDays: 7 });
    expect(a.id.value).not.toBe(b.id.value);
  });

  it("Session.restore reconstituye sin disparar invariantes", () => {
    const id = SessionId.create(
      "abcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca",
    );
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-31T00:00:00.000Z");
    const s = Session.restore({ id, userId: USER_ID, createdAt, expiresAt });

    expect(s.id.value).toBe(id.value);
    expect(s.userId).toBe(USER_ID);
    expect(s.createdAt).toBe(createdAt);
    expect(s.expiresAt).toBe(expiresAt);
  });

  it("isExpired false si now < expiresAt", () => {
    const s = Session.create({ userId: USER_ID, lifetimeDays: 1 });
    const now = new Date(s.createdAt.getTime() + 1000);
    expect(s.isExpired(now)).toBe(false);
  });

  it("isExpired true si now == expiresAt (frontera inclusiva)", () => {
    const s = Session.create({ userId: USER_ID, lifetimeDays: 1 });
    const now = new Date(s.expiresAt.getTime());
    expect(s.isExpired(now)).toBe(true);
  });

  it("isExpired true si now > expiresAt", () => {
    const s = Session.create({ userId: USER_ID, lifetimeDays: 1 });
    const now = new Date(s.expiresAt.getTime() + 1000);
    expect(s.isExpired(now)).toBe(true);
  });
});
