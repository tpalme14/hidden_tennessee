import { NavLink, Outlet } from "react-router";
import { useAuth } from "../auth/session";
import { AccountNav } from "./AccountNav";
import styles from "./AppLayout.module.css";

/**
 * The persistent application shell (M02-T01): semantic header/nav/main
 * landmarks, a skip-to-content link, and the route outlet. Deliberately has
 * no feature content of its own — the map, search, and filtering UI are
 * later M02 tasks. Since M03-T03 Increment 2 the header also carries the
 * account area (`AccountNav`), which needs `AuthProvider` above it. Since
 * M03-T06 Increment 5 the primary navigation adds "My Favorites" for a
 * VERIFIED signed-in user only (K6) — never while the session is loading,
 * unavailable, or anonymous.
 */
export function AppLayout() {
  const { session } = useAuth();
  return (
    <div className={styles.appShell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <header className={styles.header}>
        <h1 className={styles.title}>Tennessee Natural Landmarks Explorer</h1>
        <nav aria-label="Primary" className={styles.nav}>
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}
          >
            Discover
          </NavLink>
          {session.status === "authenticated" ? (
            <NavLink
              to="/favorites"
              className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}
            >
              My Favorites
            </NavLink>
          ) : null}
        </nav>
        <AccountNav />
      </header>
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
