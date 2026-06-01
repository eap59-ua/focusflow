import { describe, expect, it } from "vitest";

import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import { InvalidEncryptedTokenError } from "@/domain/gmail-integration/errors/InvalidEncryptedTokenError";

describe("EncryptedToken VO", () => {
  it("acepta una cadena base64 válida y la devuelve por toBase64", () => {
    const valid = Buffer.from("hello world").toString("base64");
    const token = EncryptedToken.fromBase64(valid);
    expect(token.toBase64()).toBe(valid);
  });

  it("acepta base64 con padding (=, ==)", () => {
    const onePad = Buffer.from("hello!").toString("base64");
    const twoPad = Buffer.from("hi").toString("base64");
    expect(() => EncryptedToken.fromBase64(onePad)).not.toThrow();
    expect(() => EncryptedToken.fromBase64(twoPad)).not.toThrow();
  });

  it("rechaza string vacío", () => {
    expect(() => EncryptedToken.fromBase64("")).toThrow(
      InvalidEncryptedTokenError,
    );
  });

  it("rechaza caracteres fuera del alfabeto base64", () => {
    expect(() => EncryptedToken.fromBase64("not_base64!@#$")).toThrow(
      InvalidEncryptedTokenError,
    );
  });

  it("rechaza longitud que no sea múltiplo de 4", () => {
    expect(() => EncryptedToken.fromBase64("abc")).toThrow(
      InvalidEncryptedTokenError,
    );
    expect(() => EncryptedToken.fromBase64("abcde")).toThrow(
      InvalidEncryptedTokenError,
    );
  });

  it("equals compara por contenido", () => {
    const a = EncryptedToken.fromBase64(Buffer.from("x").toString("base64"));
    const b = EncryptedToken.fromBase64(Buffer.from("x").toString("base64"));
    const c = EncryptedToken.fromBase64(Buffer.from("y").toString("base64"));
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
