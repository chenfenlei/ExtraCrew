"use client";
// ─────────────────────────────────────────────────────────────────────────────
// app/_ec/shared.jsx — Eagerly-loaded module shared by every route component.
// ─────────────────────────────────────────────────────────────────────────────
//
// This module ends up in the main client bundle because both eager components
// (AuthProvider, AppShell, AuthScreen, LobbyPage, CallSystem) and the lazy
// page chunks import from it. Keep it small and side-effect-free: pure utils,
// shared contexts, tiny presentational components, and the Supabase client.
//
// Anything heavier (real WebRTC, page bodies, Common-App formatter, etc.) MUST
// live in its own file under app/_ec/ so it can be code-split.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useContext, createContext, memo } from "react";
import { supabase } from "@/lib/supabase";

export { supabase };

// ─── Init-order debug stream (gated on localStorage) ────────────────────────
// Enable in DevTools:  localStorage.setItem("ec:debug","1"); location.reload();
export const dbg = (stage, extra) => {
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("ec:debug") !== "1") return; } catch { return; }
  const t = (typeof performance !== "undefined" ? performance.now() : 0).toFixed(0);
  // eslint-disable-next-line no-console
  console.log(`[ec-init ${t}ms]`, stage, extra ?? "");
};

// ─── Contexts ───────────────────────────────────────────────────────────────
// Auth state — populated by <AuthProvider> in app/page.jsx.
export const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// Toast bus — populated by <ToastProvider> in app/page.jsx.
export const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

// Online presence — populated by <AppShell> via Supabase presence channel.
export const OnlineCtx = createContext(new Set());
export const useOnline = () => useContext(OnlineCtx);

// ─── Constants ──────────────────────────────────────────────────────────────
export const AVATAR_COLORS = ["#e8500a","#1a6b3c","#1a3a6b","#8b3a8b","#c07a14","#2a7a7a"];

export const ACTIVITY_TYPES = [
  "Academic","Art","Athletics: Club","Athletics: JV/Varsity","Career-Oriented",
  "Community Service (Volunteer)","Computer/Technology","Cultural","Dance","Debate/Speech",
  "Environmental","Family Responsibilities","Foreign Exchange","Journalism/Publication",
  "Junior R.O.T.C.","LGBT","Music: Instrumental","Music: Vocal","Religious","Research",
  "Robotics","School Spirit","Science/Math","Social Justice","Student Govt./Politics",
  "Theater/Drama","Work (paid)","Other Club/Activity",
];
export const GRADE_OPTIONS = ["9","10","11","12","Post-graduate"];

export const BG_TIER_FOR_PAGE = {
  lobby: "strong",
  advisor: "medium",
  mygroups: "medium",
  messages: "subtle",
  friends: "medium",
  aichat: "subtle",
  profile: "medium",
};

export const PAGES_CONFIG = [
  { id:"lobby",    label:"Lobby",     icon:"🏟" },
  { id:"advisor",  label:"Advisor",   icon:"📋" },
  { id:"mygroups", label:"My Groups", icon:"👥" },
  { id:"messages", label:"Messages",  icon:"💬" },
  { id:"friends",  label:"Friends",   icon:"🤝" },
  { id:"aichat",   label:"AI Chat",   icon:"🤖" },
  { id:"profile",  label:"Profile",   icon:"👤" },
];

// Group-card category palette (used by LobbyPage and MyGroupsPage)
export const CAT_BG     = { blue:"var(--blue-lt)", red:"var(--red-lt)", green:"var(--green-lt)", orange:"var(--orange-lt)" };
export const CAT_ACCENT = { blue:"var(--blue)",    red:"var(--red)",    green:"var(--green)",    orange:"var(--orange)"    };
export const CAT_SHADOW = { blue:"#1a3a6b55",      red:"#c0392b55",     green:"#1a6b3c55",       orange:"#e8500a55"        };

