/**
 * Stand-in for the `server-only` package when compiling modules for tests.
 *
 * `server-only` is a build-time guard: it exists so that importing a server
 * module from a Client Component fails the bundle. On the server itself Next
 * resolves it, via the `react-server` export condition, to an empty module that
 * does nothing at runtime. Plain Node has no such condition, so importing the
 * real package outside Next throws.
 *
 * Substituting an empty module here reproduces exactly what the server sees, so
 * the modules under test behave as they do in production.
 */
export {};
