import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPECTED_GPX_FILENAMES } from "../../src/import/source-files.js";

export interface FixtureWaypoint {
  lat: number | string;
  lon: number | string;
  name?: string;
  cmt?: string;
  desc?: string;
  linkHref?: string;
  linkText?: string;
  omitName?: boolean;
}

export function buildGpxXml(waypoints: FixtureWaypoint[]): string {
  const wptXml = waypoints
    .map((w) => {
      const parts: string[] = [`  <wpt lat="${w.lat}" lon="${w.lon}">`];
      if (!w.omitName) parts.push(`    <name>${w.name ?? ""}</name>`);
      if (w.cmt !== undefined) parts.push(`    <cmt>${w.cmt}</cmt>`);
      if (w.desc !== undefined) parts.push(`    <desc>${w.desc}</desc>`);
      if (w.linkHref !== undefined || w.linkText !== undefined) {
        parts.push(`    <link href="${w.linkHref ?? ""}"><text>${w.linkText ?? ""}</text></link>`);
      }
      parts.push(`  </wpt>`);
      return parts.join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1">\n${wptXml}\n</gpx>\n`;
}

/**
 * Creates a temp directory containing all 8 expected GPX filenames, each
 * trivially valid by default (zero waypoints), with any filenames in
 * `overrides` replaced by the given raw XML content. Returns the directory
 * path and a cleanup function; always call cleanup, even on test failure.
 */
export function createGpxFixtureDir(overrides: Record<string, string> = {}): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gpx-import-test-"));
  for (const filename of EXPECTED_GPX_FILENAMES) {
    const content = overrides[filename] ?? buildGpxXml([]);
    writeFileSync(join(dir, filename), content, "utf-8");
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
