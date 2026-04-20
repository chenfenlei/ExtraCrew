/** @type {import('next').NextConfig} */
const securityHeaders = [
  // Prevent clickjacking
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Force HTTPS
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Restrict referrer info
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Permissions policy — camera + microphone enabled for same-origin so the
  // 1:1 video/voice calling feature can call getUserMedia.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
  // Content Security Policy
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires these
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://cadhchbfvguyzdjjzqzl.supabase.co https://*.supabase.co wss://*.supabase.co", // All API calls go through /api/* — never direct to Anthropic
      "img-src 'self' data:",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

// Force fresh HTML on every request so a new deploy's chunk hashes are picked
// up on a soft reload (prevents "stale until Ctrl+Shift+R" after deploys).
// Hashed assets under /_next/static/* keep Next.js's default immutable caching.
const noCacheHeaders = [
  { key: "Cache-Control", value: "no-cache, no-store, must-revalidate, max-age=0" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
];

const nextConfig = {
  async headers() {
    return [
      // Security headers on every response
      { source: "/:path*", headers: securityHeaders },
      // HTML document responses: never cache (so new deploys are seen on soft reload).
      // Note: /_next/static/* keeps its default immutable caching because Next.js
      // sets those headers internally and they aren't overridden here.
      { source: "/", headers: noCacheHeaders },
    ];
  },
};

module.exports = nextConfig;
