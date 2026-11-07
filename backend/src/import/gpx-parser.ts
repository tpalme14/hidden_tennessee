import { readFileSync } from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { RawWaypoint } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  isArray: (name) => name === "wpt",
});

export class GpxFileMissingError extends Error {}
export class GpxFileUnreadableError extends Error {}
export class GpxMalformedError extends Error {}

/**
 * Reads and parses a single GPX file, returning its raw <wpt> records.
 * Throws a typed error distinguishing "missing", "unreadable" (exists but
 * can't be read, e.g. permissions), and "malformed" (not well-formed XML, or
 * missing the expected gpx/wpt structure) — callers use this distinction to
 * decide import completeness (spec §5.3/§8.4) and retirement eligibility.
 */
export function parseGpxFile(filePath: string): RawWaypoint[] {
  let xml: string;
  try {
    xml = readFileSync(filePath, "utf-8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new GpxFileMissingError(`GPX file not found: ${filePath}`);
    }
    throw new GpxFileUnreadableError(`Could not read GPX file ${filePath}: ${err.message}`);
  }

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new GpxMalformedError(
      `${filePath} is not well-formed XML: ${validation.err.msg} (line ${validation.err.line})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (error) {
    throw new GpxMalformedError(
      `${filePath} failed to parse: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const gpx = (parsed as Record<string, unknown>)?.gpx as Record<string, unknown> | undefined;
  if (!gpx || typeof gpx !== "object") {
    throw new GpxMalformedError(`${filePath} has no <gpx> root element.`);
  }

  const wpt = gpx.wpt;
  if (wpt === undefined) {
    // A file with no waypoints at all is structurally valid but empty;
    // treat it as zero records rather than malformed.
    return [];
  }
  if (!Array.isArray(wpt)) {
    throw new GpxMalformedError(`${filePath}: expected <wpt> elements to form an array.`);
  }

  return wpt as RawWaypoint[];
}
