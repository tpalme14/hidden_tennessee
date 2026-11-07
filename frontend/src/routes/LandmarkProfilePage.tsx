import { useLocation, useNavigate, useParams } from "react-router";
import { parseSafeHttpUrl } from "../api/landmarkProfileValidation";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { categoryLabel } from "../map/categoryMarkerStyle";
import { LandmarkLocationMap } from "../map/LandmarkLocationMap";
import { useLandmarkProfile } from "./useLandmarkProfile";

/**
 * Landmark profile route (M02-T04). Renders exactly one of: the full public
 * profile, the strict §9.4a minimal redacted profile (identical regardless
 * of whether the record is UNREVIEWED or SENSITIVE — that distinction is
 * never exposed), or the generic unavailable page — never a partial or
 * best-effort render of anything else.
 */
export function LandmarkProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [status, retry] = useLandmarkProfile(id);
  const navigate = useNavigate();
  const location = useLocation();
  const cameFromDiscovery = Boolean((location.state as { fromDiscovery?: boolean } | null)?.fromDiscovery);

  function handleReturn() {
    // `navigate(-1)` only when we can reliably establish this page was
    // reached via our own in-app discovery links (marked at link-creation
    // time with `state.fromDiscovery` — see LandmarkMarkersRenderer/
    // LandmarkSearch), which also restores the discovery route's exact
    // query-string state (spec §9.6) with no extra encoding needed. A direct
    // or externally linked profile visit has no such state to return to, so
    // it falls back to the plain discovery route instead of an unrelated or
    // out-of-app history entry (M02-T07, closing the M02-T04 follow-up).
    if (cameFromDiscovery) {
      navigate(-1);
    } else {
      navigate("/");
    }
  }

  return (
    <section aria-labelledby="profile-heading">
      {status.kind === "loading" ? (
        <>
          <h2 id="profile-heading">Landmark Profile</h2>
          <LoadingState label="Loading landmark…" />
        </>
      ) : null}

      {status.kind === "error" ? (
        <>
          <h2 id="profile-heading">Landmark Profile</h2>
          <ErrorState message={status.message} onRetry={retry} />
        </>
      ) : null}

      {status.kind === "unavailable" ? (
        <>
          <h2 id="profile-heading">Landmark unavailable</h2>
          <p>This landmark is no longer available in the explorer.</p>
        </>
      ) : null}

      {status.kind === "minimal" ? (
        <>
          <h2 id="profile-heading">{status.profile.display_name}</h2>
          <p>{categoryLabel(status.profile.category)}</p>
          <p>Full details for this landmark are not currently available.</p>
        </>
      ) : null}

      {status.kind === "full" ? (
        <FullProfileContent
          displayName={status.profile.display_name}
          category={status.profile.category}
          latitude={status.profile.latitude}
          longitude={status.profile.longitude}
          sourceDescription={status.profile.source_description}
          sourceAccessLabel={status.profile.source_access_label}
          sourceUrl={status.profile.source_url}
        />
      ) : null}

      <p>
        <button type="button" onClick={handleReturn}>
          Back to Discover
        </button>
      </p>
    </section>
  );
}

interface FullProfileContentProps {
  displayName: string;
  category: string;
  latitude: number;
  longitude: number;
  sourceDescription: string | null;
  sourceAccessLabel: string | null;
  sourceUrl: string | null;
}

function FullProfileContent({
  displayName,
  category,
  latitude,
  longitude,
  sourceDescription,
  sourceAccessLabel,
  sourceUrl,
}: FullProfileContentProps) {
  const safeUrl = parseSafeHttpUrl(sourceUrl);

  return (
    <>
      <h2 id="profile-heading">{displayName}</h2>
      <p>{categoryLabel(category)}</p>
      <LandmarkLocationMap latitude={latitude} longitude={longitude} category={category} displayName={displayName} />
      {sourceDescription ? <p>{sourceDescription}</p> : null}
      {sourceAccessLabel ? <p>{sourceAccessLabel}</p> : null}
      {safeUrl ? (
        <p>
          <a href={safeUrl} target="_blank" rel="noreferrer noopener">
            {safeUrl}
          </a>
        </p>
      ) : null}
      <p>
        Coordinates and labels shown here do not establish public access, legal entry, maintained trails, or
        safety.
      </p>
    </>
  );
}
