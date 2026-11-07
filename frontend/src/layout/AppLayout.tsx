import { NavLink, Outlet } from "react-router";
import styles from "./AppLayout.module.css";

/**
 * The persistent application shell (M02-T01): semantic header/nav/main
 * landmarks, a skip-to-content link, and the route outlet. Deliberately has
 * no feature content of its own — the map, search, and filtering UI are
 * later M02 tasks.
 */
export function AppLayout() {
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
        </nav>
      </header>
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
