import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { TokenEncryptionPort } from "@/application/ports/TokenEncryptionPort";
import { TokenDecryptionFailedError } from "@/domain/gmail-integration/errors/TokenDecryptionFailedError";

const ALGORITHM = "aes-256-gcm";
const KEY_HEX_LENGTH = 64;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_HEX_PATTERN = /^[0-9a-f]{64}$/;

export class AesGcmTokenEncryption implements TokenEncryptionPort {
  private readonly key: Buffer;

  constructor(keyHex: string) {
    if (keyHex.length !== KEY_HEX_LENGTH || !KEY_HEX_PATTERN.test(keyHex)) {
      throw new Error(
        "TOKEN_ENCRYPTION_KEY must be exactly 64 lowercase hex characters (32 bytes)",
      );
    }
    this.key = Buffer.from(keyHex, "hex");
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
  }

  async decrypt(ciphertextBase64: string): Promise<string> {
    const buffer = Buffer.from(ciphertextBase64, "base64");
    if (buffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new TokenDecryptionFailedError();
    }
    const iv = buffer.subarray(0, IV_LENGTH);
    const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    } catch {
      throw new TokenDecryptionFailedError();
    }
  }
}
