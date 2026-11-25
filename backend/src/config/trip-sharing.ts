/**
 * `TRIP_SHARING_ENABLED` (M05-T03 Increment 1; specs/TRIP_PLANNING_SPEC.md
 * v1.1 §§5.4, 10.6; ADR-014 decision 10).
 *
 * The enforcement mechanism for the production sharing release gate — NOT an
 * approval. Defaults to OFF when NODE_ENV is "production" and ON everywhere
 * else; an explicit "true"/"1" or "false"/"0" is always respected, and any
 * other value is a startup error (the same parsing as the other boolean
 * settings in env.ts). Setting it to true in production does not by itself
 * satisfy either release blocker (sensitive-location classification; review
 * of share-token exposure in access logs) or any other release requirement:
 * production sharing also needs the developer's explicit approval.
 *
 * Kept separate from env.ts so the rule can be unit-tested without loading
 * the application's required environment.
 */
export const TRIP_SHARING_ENABLED_VARIABLE = "TRIP_SHARING_ENABLED";

export function resolveTripSharingEnabled(value: string | undefined, nodeEnv: string): boolean {
  if (value === undefined || value === "") return nodeEnv !== "production";
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(
    `Environment variable ${TRIP_SHARING_ENABLED_VARIABLE} must be "true" or "false"`,
  );
}
