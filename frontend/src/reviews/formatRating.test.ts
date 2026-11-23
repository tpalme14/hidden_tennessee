import { describe, expect, it } from "vitest";
import {
  NO_REVIEWS_TEXT,
  formatAverageRating,
  formatRatingSummary,
  formatReviewCount,
} from "./formatRating";

/** M04-T03 Increment 1 — display formatting for review aggregates (decision Q4 as approved). */

describe("formatAverageRating", () => {
  it.each([
    [1, "1.0"],
    [5, "5.0"],
    [4, "4.0"],
    [4.5, "4.5"],
    [4.25, "4.3"],
    [4.24, "4.2"],
    [13 / 3, "4.3"],
    [11 / 3, "3.7"],
    [7 / 3, "2.3"],
    [24 / 7, "3.4"],
    [4.96, "5.0"],
    [4.95, "5.0"],
    [1.95, "2.0"],
    [1.04, "1.0"],
  ])("%s → %s", (value, expected) => {
    expect(formatAverageRating(value)).toBe(expected);
  });

  it("rounds exact x.x5 boundaries half up, even where the binary value is just below", () => {
    // 4.05 is stored as 4.0499999999999998… — toFixed rounds it DOWN.
    expect((4.05).toFixed(1)).toBe("4.0");
    expect(formatAverageRating(4.05)).toBe("4.1");
    // Every x.x5 boundary between 1 and 5 (exact means such as 81/20 = 4.05).
    for (let tenths = 10; tenths < 50; tenths += 1) {
      const boundary = (tenths * 10 + 5) / 100; // e.g. 1.05, 1.15, …, 4.95
      const expected = ((tenths + 1) / 10).toFixed(1);
      expect(formatAverageRating(boundary), String(boundary)).toBe(expected);
    }
  });

  it("matches exact means k/n computed the way the API computes them (sum / count)", () => {
    // Every mean reachable with up to 200 reviews, compared against exact
    // integer half-up rounding of 10·k/n.
    for (let count = 1; count <= 200; count += 1) {
      for (let sum = count; sum <= 5 * count; sum += 1) {
        const average = sum / count;
        const exactTenths = Math.floor((20 * sum + count) / (2 * count)); // half up, integers only
        const expected = `${Math.floor(exactTenths / 10)}.${exactTenths % 10}`;
        if (formatAverageRating(average) !== expected) {
          throw new Error(
            `${sum}/${count} = ${average}: got ${formatAverageRating(average)}, expected ${expected}`,
          );
        }
      }
    }
  });

  it("does not change the value it is given", () => {
    const value = 13 / 3;
    formatAverageRating(value);
    expect(value).toBe(13 / 3);
  });

  it.each([0, 0.99, 5.01, 6, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects %s (outside the rating scale)",
    (value) => {
      expect(() => formatAverageRating(value)).toThrow(RangeError);
    },
  );
});

describe("formatReviewCount", () => {
  it.each([
    [0, "0 reviews"],
    [1, "1 review"],
    [2, "2 reviews"],
    [1234, "1,234 reviews"],
  ])("%s → %s", (count, expected) => {
    expect(formatReviewCount(count)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN])("rejects %s", (count) => {
    expect(() => formatReviewCount(count)).toThrow(RangeError);
  });
});

describe("formatRatingSummary", () => {
  it("shows 'No reviews yet' — never a zero-star rating — when there are none", () => {
    expect(NO_REVIEWS_TEXT).toBe("No reviews yet");
    expect(formatRatingSummary({ average_rating: null, rating_count: 0 })).toBe("No reviews yet");
  });

  it("shows the one-decimal average and the review count", () => {
    expect(formatRatingSummary({ average_rating: 5, rating_count: 1 })).toBe(
      "5.0 out of 5 · 1 review",
    );
    expect(formatRatingSummary({ average_rating: 13 / 3, rating_count: 3 })).toBe(
      "4.3 out of 5 · 3 reviews",
    );
    expect(formatRatingSummary({ average_rating: 4.05, rating_count: 20 })).toBe(
      "4.1 out of 5 · 20 reviews",
    );
  });
});
