import { describe, expect, it } from "vitest";

import { Email } from "@/domain/user/Email";
import { InvalidEmailError } from "@/domain/user/errors/InvalidEmailError";

describe("Email value object", () => {
  it("acepta un email con formato RFC-básico válido", () => {
    const email = Email.create("user@example.com");
    expect(email.value).toBe("user@example.com");
  });

  it("acepta emails con subdominios y sufijos compuestos", () => {
    const email = Email.create("user.name+tag@mail.example.co.uk");
    expect(email.value).toBe("user.name+tag@mail.example.co.uk");
  });

  it("rechaza un email sin arroba", () => {
    expect(() => Email.create("userexample.com")).toThrow(InvalidEmailError);
  });

  it("rechaza un email con múltiples arrobas", () => {
    expect(() => Email.create("user@@example.com")).toThrow(InvalidEmailError);
    expect(() => Email.create("user@foo@example.com")).toThrow(InvalidEmailError);
  });

  it("rechaza un string vacío", () => {
    expect(() => Email.create("")).toThrow(InvalidEmailError);
  });

  it("rechaza emails con espacios (internos o envolventes, sin trim automático)", () => {
    expect(() => Email.create("us er@example.com")).toThrow(InvalidEmailError);
    expect(() => Email.create(" user@example.com")).toThrow(InvalidEmailError);
    expect(() => Email.create("user@example.com ")).toThrow(InvalidEmailError);
  });

  it("considera dos Email con el mismo valor como iguales vía equals()", () => {
    const a = Email.create("user@example.com");
    const b = Email.create("user@example.com");
    expect(a.equals(b)).toBe(true);
  });

  it("considera distintos dos Email con valores diferentes", () => {
    const a = Email.create("user@example.com");
    const b = Email.create("other@example.com");
    expect(a.equals(b)).toBe(false);
  });
});
