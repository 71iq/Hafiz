// AES-GCM encryption for Quran Foundation tokens at rest. Kept free of Deno and remote imports so
// Jest can exercise it (tests/unit/qf-user-token-crypto.test.ts).

export async function importEncryptionKey(raw: string): Promise<CryptoKey> {
  const bytes = decodeBase64(raw);
  if (bytes.byteLength !== 32) {
    throw new Error("QF_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 value.");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(key: CryptoKey, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)),
  );
  return `v1:${encodeBase64(iv)}:${encodeBase64(ciphertext)}`;
}

export async function decrypt(key: CryptoKey, value: string): Promise<string> {
  const [version, ivBase64, ciphertextBase64] = value.split(":");
  if (version !== "v1" || !ivBase64 || !ciphertextBase64) throw new Error("Encrypted token is invalid.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(ivBase64) },
    key,
    decodeBase64(ciphertextBase64),
  );
  return new TextDecoder().decode(plaintext);
}

// A stored connection token that the current key cannot read, such as one written under a replaced
// QF_TOKEN_ENCRYPTION_KEY, can only be recovered by reconnecting. Mark the connection for
// reauthorization and fail with "needs_reauth" so the client shows the reconnect prompt. The
// underlying error is dropped and never logged.
export async function decryptStoredToken(
  key: CryptoKey,
  ciphertext: string,
  markNeedsReauth: () => Promise<void>,
): Promise<string> {
  let token: string;
  try {
    token = await decrypt(key, ciphertext);
  } catch {
    await markNeedsReauth();
    throw new Error("needs_reauth");
  }
  return token;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// The return type is inferred so newer TypeScript keeps the ArrayBuffer backing that Web Crypto requires.
export function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
