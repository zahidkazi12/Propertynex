/**
 * Side-effect module: makes the `@/…` path alias resolvable in a plain Node
 * process.
 *
 * Import this FIRST, before any module that uses the alias:
 *
 *     import "../stubs/patch-path-alias";
 *     import { probeImage } from "../../lib/media/image";
 *
 * Same shape, and the same reason, as `patch-server-only`: a tsconfig `paths`
 * entry only teaches the *type checker* what `@/lib/media/constants` means. The
 * emitted CommonJS still calls `require("@/lib/media/constants")`, which Node
 * looks for in `node_modules/@/…` and does not find. Next's bundler rewrites
 * those specifiers; `node --test` has no bundler.
 *
 * The mapping is the build-output mirror of the alias. `tests/tsconfig.json` sets
 * `rootDir: ".."` and `outDir: ".build"`, so the compiler reproduces the project
 * tree under `tests/.build/` — this file lands at `tests/.build/tests/stubs/`,
 * which puts the mirrored project root two directories up. `@/x` therefore
 * becomes `<mirror>/x`, and the original resolver is left to find the extension
 * and to handle every specifier that is not an alias.
 *
 * Prefix-matched on `@/` exactly, so scoped packages (`@prisma/client`, `@types/…`)
 * are untouched.
 */

declare const require: {
  (id: string): unknown;
  resolve(id: string): string;
};
declare const __dirname: string;

const NodeModule = require("node:module") as {
  _resolveFilename(request: string, ...rest: unknown[]): string;
};
const { resolve } = require("node:path") as {
  resolve(...segments: string[]): string;
};

/** The compiled mirror of the project root: `tests/.build/`. */
const BUILD_ROOT = resolve(__dirname, "..", "..");

const originalResolveFilename = NodeModule._resolveFilename;
NodeModule._resolveFilename = function (request: string, ...rest: unknown[]): string {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, resolve(BUILD_ROOT, request.slice(2)), ...rest);
  }
  return originalResolveFilename.call(this, request, ...rest);
};

export {};
