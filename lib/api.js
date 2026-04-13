// ─────────────────────────────────────────────────────────────────────────────
// lib/api.js  — CLIENT-SIDE API HELPERS
//
// All AI calls go through /api/claude (our server).
// The Anthropic API key is NEVER referenced here — it lives only on the server.
// ─────────────────────────────────────────────────────────────────────────────

import { sanitize, passesContentPolicy, ClientRateLimit } from "./security";

/**
 * Call Claude through our secure server-side proxy.
 *
 * @param {string}   system      - system prompt
 * @param {string}   userMessage - the user's message
 * @param {Array}    history     - prior conversation turns [{role, content}]
 * @param {Object}   options     - { maxTokens }
 * @returns {Promise<string>}    - Claude's response text
 */
export async function callClaude(system, userMessage, history = [], options = {}) {
  // Client-side guard (real enforcement is server-side)
  if (!ClientRateLimit.check("claude")) {
    throw new Error("RATE_LIMITED");
  }

  // Content policy check before sending
  if (!passesContentPolicy(userMessage)) {
    throw new Error("CONTENT_POLICY");
  }

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system,
      userMessage: sanitize(userMessage),
      history: history.map((m) => ({
        role:    m.role,
        content: sanitize(m.content ?? m.text ?? ""),
      })),
      maxTokens: options.maxTokens ?? 1000,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error("RATE_LIMITED");
    if (res.status === 503) throw new Error("SERVICE_UNAVAILABLE");
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }

  const data = await res.json();
  return data.text ?? "";
}
