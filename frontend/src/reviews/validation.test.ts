import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BODY_CODE_POINTS,
  REVIEW_MESSAGES,
  countCodePoints,
  isWellFormedText,
  normalizeReviewBody,
  validateRating,
  validateReviewDraft,
  validateReviewPatch,
} from "./validation";

/**
 * M04-T03 Increment 1 — client-side review validation, mirroring the server's
 * rules (backend tests/reviews.test.ts asserts the same boundaries).
 */

const NON_BMP = "\u{1F332}"; // 🌲 — one code point, two UTF-16 code units
const LONE_HIGH = "\uD83C";
const LONE_LOW = "\uDF32";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("countCodePoints", () => {
  it("counts code points, not UTF-16 code units", () => {
    expect(countCodePoints("")).toBe(0);
    expect(countCodePoints("abc")).toBe(3);
    expect(NON_BMP.length).toBe(2);
    expect(countCodePoints(NON_BMP)).toBe(1);
    expect(countCodePoints("a\r\nb")).toBe(4);
    expect(countCodePoints("é")).toBe(2); // combining mark is its own code point
  });
});

describe("validateRating", () => {
  it.each([1, 2, 3, 4, 5])("accepts %s", (rating) => {
    expect(validateRating(rating)).toEqual({ ok: true, value: rating });
  });

  it.each([
    ["0", 0],
    ["6", 6],
    ["-1", -1],
    ["a fraction", 4.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string", "5"],
    ["null", null],
    ["undefined", undefined],
    ["a boolean", true],
  ])("rejects %s", (_label, value) => {
    expect(validateRating(value)).toEqual({ ok: false, message: REVIEW_MESSAGES.ratingRequired });
  });
});

describe("normalizeReviewBody", () => {
  it("maps absent and null to null", () => {
    expect(normalizeReviewBody(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeReviewBody(null)).toEqual({ ok: true, value: null });
  });

  it.each([
    ["empty", ""],
    ["spaces", "   "],
    ["tabs and newlines", "\t\n\r\n "],
    ["Unicode whitespace (NBSP, ideographic space, line separator, BOM)", " 　 ﻿"],
  ])("maps whitespace-only text (%s) to null", (_label, text) => {
    expect(normalizeReviewBody(text)).toEqual({ ok: true, value: null });
  });

  it("trims the edges and keeps internal line breaks exactly", () => {
    expect(normalizeReviewBody("  First line\n\nSecond\r\nThird \n")).toEqual({
      ok: true,
      value: "First line\n\nSecond\r\nThird",
    });
  });

  it("keeps valid Unicode without normalization (combining marks, bidi controls, zero-width, emoji)", () => {
    const text = "Café safe‮evil‬ ​ \u{1F332} <b>bold</b>";
    expect(normalizeReviewBody(text)).toEqual({ ok: true, value: text });
  });

  it("keeps zero-width-only text, as the server does (decision Q5)", () => {
    expect(normalizeReviewBody("​")).toEqual({ ok: true, value: "​" });
  });

  it("accepts exactly 2,000 code points and rejects 2,001 (ASCII)", () => {
    expect(normalizeReviewBody("a".repeat(MAX_BODY_CODE_POINTS))).toEqual({
      ok: true,
      value: "a".repeat(2000),
    });
    expect(normalizeReviewBody("a".repeat(2001))).toEqual({
      ok: false,
      message: REVIEW_MESSAGES.bodyTooLong,
    });
  });

  it("counts a non-BMP character as one: 2,000 accepted (4,000 code units), 2,001 rejected", () => {
    const twoThousand = NON_BMP.repeat(2000);
    expect(twoThousand.length).toBe(4000);
    expect(normalizeReviewBody(twoThousand)).toEqual({ ok: true, value: twoThousand });
    expect(normalizeReviewBody(NON_BMP.repeat(2001))).toEqual({
      ok: false,
      message: REVIEW_MESSAGES.bodyTooLong,
    });
  });

  it("applies the limit after trimming", () => {
    expect(normalizeReviewBody(`   ${"a".repeat(2000)}  \n`)).toEqual({
      ok: true,
      value: "a".repeat(2000),
    });
  });

  it.each([
    ["NUL inside text", "before\u0000after"],
    ["NUL only", "\u0000"],
    ["NUL at an edge (not trimmed away)", " \u0000"],
    ["a lone high surrogate", `ok ${LONE_HIGH} ok`],
    ["a lone low surrogate", `ok ${LONE_LOW} ok`],
    ["a reversed pair", `${LONE_LOW}${LONE_HIGH}`],
    ["a lone surrogate at the end", `text${LONE_HIGH}`],
  ])("rejects %s", (_label, text) => {
    expect(normalizeReviewBody(text)).toEqual({
      ok: false,
      message: REVIEW_MESSAGES.bodyCharacters,
    });
  });

  it("accepts a correctly paired surrogate", () => {
    expect(normalizeReviewBody(`${LONE_HIGH}${LONE_LOW}`)).toEqual({ ok: true, value: NON_BMP });
  });
});

describe("isWellFormedText", () => {
  const cases: [string, boolean][] = [
    ["plain", true],
    [NON_BMP, true],
    [`${LONE_HIGH}x`, false],
    [`x${LONE_LOW}`, false],
    [`${LONE_LOW}${LONE_HIGH}`, false],
    ["", true],
  ];

  it("uses String.prototype.isWellFormed where available", () => {
    expect(typeof (String.prototype as { isWellFormed?: unknown }).isWellFormed).toBe("function");
    for (const [text, expected] of cases) expect(isWellFormedText(text)).toBe(expected);
  });

  it("falls back to an equivalent check when isWellFormed is unavailable", () => {
    const proto = String.prototype as { isWellFormed?: () => boolean };
    const original = proto.isWellFormed;
    try {
      delete proto.isWellFormed;
      for (const [text, expected] of cases) expect(isWellFormedText(text)).toBe(expected);
    } finally {
      proto.isWellFormed = original;
    }
  });
});

describe("validateReviewDraft", () => {
  it("accepts a rating-only draft and a draft with text", () => {
    expect(validateReviewDraft({ rating: 4, body: "" })).toEqual({
      ok: true,
      value: { rating: 4, body: null },
    });
    expect(validateReviewDraft({ rating: 5, body: "  Great  " })).toEqual({
      ok: true,
      value: { rating: 5, body: "Great" },
    });
  });

  it("reports every field's problem at once", () => {
    expect(validateReviewDraft({ rating: null, body: "a".repeat(2001) })).toEqual({
      ok: false,
      errors: { rating: REVIEW_MESSAGES.ratingRequired, body: REVIEW_MESSAGES.bodyTooLong },
    });
    expect(validateReviewDraft({ rating: undefined, body: "fine" })).toEqual({
      ok: false,
      errors: { rating: REVIEW_MESSAGES.ratingRequired },
    });
  });
});

describe("validateReviewPatch", () => {
  it("keeps an omitted body omitted and an explicit null as a clear", () => {
    const ratingOnly = validateReviewPatch({ rating: 2 });
    expect(ratingOnly).toEqual({ ok: true, value: { rating: 2 } });
    expect(ratingOnly.ok && Object.prototype.hasOwnProperty.call(ratingOnly.value, "body")).toBe(
      false,
    );

    const clear = validateReviewPatch({ body: null });
    expect(clear).toEqual({ ok: true, value: { body: null } });
    expect(clear.ok && Object.prototype.hasOwnProperty.call(clear.value, "body")).toBe(true);
    expect(clear.ok && Object.prototype.hasOwnProperty.call(clear.value, "rating")).toBe(false);
  });

  it("treats whitespace-only text as an explicit clear and trims kept text", () => {
    expect(validateReviewPatch({ body: " \n " })).toEqual({ ok: true, value: { body: null } });
    expect(validateReviewPatch({ rating: 5, body: " new " })).toEqual({
      ok: true,
      value: { rating: 5, body: "new" },
    });
  });

  it("rejects an empty patch", () => {
    expect(validateReviewPatch({})).toEqual({
      ok: false,
      errors: { form: REVIEW_MESSAGES.nothingToUpdate },
    });
  });

  it("rejects an invalid rating or body, reporting each", () => {
    expect(validateReviewPatch({ rating: null, body: "\u0000" })).toEqual({
      ok: false,
      errors: { rating: REVIEW_MESSAGES.ratingRequired, body: REVIEW_MESSAGES.bodyCharacters },
    });
    expect(validateReviewPatch({ rating: 6 })).toEqual({
      ok: false,
      errors: { rating: REVIEW_MESSAGES.ratingRequired },
    });
  });
});
