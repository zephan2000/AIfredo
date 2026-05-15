import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.INTEGRATION_TOKEN_KEY;
  if (!raw) throw new Error("INTEGRATION_TOKEN_KEY required");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `INTEGRATION_TOKEN_KEY must decode to 32 bytes (base64); got ${key.length}`,
    );
  }
  return key;
}

/**
 * Encrypts a UTF-8 string with AES-256-GCM. Output is base64url(iv ‖ tag ‖ ct).
 * Each call generates a fresh IV; reusing the key with random IVs is safe.
 */
export function encryptString(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

export function decryptString(payload: string): string {
  const all = Buffer.from(payload, "base64url");
  if (all.length < IV_LEN + TAG_LEN) {
    throw new Error("ciphertext too short");
  }
  const iv = all.subarray(0, IV_LEN);
  const tag = all.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = all.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function encryptJson(obj: unknown): string {
  return encryptString(JSON.stringify(obj));
}

export function decryptJson<T>(payload: string): T {
  return JSON.parse(decryptString(payload)) as T;
}
