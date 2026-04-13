// ─────────────────────────────────────────────────────────────────────────────
// app/api/claude/route.js  — SECURE SERVER-SIDE CLAUDE PROXY
//
// This file runs ONLY on Vercel's servers, never in the browser.
// The ANTHROPIC_API_KEY environment variable is read here and is
// NEVER sent to the client. Users cannot see it in DevTools.
//
// The frontend calls:  POST /api/claude
// This route calls:    https://api.anthropic.com/v1/messages
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

// Characters / patterns that should never reach the AI
const BLOCKED_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /\beval\s*\(/i,
];

function containsBlockedContent(text) {
  return BLOCKED_PATTERNS.some((p) => p.test(text));
}

function sanitizeForAI(str, maxLen = 4000) {
  if (typeof str !== "string") return "";
  return str.replace(/[<>]/g, "").trim().slice(0, maxLen);
}

export async function POST(request) {
  // ── 1. Rate limiting (by IP) ────────────────────────────────────────────
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const { allowed, remaining } = checkRateLimit(ip, 20, 60_000); // 20 req/min per IP

  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // ── 2. Parse & validate request body ───────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { system, userMessage, history = [], maxTokens = 1000 } = body;

  if (!userMessage || typeof userMessage !== "string") {
    return NextResponse.json({ error: "userMessage is required." }, { status: 400 });
  }
  if (userMessage.trim().length > 4000) {
    return NextResponse.json({ error: "Message too long." }, { status: 400 });
  }
  if (containsBlockedContent(userMessage)) {
    return NextResponse.json({ error: "Content not allowed." }, { status: 400 });
  }

  // Sanitize all inputs before forwarding
  const safeSystem   = system ? sanitizeForAI(system, 8000) : undefined;
  const safeMessage  = sanitizeForAI(userMessage);
  const safeHistory  = Array.isArray(history)
    ? history
        .slice(-20) // keep last 20 messages max (context window management)
        .map((m) => ({
          role:    m.role === "assistant" ? "assistant" : "user",
          content: sanitizeForAI(m.content ?? m.text ?? "", 2000),
        }))
        .filter((m) => m.content.length > 0)
    : [];

  // ── 3. Check API key is configured ─────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "sk-ant-YOUR_KEY_HERE") {
    console.error("ANTHROPIC_API_KEY is not set.");
    return NextResponse.json(
      { error: "AI service is not configured. Add ANTHROPIC_API_KEY to your environment variables." },
      { status: 503 }
    );
  }

  // ── 4. Forward to Anthropic — API key stays on the server ──────────────
  let anthropicRes;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,          // ← KEY STAYS SERVER-SIDE
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: Math.min(Number(maxTokens) || 1000, 4096),
        ...(safeSystem ? { system: safeSystem } : {}),
        messages: [...safeHistory, { role: "user", content: safeMessage }],
      }),
    });
  } catch (networkErr) {
    console.error("Network error reaching Anthropic:", networkErr);
    return NextResponse.json(
      { error: "Failed to reach AI service. Try again." },
      { status: 502 }
    );
  }

  // ── 5. Handle Anthropic errors ──────────────────────────────────────────
  if (!anthropicRes.ok) {
    const errBody = await anthropicRes.json().catch(() => ({}));
    console.error("Anthropic API error:", anthropicRes.status, errBody);

    if (anthropicRes.status === 429) {
      return NextResponse.json({ error: "AI quota exceeded. Try again later." }, { status: 429 });
    }
    if (anthropicRes.status === 401) {
      return NextResponse.json({ error: "AI service authentication failed. Check your API key." }, { status: 503 });
    }
    return NextResponse.json(
      { error: errBody?.error?.message ?? "AI service error." },
      { status: anthropicRes.status }
    );
  }

  // ── 6. Extract text from response ──────────────────────────────────────
  const data = await anthropicRes.json();
  const text = data.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n") ?? "";

  // ── 7. Return clean response with rate limit info ───────────────────────
  return NextResponse.json(
    { text },
    {
      status: 200,
      headers: {
        "X-RateLimit-Remaining": String(remaining),
        "Cache-Control": "no-store",
      },
    }
  );
}

// Reject all non-POST methods
export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}
