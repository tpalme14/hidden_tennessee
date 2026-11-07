import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deduplicateCandidates } from "../src/import/duplicates.js";
import { mapWaypointToCandidate } from "../src/import/landmark-mapper.js";
import { parseDataset } from "../src/import/parse-dataset.js";
import type { CandidateLandmark, RawWaypoint } from "../src/import/types.js";
import { isOutsideWarningEnvelope, parseValidUrl } from "../src/import/validation.js";

const REAL_COORDINATES_DIR = fileURLToPath(new URL("../../coordinates", import.meta.url));

const context = { filename: "tnarches.gpx", sourceFile: "TNARCHES" as const, category: "ARCH" as const };

describe("mapWaypointToCandidate", () => {
  it("accepts a well-formed record, using <cmt> as the display name", () => {
    const raw: RawWaypoint = {
      "@_lat": 36.2174,
      "@_lon": -84.12754,
      name: "ANA001",
      cmt: "Coal Creek Arches 4x5",
      desc: "Anderson",
      link: { "@_href": "", text: "private" },
      sym: "Pin, Blue",
    };
    const result = mapWaypointToCandidate(raw, context);
    expect(result.kind).toBe("accepted");
    if (result.kind !== "accepted") return;
    expect(result.record).toEqual<CandidateLandmark>({
      sourceCode: "ANA001",
      sourceFile: "TNARCHES",
      category: "ARCH",
      displayName: "Coal Creek Arches 4x5",
      latitude: 36.2174,
      longitude: -84.12754,
      sourceDescription: "Anderson",
      sourceAccessLabel: "private",
      sourceUrl: null,
    });
  });

  it("falls back to the trimmed source code when <cmt> is missing or empty", () => {
    const raw: RawWaypoint = { "@_lat": 36, "@_lon": -84, name: "ANA002", desc: "Anderson" };
    const result = mapWaypointToCandidate(raw, context);
    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") expect(result.record.displayName).toBe("ANA002");
  });

  it("rejects as unidentifiable when <name> is missing or empty", () => {
    const result = mapWaypointToCandidate({ "@_lat": 36, "@_lon": -84 }, context);
    expect(result).toMatchObject({ kind: "rejected", record: { kind: "unidentifiable", sourceCode: null } });
  });

  it("rejects as unidentifiable when <name> doesn't match [A-Z]{3}[0-9]{3}", () => {
    const result = mapWaypointToCandidate({ "@_lat": 36, "@_lon": -84, name: "bad-code" }, context);
    expect(result).toMatchObject({ kind: "rejected", record: { kind: "unidentifiable", sourceCode: null } });
  });

  it("rejects as invalid (not unidentifiable) when the source code is valid but coordinates are out of range", () => {
    const result = mapWaypointToCandidate({ "@_lat": 95, "@_lon": -84, name: "ANA003" }, context);
    expect(result).toMatchObject({ kind: "rejected", record: { kind: "invalid", sourceCode: "ANA003" } });
  });

  it("rejects as invalid when coordinates are missing or non-numeric", () => {
    const result = mapWaypointToCandidate({ name: "ANA004" }, context);
    expect(result).toMatchObject({ kind: "rejected", record: { kind: "invalid", sourceCode: "ANA004" } });
  });

  it("does not produce a navigable URL from an empty or missing href", () => {
    const withEmptyHref = mapWaypointToCandidate(
      { "@_lat": 36, "@_lon": -84, name: "ANA005", link: { "@_href": "", text: "trail" } },
      context,
    );
    expect(withEmptyHref.kind).toBe("accepted");
    if (withEmptyHref.kind === "accepted") expect(withEmptyHref.record.sourceUrl).toBeNull();

    const withoutLink = mapWaypointToCandidate({ "@_lat": 36, "@_lon": -84, name: "ANA006" }, context);
    expect(withoutLink.kind).toBe("accepted");
    if (withoutLink.kind === "accepted") {
      expect(withoutLink.record.sourceUrl).toBeNull();
      expect(withoutLink.record.sourceAccessLabel).toBeNull();
    }
  });

  it("accepts a real valid href as the source URL", () => {
    const result = mapWaypointToCandidate(
      {
        "@_lat": 36,
        "@_lon": -84,
        name: "ANA007",
        link: { "@_href": "http://tnlandforms.us/mtnbike/wind.html", text: "windrock" },
      },
      context,
    );
    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") {
      expect(result.record.sourceUrl).toBe("http://tnlandforms.us/mtnbike/wind.html");
      expect(result.record.sourceAccessLabel).toBe("windrock");
    }
  });

  it("stores out-of-state descriptions verbatim, with no Tennessee-county assumption", () => {
    // KYR001 / KYR002 / CTF004, per M01-T01's verified findings.
    const kentucky = mapWaypointToCandidate(
      { "@_lat": 36.6, "@_lon": -84.85, name: "KYR001", cmt: "KY Chimney Rock 160'", desc: "KY" },
      { filename: "tnrocks.gpx", sourceFile: "TNROCKS", category: "ROCK" },
    );
    expect(kentucky.kind).toBe("accepted");
    if (kentucky.kind === "accepted") expect(kentucky.record.sourceDescription).toBe("KY");

    const northCarolina = mapWaypointToCandidate(
      { "@_lat": 36.1987, "@_lon": -81.9695, name: "CTF004", cmt: "Elk/Big Falls 45'", desc: "NC" },
      { filename: "tnfalls.gpx", sourceFile: "TNFALLS", category: "FALLS" },
    );
    expect(northCarolina.kind).toBe("accepted");
    if (northCarolina.kind === "accepted") expect(northCarolina.record.sourceDescription).toBe("NC");
  });
});

