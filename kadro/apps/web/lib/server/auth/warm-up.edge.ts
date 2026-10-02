/** Edge runtime: no auth endpoints and no native Argon2id, so there is nothing to warm up. */
export function warmUp(): Promise<void> {
  return Promise.resolve();
}
