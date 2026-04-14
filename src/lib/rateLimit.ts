/**
 * Simple in-memory rate limiter: max 10 requests per user per minute.
 * Keys are scoped per minute window so they auto-expire naturally.
 */
const store = new Map<string, number>();

export function checkRateLimit(userId: string): boolean {
  const window = Math.floor(Date.now() / 60_000);
  const key = `${userId}:${window}`;
  const count = store.get(key) ?? 0;
  if (count >= 10) return false;
  store.set(key, count + 1);
  return true;
}
