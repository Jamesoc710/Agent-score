import { describe, expect, it } from "vitest";
import { vantageFingerprint } from "../lane1-env";

// Expected values computed independently with Python's hmac and hashlib for key bytes 0..31.
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const IP = "203.0.113.7"; // TEST-NET-3, never a real vantage

describe("the manifest's vantage fingerprint", () => {
  it("is an HMAC-SHA256 under the local key, with a short key id", () => {
    expect(vantageFingerprint(IP, KEY)).toEqual({
      hmac: "9df8158b5794e6e827f0d42e6fcc4669d49d681d2e048553a0925e6e0a7507a0",
      key_id: "630dcd29",
    });
  });

  it("is never the plain sha256 of the address, which enumeration reverses", () => {
    expect(vantageFingerprint(IP, KEY).hmac).not.toBe(
      "fec52565aa0cf18f57d7cf5b3ac728503b8992d2d6f7d46da1d1201090902b02"
    );
  });
});