// ─── Pure utilities ─────────────────────────────────────────────────────────
export function avatarColor(n) {
  let h = 0;
  for (const c of (n||"?")) h = (h*31+c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}
export function initials(n) {
  return (n||"?") === "You" ? "ME" : (n||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
}
export function ago(ts) {
  const d = Math.floor((Date.now()-ts)/864e5);
  return d===0?"today":d===1?"yesterday":`${d}d ago`;
}
export function ftime(ts) {
  return new Date(ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
export function fileIcon(type) {
  if (!type) return "📎";
  if (type.startsWith("video/")) return "🎥";
  if (type.startsWith("audio/")) return "🎵";
  if (type === "application/pdf") return "📄";
  return "📎";
}

// Low-power detection — hint used by SiteBackground and heavy lists to trim work.
export function detectLowPower() {
  if (typeof window === "undefined") return false;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const saveData = typeof navigator !== "undefined" && navigator.connection?.saveData;
  const cores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency || 8) : 8;
  const mem   = typeof navigator !== "undefined" ? (navigator.deviceMemory || 4) : 4;
  const narrow = window.innerWidth < 700;
  return Boolean(reduced || saveData || cores <= 4 || mem <= 2 || narrow);
}

// ─── Tiny shared components ─────────────────────────────────────────────────
export function Spinner({ size = 18 }) {
  return <div className="spinner" style={{ width: size, height: size }} />;
}

export function Avatar({ name, size = 34 }) {
  const col = avatarColor(name);
  return (
    <div className="avatar" style={{ width: size, height: size, color: col, background: col + "18", fontSize: size < 28 ? ".58rem" : ".72rem" }}>
      {initials(name)}
    </div>
  );
}

export function MemberBar({ count, max }) {
  const pct = Math.round((count / max) * 100);
  const barColor = pct >= 90 ? "var(--red)" : pct >= 60 ? "var(--orange)" : "var(--ink)";
  return (
    <div>
      <div style={{ height: 4, background: "var(--paper3)", border: "1.5px solid var(--ink)", marginBottom: ".3rem" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: barColor, transition: "width .3s" }} />
      </div>
      <div style={{ fontSize: ".67rem", color: "var(--muted)", fontWeight: 600, letterSpacing: ".04em" }}>{count}/{max} members</div>
    </div>
  );
}

// SiteBackground is memoized — repainting on every shell render would be wasteful.
export const SiteBackground = memo(function SiteBackground({ tier = "subtle" }) {
  const [lowPower, setLowPower] = useState(false);
  const [hidden, setHidden]     = useState(false);

  useEffect(() => {
    setLowPower(detectLowPower());
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onChange = () => setLowPower(detectLowPower());
    mq?.addEventListener?.("change", onChange);
    window.addEventListener("resize", onChange, { passive: true });
    return () => {
      mq?.removeEventListener?.("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, []);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  if (lowPower) {
    return <div className="site-bg site-bg--static" data-tier={tier} aria-hidden="true" />;
  }

  return (
    <div className={`site-bg ${hidden ? "site-bg--paused" : ""}`} data-tier={tier} aria-hidden="true">
      <div className="bg-layer bg-grid" />
      <div className="bg-layer bg-shapes">
        <span className="bg-shape s1" />
        <span className="bg-shape s2" />
        <span className="bg-shape s3" />
        <span className="bg-shape s4" />
        <span className="bg-shape s5" />
      </div>
      <div className="bg-layer bg-orbs">
        <span className="bg-orb o1" />
        <span className="bg-orb o2" />
      </div>
      <div className="bg-layer bg-grain" />
      <div className="bg-layer bg-vignette" />
    </div>
  );
});

// Visually identical to the static #boot-shell in app/layout.jsx — used after
// hydration to surface a more specific status while the app finishes loading.
// Inline styles so it doesn't depend on globals.css or webfonts having loaded.
export function BootStateOverlay({ label }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: "1rem",
        background: "#f3efe6", color: "#0c1422",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        textAlign: "center", padding: "1rem",
      }}
    >
      <div style={{ fontSize: "2.4rem", fontWeight: 800, letterSpacing: ".04em", lineHeight: 1 }}>
        EXTRA<span style={{ color: "#d97a2c" }}>CREW</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: ".55rem", color: "#6b6660" }}>
        <Spinner size={14} />
        <span style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>
          {label}
        </span>
      </div>
    </div>
  );
}
