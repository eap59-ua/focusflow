import { describe, expect, it } from "vitest";

import { SessionId } from "@/domain/session/SessionId";
import { InvalidSessionIdError } from "@/domain/session/errors/InvalidSessionIdError";

const VALID_HEX_64 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("SessionId value object", () => {
  it("acepta un hex-64 lowercase válido", () => {
    const id = SessionId.create(VALID_HEX_64);
    expect(id.value).toBe(VALID_HEX_64);
  });

  it("rechaza strings de longitud incorrecta", () => {
    expect(() => SessionId.create("")).toThrow(InvalidSessionIdError);
    expect(() => SessionId.create(VALID_HEX_64.slice(0, 63))).toThrow(
      InvalidSessionIdError,
    );
    expect(() => SessionId.create(`${VALID_HEX_64}a`)).toThrow(
      InvalidSessionIdError,
    );
  });

  it("rechaza strings con caracteres no-hex o uppercase", () => {
    const withUpper =
      "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef";
    const withZ =
      "z123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(() => SessionId.create(withUpper)).toThrow(InvalidSessionIdError);
    expect(() => SessionId.create(withZ)).toThrow(InvalidSessionIdError);
  });

  it("rechaza strings con espacios envolventes", () => {
    expect(() => SessionId.create(` ${VALID_HEX_64}`)).toThrow(
      InvalidSessionIdError,
    );
  });

  it("SessionId.generate produce un value hex-64 válido y único entre llamadas", () => {
    const a = SessionId.generate();
    const b = SessionId.generate();
    expect(a.value).toMatch(/^[0-9a-f]{64}$/);
    expect(b.value).toMatch(/^[0-9a-f]{64}$/);
    expect(a.value).not.toBe(b.value);
  });

  it("equals compara por value", () => {
    const a = SessionId.create(VALID_HEX_64);
    const b = SessionId.create(VALID_HEX_64);
    expect(a.equals(b)).toBe(true);
  });
});
