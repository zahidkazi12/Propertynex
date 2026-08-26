/**
 * Side-effect module: makes `server-only` resolvable in a plain Node process.
 *
 * Import this FIRST, before any module that transitively imports `server-only`:
 *
 *     import "../stubs/patch-server-only";
 *     import { checkRateLimit } from "../../lib/auth/rate-limit";
 *
 * Import declaration order is evaluation order, so putting it first guarantees
 * the patch is installed before the modules under test are loaded.
 *
 * Why a runtime patch and not a tsconfig `paths` entry: `paths` only affects
 * type resolution. The emitted CommonJS still calls `require("server-only")`,
 * which has no resolution outside Next's `react-server` export condition.
 * Overriding `_resolveFilename` redirects that one specifier and leaves every
 * other import untouched.
 */

declare const require: {
  (id: string): unknown;
  resolve(id: string): string;
};

const NodeModule = require("node:module") as {
  _resolveFilename(request: string, ...rest: unknown[]): string;
};

// Resolved once, from this file, to an absolute path. `_resolveFilename`
// resolves relative requests against the *requiring* module, which is several
// directories away from here, so a relative specifier would be looked up in the
// wrong place.
const SERVER_ONLY_STUB = require.resolve("./server-only.js");

const originalResolveFilename = NodeModule._resolveFilename;
NodeModule._resolveFilename = function (request: string, ...rest: unknown[]): string {
  if (request === "server-only") return SERVER_ONLY_STUB;
  return originalResolveFilename.call(this, request, ...rest);
};

export {};
