import "server-only";

/**
 * The storage seam.
 *
 * ── Why an interface at all, when there is one implementation ────────────────
 *
 * The brief says to use the existing storage architecture if suitable and not to
 * introduce an unnecessary storage system. There was no file-storage architecture
 * to reuse — the app persists rows through Prisma and nothing else — so something
 * had to be added. What is added is the *smallest* thing that is honest about the
 * shape of the problem: three methods, one local-filesystem driver behind them,
 * and zero new dependencies.
 *
 * The interface is not speculation. It is the same swap seam this codebase
 * already uses twice, for the same reason:
 *
 *   - `lib/auth/rate-limit.ts` — a `RateLimitStore` with an in-process default,
 *     so a Redis-backed store is an installation, not a rewrite.
 *   - `lib/otp/providers/` — a provider per channel, selected by environment
 *     variable, resolved fail-closed.
 *
 * A local filesystem is the right default for this deployment and the wrong one
 * for a multi-instance host, where two instances do not share a disk. Putting S3
 * behind these three methods later touches one new file and one environment
 * variable; writing `fs` calls into the upload route instead would touch the route,
 * the delete path, the serving path, and every test of all three. That is the
 * entire argument for the seam, and it is why the seam is three methods wide
 * rather than a general-purpose filesystem abstraction.
 *
 * Credentials for a remote driver belong in environment variables and nowhere
 * else — see `.env.example`. Nothing in this directory reads a secret today
 * because the local driver has none.
 */

export interface MediaStorage {
  /**
   * Identifier persisted to `PropertyMedia.storageDriver`.
   *
   * Stored per row, not read from configuration at serve time, so switching the
   * installed driver does not make everything uploaded under the previous one
   * unreadable — the row remembers where its bytes went.
   */
  readonly name: string;

  /**
   * Write bytes under `key`. Overwrites if the key somehow already exists; keys
   * carry 128 bits of randomness (`lib/media/keys.ts`), so in practice it never
   * does.
   *
   * `contentType` is passed for drivers that store it as object metadata (S3
   * does). The local driver has nowhere to put it and ignores it — which is
   * fine, because the authoritative copy is `PropertyMedia.mimeType`, and that
   * is what the serving route sends. No driver is ever asked what type a file is.
   */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;

  /**
   * Read bytes back, or null if the key holds nothing.
   *
   * Null rather than a throw for the missing case, because a row whose bytes have
   * gone is a 404 and not a 500 — and because the caller must not be able to tell
   * those two apart from the outside either way.
   */
  get(key: string): Promise<Buffer | null>;

  /** Remove the bytes. Succeeds when the key is already absent: deletion is
   *  idempotent, so a retried delete is not an error. */
  delete(key: string): Promise<void>;
}
