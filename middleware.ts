import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-constants";

/**
 * Protected path prefixes.
 *
 * `/profile` used to be listed here alongside `/dashboard`, but no such route
 * exists — the profile page lives at `/dashboard/profile`, and nothing in the
 * app ever links to a bare `/profile`. Protecting a route that does not exist
 * has no security value (an unauthenticated request was redirected to login,
 * and an authenticated one still got a 404), and it made the middleware read as
 * though there were a second protected area to maintain. It is removed rather
 * than backed by a new page: `/dashboard/profile` is the intended location, and
 * adding a bare `/profile` would be a duplicate route for the same thing.
 *
 * `/dashboard` covers `/dashboard/profile` by prefix, so profile pages remain
 * protected exactly as before.
 */
const PROTECTED_PREFIXES = ["/dashboard"];
const AUTH_PAGES = ["/login", "/signup"];

/**
 * Middleware runs on the Edge runtime, which cannot use the Node "crypto"
 * module the same way route handlers can, so it does the cheap check —
 * "is there a session cookie at all?" — and redirects unauthenticated
 * requests away from protected pages immediately. The authoritative check
 * (does the cookie's token hash match a live, unexpired Session document in
 * MongoDB?) happens in `getCurrentUser()` inside each protected server
 * component/layout and API route. Both layers matter: middleware keeps
 * obviously-unauthenticated users from ever rendering the page shell, and
 * the server-side check is what actually enforces authorization.
 *
 * ── On the Next.js 16 "middleware is deprecated" warning ────────────────────
 *
 * Next 16.3.1 renames this convention to `proxy.ts` and prints a build warning
 * pointing at a codemod. The rename is NOT applied here, deliberately:
 *
 *  - `middleware.ts` still works in 16.x. The build succeeds and the route
 *    table lists it (as "Proxy (Middleware)"), so this is a deprecation notice,
 *    not a breakage.
 *  - The migration changes the file that gates every protected route in the
 *    app. Doing that in the same change as a security cleanup would mix a
 *    framework migration into work that needs to be reviewable on its own.
 *
 * Deferred to the final audit, where it can be done and verified by itself.
 * See README §7.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isProtected && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const isAuthPage = AUTH_PAGES.some((page) => pathname.startsWith(page));
  if (isAuthPage && hasSessionCookie) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
