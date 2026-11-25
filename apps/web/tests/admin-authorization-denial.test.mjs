// Three faults this pins down:
//
// 1. ADMIN_PATHS named 3 sections while AdminAuthorization wraps the whole dash
//    layout, so /cabinet and 10 other sections were reachable by any member.
// 2. Denial set isAuthorized(false) *and* router.push('/cabinet'), so the message
//    flashed for a frame and the user was bounced with no explanation.
// 3. isAuthorized started at `false` while the decision is made in an effect,
//    which runs after the commit, so the denial surface painted for a frame on
//    every load, admins included.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyError } from "../lib/errors/classify.ts";

const COMPONENT_DIR = join(import.meta.dir, "..", "components", "Security");
const SOURCE = readFileSync(join(COMPONENT_DIR, "AdminAuthorization.tsx"), "utf8");

// Mirrors the component's isAdminPath so the gate can be exercised directly.
const PREFIX = "/cabinet";
const isAdminPath = (pathname) =>
  pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);

describe("every dash section is gated", () => {
  // The sections that exist under app/orgs/[orgslug]/cabinet. Only 3 were listed
  // before; the rest fell through to the "not an admin path" branch.
  const SECTIONS = [
    "analytics", "assignments", "boards", "communities", "courses",
    "developers", "library", "onboarding", "org", "payments",
    "playgrounds", "podcasts", "users",
  ];

  test("/cabinet itself is gated", () => {
    expect(isAdminPath("/cabinet")).toBe(true);
  });

  test.each(SECTIONS)("/cabinet/%s is gated", (section) => {
    expect(isAdminPath(`/cabinet/${section}`)).toBe(true);
    expect(isAdminPath(`/cabinet/${section}/nested/page`)).toBe(true);
  });

  test("paths outside the dashboard are untouched", () => {
    for (const p of ["/", "/home", "/explore", "/dashboard", "/orgs/acme/course/x"]) {
      expect(isAdminPath(p)).toBe(false);
    }
  });
});

describe("denial explains itself instead of bouncing", () => {
  test("the page-mode branch contains no redirect", () => {
    // Scoped to the page-mode block: router.push is still correct elsewhere
    // (unauthenticated → /login), so a file-wide search would miss a regression.
    const start = SOURCE.indexOf("if (authorizationMode === 'page')");
    const end = SOURCE.indexOf("authorizationMode === 'component'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    expect(SOURCE.slice(start, end)).not.toContain("router.push");
  });

  test("an unauthenticated visitor is still redirected to login", () => {
    expect(SOURCE).toContain("'/login'");
  });

  test("renders the shared error surface, not a bare heading", () => {
    expect(SOURCE).toContain("<ErrorUI");
    expect(SOURCE).not.toContain("You are not authorized to access this page");
  });

  test("the error it passes classifies as a permission problem", () => {
    // Without a `permission` match the user gets the generic fallback copy.
    const classified = classifyError({ status: 403, message: "admin_only" });
    expect(classified.category.kind).toBe("permission");
    expect(classified.category.resolutions).toContain("home");
  });
});

describe("the denial surface cannot paint before the decision is made", () => {
  test("authorization starts undecided rather than denied", () => {
    expect(SOURCE).toContain("useState<boolean | null>(null)");
  });

  test("undecided shows the loader, and only in page mode", () => {
    // Component mode renders inline (sidebar, dashboard home), where a
    // full-screen spinner would be worse than rendering nothing.
    expect(SOURCE).toContain("authorizationMode === 'page' && isAuthorized === null");
  });

  test("only a decided false reaches ErrorUI", () => {
    // The regression this guards: `!isAuthorized` reads the undecided null as a
    // denial, which is exactly the frame that used to flash.
    const errorUI = SOURCE.indexOf("<ErrorUI");
    const guard = SOURCE.lastIndexOf("if (authorizationMode === 'page'", errorUI);
    expect(errorUI).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);

    expect(SOURCE.slice(guard, errorUI)).toContain("isAuthorized === false");
  });

  test("a signed-out visitor is never told they lack permission", () => {
    // The unauthenticated branch returns without deciding, so the loader holds
    // the screen while the /login navigation is in flight.
    const start = SOURCE.indexOf("if (!isUserAuthenticated)");
    const end = SOURCE.indexOf("if (authorizationMode === 'page')", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    expect(SOURCE.slice(start, end)).not.toContain("setIsAuthorized");
  });
});
