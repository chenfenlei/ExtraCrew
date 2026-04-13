// ─────────────────────────────────────────────────────────────────────────────
// lib/rateLimit.js  — SERVER-SIDE ONLY (runs in Node.js, not the browser)
//
// Simple in-memory rate limiter for API routes.
// Works perfectly on Vercel for a single serverless instance.
//
// For multi-region or high-traffic production use:
// → Replace with Upstash Redis: https://upstash.com/
//   npm install @upstash/ratelimit @upstash/redis
//   and use their `Ratelimit` class instead.
// ─────────────────────────────────────────────────────────────────────────────

const store = new Map(); // ip → { count, resetAt }

/**
 * Check whether a given IP is within its rate limit.
 * @param {string} ip        - the request IP
 * @param {number} limit     - max requests per window
 * @param {number} windowMs  - window length in milliseconds
 * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
 */
export function checkRateLimit(ip, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const key = ip ?? "unknown";

  let entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

// Clean up stale entries every 5 minutes so the Map doesn't grow forever
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 5 * 60_000);
}
