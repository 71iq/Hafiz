/**
 * @jest-environment node
 */
import {
  decryptStoredToken,
  encodeBase64,
  encrypt,
  importEncryptionKey,
} from "@/supabase/functions/qf-user/token-crypto";

const randomKey = () => importEncryptionKey(encodeBase64(crypto.getRandomValues(new Uint8Array(32))));

describe("Quran Foundation stored token decryption", () => {
  it("reads a token stored under the current key", async () => {
    const key = await randomKey();
    const markNeedsReauth = jest.fn(async () => {});
    const stored = await encrypt(key, "sample-access-token");

    await expect(decryptStoredToken(key, stored, markNeedsReauth)).resolves.toBe("sample-access-token");
    expect(markNeedsReauth).not.toHaveBeenCalled();
  });

  it("asks for reconnection when a token was stored under a replaced key", async () => {
    const oldKey = await randomKey();
    const newKey = await randomKey();
    const markNeedsReauth = jest.fn(async () => {});
    const stored = await encrypt(oldKey, "sample-refresh-token");

    const failure = decryptStoredToken(newKey, stored, markNeedsReauth);
    await expect(failure).rejects.toThrow(/^needs_reauth$/);
    expect(markNeedsReauth).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an unknown format", "v0:abc:def"],
    ["invalid base64", "v1:***:***"],
  ])("asks for reconnection when a stored token has %s", async (_label, stored) => {
    const markNeedsReauth = jest.fn(async () => {});

    await expect(decryptStoredToken(await randomKey(), stored, markNeedsReauth)).rejects.toThrow(/^needs_reauth$/);
    expect(markNeedsReauth).toHaveBeenCalledTimes(1);
  });
});
