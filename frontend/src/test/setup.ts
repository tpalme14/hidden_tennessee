import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.ts doesn't set `test.globals: true`, so React Testing
// Library's automatic afterEach cleanup (which relies on detecting a global
// test framework) never registers on its own — without this, DOM nodes from
// an earlier render in the same file accumulate and break later assertions
// in any test file with more than one `render` call.
afterEach(() => {
  cleanup();
});
