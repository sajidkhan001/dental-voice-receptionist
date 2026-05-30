/**
 * encryption.ts — AES-256-GCM encryption for sensitive data (OAuth tokens, etc.)
 * HIPAA: satisfies data-at-rest encryption requirement
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY env var is required (64-char hex string for 256-bit key)");
  }
  return Buffer.from(key, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decrypt(encryptedStr: string): string {
  const key = getKey();
  const parts = encryptedStr.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

const PHI_PREFIX = "ENC:";

/**
 * Encrypt a nullable PHI string for storage.
 * Prefixes with "ENC:" so decryptField can detect already-encrypted values.
 * Returns null unchanged.
 */
export function encryptField(value: string | null | undefined): string | null {
  if (value == null) return null;
  return `${PHI_PREFIX}${encrypt(value)}`;
}

/**
 * Decrypt a nullable PHI string from storage.
 * Handles both encrypted values (prefixed "ENC:") and legacy plaintext rows.
 * Returns null unchanged.
 */
export function decryptField(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (value.startsWith(PHI_PREFIX)) {
    try {
      return decrypt(value.slice(PHI_PREFIX.length));
    } catch {
      return value; // Fail-safe: return raw value rather than crashing
    }
  }
  return value; // Legacy plaintext — return as-is
}
