// @vitest-environment node
import { describe, expect, it } from "vitest";

import { TokenDecryptionFailedError } from "@/domain/gmail-integration/errors/TokenDecryptionFailedError";
import { AesGcmTokenEncryption } from "@/infrastructure/security/AesGcmTokenEncryption";

const VALID_KEY =
  "5bf8a9ab87d6756540689644c8af793dc3368b7255e8ed0865f3103eb7f0616d";
const ANOTHER_KEY =
  "1111111111111111111111111111111111111111111111111111111111111111";

describe("AesGcmTokenEncryption", () => {
  describe("constructor", () => {
    it("acepta una key de 64 chars hex (32 bytes)", () => {
      expect(() => new AesGcmTokenEncryption(VALID_KEY)).not.toThrow();
    });

    it("rechaza key con longitud incorrecta", () => {
      expect(() => new AesGcmTokenEncryption("abcd")).toThrow();
      expect(() => new AesGcmTokenEncryption(VALID_KEY + "00")).toThrow();
    });

    it("rechaza key con caracteres fuera de [0-9a-f]", () => {
      const bad = "Z" + VALID_KEY.slice(1);
      expect(() => new AesGcmTokenEncryption(bad)).toThrow();
    });

    it("rechaza key con mayúsculas (esperamos lowercase)", () => {
      expect(() => new AesGcmTokenEncryption(VALID_KEY.toUpperCase())).toThrow();
    });
  });

  describe("encrypt + decrypt round-trip", () => {
    it("decrypt(encrypt(x)) === x para un access token típico", async () => {
      const enc = new AesGcmTokenEncryption(VALID_KEY);
      const plain =
        "ya29.A0AbVbY8JxXXX_long_realistic_access_token_payload_with_dots.and-dashes";
      const ct = await enc.encrypt(plain);
      const back = await enc.decrypt(ct);
      expect(back).toBe(plain);
    });

    it("funciona con strings unicode", async () => {
      const enc = new AesGcmTokenEncryption(VALID_KEY);
      const plain = "héllo 🔐 token €";
      expect(await enc.decrypt(await enc.encrypt(plain))).toBe(plain);
    });

    it("genera ciphertext distinto para el mismo plaintext (IV no determinista)", async () => {
      const enc = new AesGcmTokenEncryption(VALID_KEY);
      const a = await enc.encrypt("same-input");
      const b = await enc.encrypt("same-input");
      expect(a).not.toBe(b);
    });

    // T9 (audit): forma del output. Reforzamos que el contrato base64 + tamaño
    // mínimo del envelope (12 IV + 16 authTag = 28 bytes) se mantiene.
    it("output es base64 válido y tiene >= 28 bytes (IV+authTag mínimo)", async () => {
      const enc = new AesGcmTokenEncryption(VALID_KEY);
      const ct = await enc.encrypt("x");
      // base64 sólo usa [A-Za-z0-9+/=].
      expect(ct).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      const buf = Buffer.from(ct, "base64");
      expect(buf.length).toBeGreaterThanOrEqual(28);
    });

    it("encrypts independientes generan IV distinto en los primeros 12 bytes", async () => {
      const enc = new AesGcmTokenEncryption(VALID_KEY);
      const a = Buffer.from(await enc.encrypt("same"), "base64").subarray(0, 12);
      const b = Buffer.from(await enc.encrypt("same"), "base64").subarray(0, 12);
      // Probabilidad de colisión real ≈ 2^-96, despreciable.
      expect(Buffer.compare(a, b)).not.toBe(0);
    });
  });

  describe("tampering detection", () => {
    it("modificar 1 byte del ciphertext hace que decrypt lance TokenDecryptionFailedError", async () => {
      const enc = new AesGcmTokenEncryption(VALID_KEY);
      const ct = await enc.encrypt("payload");
      const buf = Buffer.from(ct, "base64");
      // Flippear el último byte (parte del ciphertext, después de IV+authTag).
      buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
      const tampered = buf.toString("base64");

      await expect(enc.decrypt(tampered)).rejects.toBeInstanceOf(
        TokenDecryptionFailedError,
      );
    });

    it("ciphertext truncado lanza TokenDecryptionFailedError", async () => {
      const enc = new AesGcmTokenEncryption(VALID_KEY);
      await expect(enc.decrypt("short")).rejects.toBeInstanceOf(
        TokenDecryptionFailedError,
      );
    });

    it("decrypt con la key incorrecta lanza TokenDecryptionFailedError", async () => {
      const enc1 = new AesGcmTokenEncryption(VALID_KEY);
      const enc2 = new AesGcmTokenEncryption(ANOTHER_KEY);
      const ct = await enc1.encrypt("secret");

      await expect(enc2.decrypt(ct)).rejects.toBeInstanceOf(
        TokenDecryptionFailedError,
      );
    });
  });
});
