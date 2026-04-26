// ─────────────────────────────────────────────────────────────────────────────
// lib/perfMarks.js — Lightweight startup timing instrumentation
// ─────────────────────────────────────────────────────────────────────────────
//
// A tiny wrapper over `performance.mark` / `performance.measure` that records
// the same stages as the `dbg()` stream and lets us print a single summary
// table at "app interactive" (or on demand).
//
// Enable in the browser:
//   localStorage.setItem("ec:debug", "1"); location.reload();
//
// Key stages (keep names stable — used by the summary printer):
//   ec:app-mount         React root mounted (AuthProvider useEffect entered)
//   ec:auth-resolved     getSession() resolved (session? boolean known)
//   ec:auth-ready        profile loaded (or fallback) → phase = "ready"
//   ec:first-shell       static #boot-shell removed; real React UI visible
//   ec:app-interactive   AppShell has rendered real content (not the overlay)
//   ec:groups-loaded     groups fetch resolved
// ─────────────────────────────────────────────────────────────────────────────

const hasPerf = () =>
  typeof performance !== "undefined" && typeof performance.mark === "function";

function dbgEnabled() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("ec:debug") === "1";
  } catch { return false; }
}

export function mark(name) {
  if (!hasPerf()) return;
  try { performance.mark(name); } catch {}
}

// Mark only if it hasn't already been marked — useful for idempotent stages
// (e.g. "app-interactive" may be reached via multiple paths).
const _once = new Set();
export function markOnce(name) {
  if (_once.has(name)) return;
  _once.add(name);
  mark(name);
}

// Time between two marks in ms. Returns null if either mark is missing.
export function durationBetween(a, b) {
  if (!hasPerf()) return null;
  try {
    const entries = performance.getEntriesByType("mark");
    const ea = entries.find(e => e.name === a);
    const eb = entries.find(e => e.name === b);
    if (!ea || !eb) return null;
    return Math.round(eb.startTime - ea.startTime);
  } catch { return null; }
}

// Print a single readable summary — called once when the app becomes
// interactive. No-op unless ec:debug is set.
let _summaryPrinted = false;
export function printBootSummary() {
  if (_summaryPrinted || !dbgEnabled()) return;
  _summaryPrinted = true;
  const stages = [
    ["navigation-start → app-mount",  null,                 "ec:app-mount"],
    ["app-mount → auth-resolved",     "ec:app-mount",       "ec:auth-resolved"],
    ["auth-resolved → auth-ready",    "ec:auth-resolved",   "ec:auth-ready"],
    ["app-mount → first-shell",       "ec:app-mount",       "ec:first-shell"],
    ["app-mount → app-interactive",   "ec:app-mount",       "ec:app-interactive"],
    ["app-mount → groups-loaded",     "ec:app-mount",       "ec:groups-loaded"],
  ];
  const rows = stages.map(([label, a, b]) => {
    let ms = null;
    if (!a && hasPerf()) {
      const e = performance.getEntriesByType("mark").find(x => x.name === b);
      ms = e ? Math.round(e.startTime) : null;
    } else {
      ms = durationBetween(a, b);
    }
    return { stage: label, ms: ms == null ? "—" : ms + " ms" };
  });
  // eslint-disable-next-line no-console
  console.log("%c[ec] boot timings", "color:#d97a2c;font-weight:700");
  // eslint-disable-next-line no-console
  console.table(rows);
}
