// In-memory sliding-window rate limiter. Fine for a single-process hackathon
// deployment (docs/specs/mvp-spec.md section 14: "一定時間あたりのリクエスト数を制限する").
// Would need a shared store (e.g. Redis) behind a multi-instance deployment.

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

const hits = new Map<string, number[]>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  hits.set(key, timestamps);
  return timestamps.length > MAX_REQUESTS_PER_WINDOW;
}
