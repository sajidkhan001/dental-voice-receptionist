import { describe, it, expect } from "vitest";

// Dynamic import to handle the encryption module
describe("encryption", () => {
  it("encrypts and decrypts text correctly", async () => {
    const { encrypt, decrypt } = await import("../lib/encryption");
    const plaintext = "Hello, this is a secret message!";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":"); // IV:tag:ciphertext format
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", async () => {
    const { encrypt } = await import("../lib/encryption");
    const plaintext = "Same message twice";
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);
    expect(enc1).not.toBe(enc2);
  });

  it("handles empty string", async () => {
    const { encrypt, decrypt } = await import("../lib/encryption");
    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });
});
