// ─────────────────────────────────────────────────────────────────────────────
// lib/sessionExpiry.js — Hard 1-hour client-side session cap
// ─────────────────────────────────────────────────────────────────────────────
//
// Why this exists:
//   Supabase's default refresh-token flow keeps a user signed in *indefinitely*
//   as long as they return within the refresh-token's TTL (which itself has no
//   hard cap unless Session Timeboxing is configured in the dashboard). We
//   want a hard product-level policy: "after 1 hour, you must sign in again,"
//   enforced regardless of what Supabase says about token validity.
//
// Storage contract (both values in localStorage so they survive reloads):
//   ec_session_started_at   — epoch ms of the original sign-in
//   ec_session_expired      — "1" if the last tear-down was an auto-expiry
//                             (set on expiry, read and cleared by AuthScreen)
//
// None of these keys are touched by Supabase itself; they're ours.
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour — change here only.

const K_STARTED_AT = "ec_session_started_at";
const K_EXPIRED    = "ec_session_expired";

function safeGet(k) {
  try { return typeof localStorage !== "undefined" ? localStorage.getItem(k) : null; } catch { return null; }
}
function safeSet(k, v) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(k, v); } catch {}
}
function safeRemove(k) {
  try { if (typeof localStorage !== "undefined") localStorage.removeItem(k); } catch {}
}

// Called on successful sign-in OR successful registration.
// Also called on TOKEN_REFRESHED only if we don't already have a start time
// (e.g. first page view after a Supabase-auto-restored session from a client
// that predates this feature).
export function recordSessionStart(nowMs) {
  const t = typeof nowMs === "number" ? nowMs : Date.now();
  safeSet(K_STARTED_AT, String(t));
  safeRemove(K_EXPIRED);
  return t;
}

// Initialize session start only if it doesn't already exist. Used on first
// bootstrap for a pre-existing Supabase session where we didn't record one.
export function ensureSessionStart(nowMs) {
  const existing = safeGet(K_STARTED_AT);
  if (existing && !Number.isNaN(Number(existing))) return Number(existing);
  return recordSessionStart(nowMs);
}

export function getSessionStart() {
  const v = safeGet(K_STARTED_AT);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function clearSessionStart() {
  safeRemove(K_STARTED_AT);
}

// How long the current session has left. Returns 0 if already expired; null
// if we have no recorded start time (caller should decide policy).
export function millisUntilExpiry(nowMs) {
  const start = getSessionStart();
  if (start == null) return null;
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  return Math.max(0, start + SESSION_MAX_AGE_MS - now);
}

export function isSessionExpired(nowMs) {
  const r = millisUntilExpiry(nowMs);
  return r != null && r <= 0;
}

// Set/consume the "was auto-expired" flag so AuthScreen can surface a reason
// the user was kicked back to the login form.
export function markExpired() { safeSet(K_EXPIRED, "1"); }
export function consumeExpiredFlag() {
  const v = safeGet(K_EXPIRED);
  if (v) safeRemove(K_EXPIRED);
  return v === "1";
}
