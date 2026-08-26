/**
 * Response-time levelling.
 *
 * Some endpoints must be indistinguishable to a caller regardless of which
 * internal branch they took — most importantly "request a passcode", where the
 * real branch performs a user lookup and a provider network call while the
 * decoy branch performs neither. Identical response *bodies* are not enough
 * when the response *times* differ by hundreds of milliseconds: that gap is a
 * usable account-existence oracle.
 *
 * `padTo` waits out the remainder of a minimum duration. It only ever delays;
 * a branch that legitimately took longer than the floor is returned
 * immediately rather than being made artificially slower still.
 */
export async function padTo(startedAt: number, minimumMs: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  const remaining = minimumMs - elapsed;
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, remaining));
}
