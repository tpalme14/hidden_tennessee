import { useEffect, useRef, useState } from "react";
import { connectivity, type ConnectivityState, type ConnectivityStore } from "./connectivity";
import {
  checkServerHealth,
  useConnectivity,
  type HealthCheck,
  type HealthCheckOutcome,
} from "./useConnectivity";
import styles from "./ConnectivityBanner.module.css";

/**
 * Application-wide connection feedback (M06-T02 Increment 3a; Specification 6
 * v1.1 OFF-NET-1 to OFF-NET-3, OFF-UX-6, OFF-UX-7, AC-26). Rendered once in
 * AppLayout, between the header and the main content.
 *
 * It describes only the evidence that exists: the browser's offline hint, or
 * a request that failed without any response. Server errors (5xx) are left to
 * the feature that made the request, unless the user's own connection check
 * found them. It never claims that saved data is available offline, never
 * replaces a feature's own error or retry, never moves focus, and never makes
 * a request by itself: "Check connection" sends one `GET /health`, and only
 * when pressed.
 *
 * Announcements: the message sits in an `aria-live="polite"` region with no
 * role (so it never competes with features' own status regions). The region
 * is created the first time there is something to say — empty first, then
 * filled on the next commit, so that first message is announced — and then
 * stays. Its text changes only when the situation changes, so repeated
 * identical evidence is not re-announced.
 */

type CheckState = "idle" | "checking" | HealthCheckOutcome;

function bannerMessage(state: ConnectivityState, check: CheckState): string | null {
  if (state.reachability === "unreachable") {
    return state.browser === "offline"
      ? "You appear to be offline. Pages and actions that need the server won't work until you reconnect."
      : "The app can't reach the server right now, although your device reports a network connection.";
  }
  if (state.browser === "offline") {
    return "Your device reports that it is offline. Pages and actions that need the server may not work.";
  }
  if (check === "unhealthy" && state.reachability === "server-problem") {
    return "The server responded but isn't working normally. Some pages and actions may not work.";
  }
  if (check === "unexpected") {
    return "The server sent an unexpected response to the connection check.";
  }
  return null;
}

function checkResultNote(state: ConnectivityState, check: CheckState): string | null {
  if (check === "checking") return "Checking the connection…";
  if (check === "unreachable" && state.reachability === "unreachable") {
    return "The server still can't be reached.";
  }
  return null;
}

export function ConnectivityBanner({
  store = connectivity,
  check = checkServerHealth,
}: {
  store?: ConnectivityStore;
  check?: HealthCheck;
}) {
  const state = useConnectivity(store);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const checking = useRef(false);

  // A connection check's result describes the moment it finished; any later
  // change in the evidence makes it stale.
  useEffect(() => {
    if (!checking.current) setCheckState("idle");
  }, [state.browser, state.reachability]);

  async function runCheck() {
    if (checking.current) return; // one request at a time
    checking.current = true;
    setCheckState("checking");
    let outcome: HealthCheckOutcome;
    try {
      outcome = await check();
    } catch {
      outcome = "unexpected";
    }
    checking.current = false;
    setCheckState(outcome);
  }

  const message = bannerMessage(state, checkState);
  const note = checkResultNote(state, checkState);
  const recovered =
    checkState === "healthy" && state.reachability === "reachable" && state.browser === "online";
  const announcement = [message, note, recovered ? "Connected to the server." : null]
    .filter(Boolean)
    .join(" ");

  // The live region is added only once there is first something to say, and
  // then stays: first mounted empty, then filled on the next commit, so the
  // first message is announced too. Until then the page has no extra live
  // region (other features count and rely on their own announcers).
  const [regionMounted, setRegionMounted] = useState(false);
  const [regionReady, setRegionReady] = useState(false);
  useEffect(() => {
    if (announcement && !regionMounted) setRegionMounted(true);
  }, [announcement, regionMounted]);
  useEffect(() => {
    if (regionMounted && !regionReady) setRegionReady(true);
  }, [regionMounted, regionReady]);

  return (
    <div className={message ? styles.banner : styles.hidden} data-connectivity-banner="">
      {regionMounted ? (
        <p
          className={message ? styles.message : styles.visuallyHidden}
          aria-live="polite"
          aria-atomic="true"
        >
          {regionReady ? announcement : ""}
        </p>
      ) : null}
      {message ? (
        <button
          type="button"
          className={styles.button}
          onClick={() => void runCheck()}
          aria-disabled={checkState === "checking" ? true : undefined}
        >
          {checkState === "checking" ? "Checking connection…" : "Check connection"}
        </button>
      ) : null}
    </div>
  );
}
