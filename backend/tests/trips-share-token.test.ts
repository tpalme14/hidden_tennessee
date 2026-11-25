import { describe, expect, it } from "vitest";
import {
  SHARE_TOKEN_LENGTH,
  buildShareUrl,
  generateShareToken,
  hashShareToken,
  isShareTokenHash,
  isShareTokenSyntax,
} from "../src/trips/share-token.js";

/**
 * M05-T03 Increment 5 — share-token primitives (spec v1.1 §§4, 10.3; ADR-014
 * decision 10): 32 random bytes as 43 base64url characters, a lower-case hex
 * SHA-256 digest as the stored form, strict syntax checks, and the share URL
 * built from the configured public origin.
 */

describe("generateShareToken", () => {
  it("is 43 base64url characters that decode to exactly 32 bytes", () => {
    for (let i = 0; i < 200; i += 1) {
      const token = generateShareToken();
      expect(token).toHaveLength(SHARE_TOKEN_LENGTH);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
      expect(Buffer.from(token, "base64url").toString("base64url")).toBe(token);
    }
  });

  it("produces independent values (no repeats in 5,000 draws)", () => {
    const seen = new Set(Array.from({ length: 5000 }, () => generateShareToken()));
    expect(seen.size).toBe(5000);
  });
});

describe("hashShareToken", () => {
  it("is the lower-case hex SHA-256 of the token string (known vector)", () => {
    expect(hashShareToken("A".repeat(43))).toBe(
      "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a",
    );
    const token = generateShareToken();
    const hash = hashShareToken(token);
    expect(isShareTokenHash(hash)).toBe(true);
    expect(hash).not.toContain(token);
    expect(hashShareToken(token)).toBe(hash);
  });

  it("refuses a value without token syntax", () => {
    expect(() => hashShareToken("short")).toThrow();
  });
});

describe("isShareTokenSyntax", () => {
  it("accepts exactly 43 base64url characters", () => {
    expect(isShareTokenSyntax("A".repeat(43))).toBe(true);
    expect(isShareTokenSyntax(`${"_".repeat(42)}-`)).toBe(true);
  });

  it.each([
    ["42 characters", "A".repeat(42)],
    ["44 characters", "A".repeat(44)],
    ["empty", ""],
    ["standard base64 +", `${"A".repeat(42)}+`],
    ["standard base64 /", `${"A".repeat(42)}/`],
    ["padding", `${"A".repeat(42)}=`],
    ["whitespace", ` ${"A".repeat(42)}`],
    ["percent-encoded", `${"A".repeat(40)}%2F`],
    ["non-ASCII", `${"A".repeat(42)}${String.fromCodePoint(0xe9)}`],
    ["hash form", "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a"],
  ])("rejects %s", (_label, value) => {
    expect(isShareTokenSyntax(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const value of [undefined, null, 43, ["A".repeat(43)], { token: "A".repeat(43) }]) {
      expect(isShareTokenSyntax(value)).toBe(false);
    }
  });
});

describe("buildShareUrl", () => {
  const token = "A".repeat(43);

  it("is <public origin>/shared/trips/<token>, using only the configured value's origin", () => {
    expect(buildShareUrl("http://localhost:3000", token)).toBe(
      `http://localhost:3000/shared/trips/${token}`,
    );
    expect(buildShareUrl("https://example.com/some/path/?q=1#f", token)).toBe(
      `https://example.com/shared/trips/${token}`,
    );
  });

  it("refuses a token without token syntax", () => {
    expect(() => buildShareUrl("https://example.com", "../admin")).toThrow();
  });
});
