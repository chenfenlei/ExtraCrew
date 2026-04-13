// ─────────────────────────────────────────────────────────────────────────────
// lib/security.js
// Shared security utilities used by both server-side API routes and
// client-side components. Nothing in here exposes secrets.
// ─────────────────────────────────────────────────────────────────────────────

// ── Input Sanitization ────────────────────────────────────────────────────────
// Strip HTML tags + control characters to prevent XSS / injection.
export function sanitize(str, maxLen = 2000) {
  if (typeof str !== "string") return "";
  return str
    .replace(/[<>]/g, "")          // strip angle brackets (HTML)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip control chars
    .trim()
    .slice(0, maxLen);
}

// ── Validators ────────────────────────────────────────────────────────────────
export const Validators = {
  email:    (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  minLen:   (v, n) => typeof v === "string" && v.trim().length >= n,
  maxLen:   (v, n) => typeof v === "string" && v.trim().length <= n,
  required: (v) => typeof v === "string" && v.trim().length > 0,
  noScript: (v) => !/<script|javascript:|on\w+\s*=/i.test(v),
  numeric:  (v) => !isNaN(Number(v)) && v.trim() !== "",
};

// ── Content Policy ────────────────────────────────────────────────────────────
// Basic keyword check for clearly abusive content.
// In production: replace with a moderation API call.
export function passesContentPolicy(text) {
  if (typeof text !== "string") return false;
  const blocked = /\b(spam|scam|phish|doxx|stalk)\b/i;
  return !blocked.test(text);
}

// ── Client-side Rate Limiter ──────────────────────────────────────────────────
// Tracks calls in-memory per session. The real rate limiting that matters
// is enforced server-side in the API route. This is a UX guard only.
const _counts = {};
export const ClientRateLimit = {
  limits: { claude: 20, auth: 5 },
  check(key) {
    const now = Date.now();
    if (!_counts[key]) _counts[key] = { n: 0, reset: now + 60_000 };
    if (now > _counts[key].reset) _counts[key] = { n: 0, reset: now + 60_000 };
    const limit = this.limits[key] ?? 30;
    if (_counts[key].n >= limit) return false;
    _counts[key].n++;
    return true;
  },
  remaining(key) {
    const e = _counts[key];
    const limit = this.limits[key] ?? 30;
    if (!e) return limit;
    if (Date.now() > e.reset) return limit;
    return Math.max(0, limit - e.n);
  },
};

// ── Session Token Helpers (client-side only) ──────────────────────────────────
// These are lightweight client-side tokens for UI state only.
// In production replace with Clerk / NextAuth JWT handling.
export function generateSessionToken(userId) {
  const payload = { uid: userId, iat: Date.now(), exp: Date.now() + 86_400_000 };
  return btoa(JSON.stringify(payload));
}
export function verifySessionToken(token) {
  try {
    const p = JSON.parse(atob(token));
    if (Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}
