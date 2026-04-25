export interface TokenEncryptionPort {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertextBase64: string): Promise<string>;
}
