import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getVerifiedTestDatabaseUrl } from "./test-db-guard.js";

// Pure-logic unit tests proving the guard actually rejects unsafe
// configurations — not just that it exists. No database connection is
// needed for these cases (only the URL-validation half of the guard).
describe("getVerifiedTestDatabaseUrl", () => {
  const original = process.env.DATABASE_URL_TEST;

  beforeEach(() => {
    delete process.env.DATABASE_URL_TEST;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_URL_TEST;
    } else {
      process.env.DATABASE_URL_TEST = original;
    }
  });

  it("throws when DATABASE_URL_TEST is not set", () => {
    expect(() => getVerifiedTestDatabaseUrl()).toThrow(/is not set/);
  });

  it("throws when DATABASE_URL_TEST points at the development database", () => {
    process.env.DATABASE_URL_TEST = "postgresql://postgres:postgres@localhost:5432/landmarks_dev";
    expect(() => getVerifiedTestDatabaseUrl()).toThrow(/landmarks_test/);
  });

  it("throws when DATABASE_URL_TEST points at a host outside the allow-list", () => {
    process.env.DATABASE_URL_TEST =
      "postgresql://postgres:postgres@production.example.com:5432/landmarks_test";
    expect(() => getVerifiedTestDatabaseUrl()).toThrow(/allow-list/);
  });

  it("throws when DATABASE_URL_TEST is not a valid URL", () => {
    process.env.DATABASE_URL_TEST = "not-a-url";
    expect(() => getVerifiedTestDatabaseUrl()).toThrow(/valid connection URL/);
  });

  it("accepts a correctly configured local landmarks_test URL", () => {
    process.env.DATABASE_URL_TEST = "postgresql://postgres:postgres@localhost:5432/landmarks_test";
    expect(getVerifiedTestDatabaseUrl()).toBe(
      "postgresql://postgres:postgres@localhost:5432/landmarks_test",
    );
  });
});
