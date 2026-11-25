/** App routes for trips (M05-T04). IDs are encoded as one path segment. */

export function tripPath(tripId: string): string {
  return `/trips/${encodeURIComponent(tripId)}`;
}

/** Sign-in that returns to the trip afterwards (the sign-in page re-validates `returnTo`). */
export function tripSignInHref(tripId: string): string {
  return `/sign-in?returnTo=${encodeURIComponent(tripPath(tripId))}`;
}
