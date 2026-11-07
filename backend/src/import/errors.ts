export class ConcurrentImportError extends Error {
  constructor() {
    super("Another import apply is already in progress (advisory lock held). Failing fast rather than waiting.");
  }
}

export class StalePreviewError extends Error {
  constructor(details: { gpxChanged: boolean; dbChanged: boolean }) {
    const parts: string[] = [];
    if (details.gpxChanged) parts.push("the GPX source files have changed");
    if (details.dbChanged) parts.push("the database baseline has changed");
    super(`Preview is stale: ${parts.join(" and ")} since the preview was generated. Run a new preflight.`);
  }
}

export class MissingApprovalError extends Error {
  constructor(missing: string[]) {
    super(`Missing required approval for: ${missing.join(", ")}. Re-run with the matching --approve-* flag(s).`);
  }
}