describe("deduplicateCandidates", () => {
  const base: CandidateLandmark = {
    sourceCode: "MIF026",
    sourceFile: "TNFALLS",
    category: "FALLS",
    displayName: "Denny Cove Falls 70'",
    latitude: 35.15357,
    longitude: -85.67249,
    sourceDescription: "Marion",
    sourceAccessLabel: null,
    sourceUrl: null,
  };

  it("collapses an exact duplicate to one record and counts the extra occurrence", () => {
    const result = deduplicateCandidates([base, { ...base }]);
    expect(result.accepted).toHaveLength(1);
    expect(result.exactDuplicateOccurrences).toBe(1);
    expect(result.conflicts).toHaveLength(0);
  });

  it("flags conflicting duplicates and excludes them from the accepted set entirely", () => {
    const conflicting: CandidateLandmark = { ...base, displayName: "Different Name" };
    const result = deduplicateCandidates([base, conflicting]);
    expect(result.accepted).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ kind: "conflict", sourceCode: "MIF026" });
  });

  it("leaves unique source codes untouched", () => {
    const other: CandidateLandmark = { ...base, sourceCode: "MIF027" };
    const result = deduplicateCandidates([base, other]);
    expect(result.accepted).toHaveLength(2);
    expect(result.exactDuplicateOccurrences).toBe(0);
  });
});

describe("validation helpers", () => {
  it("flags coordinates outside the Tennessee warning envelope without rejecting them", () => {
    expect(isOutsideWarningEnvelope(35.19, -85.6)).toBe(false); // inside, per M01-T01
    expect(isOutsideWarningEnvelope(40, -85.6)).toBe(true);
  });

  it("rejects non-http(s) URLs", () => {
    expect(parseValidUrl("javascript:alert(1)")).toBeNull();
    expect(parseValidUrl("ftp://example.com/file")).toBeNull();
    expect(parseValidUrl("http://example.com")).toBe("http://example.com");
  });
});

describe("parseDataset against the real coordinates/ directory", () => {
  it("reproduces M01-T01's verified baseline exactly", () => {
    const dataset = parseDataset(REAL_COORDINATES_DIR);

    expect(dataset.isComplete).toBe(true);
    const totalInputOccurrences = dataset.files.reduce((sum, f) => sum + f.acceptedCount + f.rejectedCount, 0);
    expect(totalInputOccurrences).toBe(1693);
    expect(dataset.exactDuplicateOccurrences).toBe(1);
    expect(dataset.accepted).toHaveLength(1692);
    expect(dataset.rejected).toHaveLength(0);
    expect(dataset.filesWithRetirementDisabled.size).toBe(0);

    const mif026Count = dataset.accepted.filter((c) => c.sourceCode === "MIF026").length;
    expect(mif026Count).toBe(1);

    const outOfState = dataset.accepted.filter((c) => ["KYR001", "KYR002", "CTF004"].includes(c.sourceCode));
    expect(outOfState).toHaveLength(3);
    expect(outOfState.find((c) => c.sourceCode === "KYR001")?.sourceDescription).toBe("KY");
    expect(outOfState.find((c) => c.sourceCode === "KYR002")?.sourceDescription).toBe("KY");
    expect(outOfState.find((c) => c.sourceCode === "CTF004")?.sourceDescription).toBe("NC");

    const geographicWarnings = dataset.accepted.filter((c) => isOutsideWarningEnvelope(c.latitude, c.longitude));
    expect(geographicWarnings).toHaveLength(0);
  });
});
