import { sha256 } from "@noble/hashes/sha256";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * Calculates a SHA-256 digest in browsers where SubtleCrypto is available.
 * Falls back to noble-hashes for non-secure HTTP deployments, where
 * crypto.subtle is intentionally unavailable.
 */
export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  const subtle = globalThis.crypto?.subtle;

  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return toHex(new Uint8Array(digest));
  }

  return toHex(sha256(bytes));
}
