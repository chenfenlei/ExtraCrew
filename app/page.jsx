"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/page.jsx — Minimal shell. Only auth/lobby/calling are eager.
// Heavy non-critical pages (chat, advisor, profile, friends, my-groups, ai chat)
// are code-split via next/dynamic and fetched on demand.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import dynamic from "next/dynamic";
import { sanitize, Validators, ClientRateLimit, passesContentPolicy } from "@/lib/security";
import { CATS, CAT_TAG, SEED_GROUPS } from "@/lib/data";
import {
  recordSessionStart,
  ensureSessionStart,
  clearSessionStart,
  millisUntilExpiry,
  isSessionExpired,
  markExpired,
  consumeExpiredFlag,
} from "@/lib/sessionExpiry";
import { markOnce, printBootSummary } from "@/lib/perfMarks";
import {
  supabase, dbg,
  AuthCtx, useAuth, ToastCtx, useToast, OnlineCtx,
  Spinner, Avatar, MemberBar, SiteBackground, BootStateOverlay,
  ago, haversine,
  BG_TIER_FOR_PAGE, PAGES_CONFIG,
  CAT_BG, CAT_ACCENT, CAT_SHADOW,
} from "./_ec/shared";
import { CallProvider } from "./_ec/CallSystem";
import UserProfileModal from "./_ec/UserProfileModal";

// ─── Lazy page chunks ────────────────────────────────────────────────────────
// Each of these becomes its own webpack chunk fetched only when the user
// actually navigates to that section. ssr:false keeps them out of the server
// bundle entirely — the auth-gated app is client-rendered anyway.
const ChatPage     = dynamic(() => import("./_ec/ChatPage"),     { ssr: false, loading: () => <BootStateOverlay label="Loading chat…"/> });
const AIChatPage   = dynamic(() => import("./_ec/AIChatPage"),   { ssr: false, loading: () => <BootStateOverlay label="Loading AI chat…"/> });
const AdvisorPage  = dynamic(() => import("./_ec/AdvisorPage"),  { ssr: false, loading: () => <BootStateOverlay label="Loading advisor…"/> });
const ProfilePage  = dynamic(() => import("./_ec/ProfilePage"),  { ssr: false, loading: () => <BootStateOverlay label="Loading profile…"/> });
const FriendsPage  = dynamic(() => import("./_ec/FriendsPage"),  { ssr: false, loading: () => <BootStateOverlay label="Loading friends…"/> });
const MyGroupsPage = dynamic(() => import("./_ec/MyGroupsPage"), { ssr: false, loading: () => <BootStateOverlay label="Loading groups…"/> });

// ═══════════════════════════════════════════════════════════════════════════
// AUTH PROVIDER
// ═══════════════════════════════════════════════════════════════════════════
function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Auth state machine: "boot" → "no-session" | ("session-loading-profile" → "ready")
  const [authPhase, setAuthPhase] = useState("boot");

  const expiryTimerRef = useRef(null);
  const sessionLoadSeqRef = useRef(0);
  const authEventTimersRef = useRef(new Set());
  const completeSessionRef = useRef(null);
  const acceptedSessionRef = useRef(false);
  const readyUserIdRef = useRef(null);

  const authLog = useCallback((stage, extra) => {
    dbg(stage, extra);
    // eslint-disable-next-line no-console
    console.log("[ec-auth]", stage, extra ?? "");
  }, []);

  const minimalFromSession = useCallback((su) => ({
    id: su.id,
    email: su.email || "",
    name: (su.user_metadata?.name) || (su.email?.split("@")[0]) || "Member",
    role: "member",
    avatar: ((su.user_metadata?.name?.split(" ").map(w => w[0]).join("")) || (su.email?.[0]) || "M").slice(0, 2).toUpperCase(),
    bio: "",
    joined_groups: [],
    activities: [],
    awards: [],
    gpa: "", sat: "", act: "",
    intended_major: "", avatar_url: "",
    social_links: {},
  }), []);

  const scheduleExpiryTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    const rem = millisUntilExpiry();
    if (rem == null) return;
    dbg("expiry:schedule", { msUntilExpiry: rem });
    expiryTimerRef.current = setTimeout(async () => {
      dbg("expiry:fired");
      dbg("auth:expired-signout", { source: "timer" });
      // eslint-disable-next-line no-console
      console.log("[ec-auth]", "auth:expired-signout", { source: "timer" });
      markExpired();
      try { await supabase.auth.signOut(); } catch {}
    }, rem);
  }, []);

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    markOnce("ec:app-mount");

    authLog("auth:bootstrap-start");

    const finishNoSession = ({ force = false, source = "unknown" } = {}) => {
      if (!mounted) return;
      if (!force && acceptedSessionRef.current) {
        authLog("auth:no-session-ignored", { source });
        return;
      }
      try { localStorage.removeItem("ec_user_cache"); } catch {}
      acceptedSessionRef.current = false;
      readyUserIdRef.current = null;
      clearSessionStart();
      clearExpiryTimer();
      setUser(null);
      setAuthPhase("no-session");
      authLog("auth:no-session");
    };

    const expireAndSignOut = async (source, session) => {
      authLog("auth:expired-signout", { source, id: session?.user?.id });
      markExpired();
      clearExpiryTimer();
      try { await supabase.auth.signOut(); } catch (e) { authLog("auth:signout-error", e?.message); }
      clearSessionStart();
      if (!mounted) return;
      acceptedSessionRef.current = false;
      readyUserIdRef.current = null;
      setUser(null);
      setAuthPhase("no-session");
      authLog("auth:no-session");
    };

    const loadSessionUser = async (session, source) => {
      const seq = ++sessionLoadSeqRef.current;
      if (!session?.user) {
        finishNoSession({ source });
        return;
      }
      acceptedSessionRef.current = true;

      const now = Date.now();
      const expired = isSessionExpired(now);
      authLog("auth:expiry-check", { source, id: session.user.id, expired, msUntilExpiry: millisUntilExpiry(now) });
      if (expired) {
        await expireAndSignOut(source, session);
        return;
      }

      const start = ensureSessionStart(now);
      authLog("auth:get-session-restored", { source, id: session.user.id, sessionAgeMs: now - start });
      if (readyUserIdRef.current !== session.user.id) setAuthPhase("session-loading-profile");

      const PROFILE_TIMEOUT_MS = 5000;
      const tProf = (typeof performance !== "undefined" ? performance.now() : Date.now());
      authLog("auth:profile-fetch-start", { source, id: session.user.id });

      const profileP = supabase.from("users").select("*").eq("id", session.user.id).single();
      const profileTimeoutP = new Promise(resolve =>
        setTimeout(() => resolve({ data: null, error: { code: "TIMEOUT", message: "Profile fetch timed out" } }), PROFILE_TIMEOUT_MS)
      );

      let profile = null, profileError = null;
      try {
        const r = await Promise.race([profileP, profileTimeoutP]);
        profile = r?.data || null;
        profileError = r?.error || null;
      } catch (e) {
        profileError = { code: "EXCEPTION", message: e?.message || "profile fetch threw" };
      }
      if (!mounted || seq !== sessionLoadSeqRef.current) return;

      const elapsed = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - tProf);
      if (profileError?.code === "TIMEOUT") authLog("auth:profile-timeout", { source, elapsed });
      authLog("auth:profile-fetch-end", { source, hasProfile: !!profile, code: profileError?.code, msg: profileError?.message, elapsed });

      let stubToUpsert = null;

      if (profile) {
        const u = { ...profile, password: undefined };
        readyUserIdRef.current = u.id;
        setUser(u);
        try { localStorage.setItem("ec_user_cache", JSON.stringify(u)); } catch {}
      } else {
        let cached = null;
        try {
          const raw = localStorage.getItem("ec_user_cache");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.id === session.user.id) cached = parsed;
          }
        } catch {}
        const fallback = cached || minimalFromSession(session.user);
        readyUserIdRef.current = fallback.id;
        setUser({ ...fallback, _profileLoadFailed: !cached && profileError?.code !== "PGRST116" });
        try { localStorage.setItem("ec_user_cache", JSON.stringify(fallback)); } catch {}
        authLog("auth:fallback-user", { source, usedCache: !!cached, code: profileError?.code });
        if (profileError?.code === "PGRST116") stubToUpsert = fallback;
      }

      if (!mounted || seq !== sessionLoadSeqRef.current) return;
      setAuthPhase("ready");
      markOnce("ec:auth-ready");
      authLog("auth:ready", { source, id: session.user.id });
      scheduleExpiryTimer();

      if (stubToUpsert) {
        supabase.from("users").upsert([stubToUpsert], { onConflict: "id", ignoreDuplicates: true })
          .then(({ error }) => {
            if (error) authLog("auth:profile-stub-upsert-failed", error.message);
            else authLog("auth:profile-stub-upserted");
          })
          .catch(e => authLog("auth:profile-stub-upsert-failed", e?.message));
      }
    };

    completeSessionRef.current = loadSessionUser;

    const GET_SESSION_TIMEOUT_MS = 8000;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    authLog("auth:get-session-start");
    Promise.race([
      supabase.auth.getSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("__GET_SESSION_TIMEOUT__")), GET_SESSION_TIMEOUT_MS)),
    ]).then(async ({ data: { session } }) => {
      if (!mounted) return;
      const dt = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0));
      markOnce("ec:auth-resolved");

      if (session?.user) {
        await loadSessionUser(session, "getSession");
      } else {
        authLog("auth:get-session-empty", { ms: dt });
        finishNoSession({ source: "getSession" });
      }
    }).catch(e => {
      if (!mounted) return;
      markOnce("ec:auth-resolved");
      authLog("auth:get-session-error", e?.message);
      finishNoSession({ source: "getSession-error" });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;
        if (event === "INITIAL_SESSION") authLog("auth:event INITIAL_SESSION", { hasSession: !!session?.user });
        else authLog("auth:event", event);

        const timer = setTimeout(() => {
          authEventTimersRef.current.delete(timer);
          if (!mounted) return;

          if (event === "SIGNED_OUT" || !session?.user) {
            finishNoSession({ force: event === "SIGNED_OUT", source: event });
            return;
          }

          loadSessionUser(session, event);
        }, 0);
        authEventTimersRef.current.add(timer);
      }
    );

    return () => {
      mounted = false;
      authEventTimersRef.current.forEach(timer => clearTimeout(timer));
      authEventTimersRef.current.clear();
      completeSessionRef.current = null;
      subscription.unsubscribe();
      clearExpiryTimer();
    };
  }, [authLog, minimalFromSession, scheduleExpiryTimer, clearExpiryTimer]);

  async function login(email, password) {
    if (!ClientRateLimit.check("auth")) return { ok: false, error: "Too many attempts. Wait 1 minute." };

    const SIGNIN_TIMEOUT_MS = 15000;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    dbg("login:signin-start");
    authLog("auth:signin-start");

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("__LOGIN_TIMEOUT__")), SIGNIN_TIMEOUT_MS)
    );

    let result;
    try {
      result = await Promise.race([
        supabase.auth.signInWithPassword({
          email: email.toLowerCase().trim(),
          password,
        }),
        timeoutPromise,
      ]);
    } catch (err) {
      const elapsed = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
      dbg("login:signin-error", { msg: err?.message, elapsed });
      authLog(err?.message === "__LOGIN_TIMEOUT__" ? "auth:signin-timeout" : "auth:signin-error", { msg: err?.message, elapsed });
      if (err?.message === "__LOGIN_TIMEOUT__") {
        return { ok: false, error: "Login request timed out. Please try again." };
      }
      return { ok: false, error: "Network error during sign-in. Try again." };
    }

    const { data, error } = result || {};
    const elapsed = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    dbg("login:signin-resolved", { hasUser: !!data?.user, error: error?.message, elapsed });
    authLog("auth:signin-end", { hasUser: !!data?.user, hasSession: !!data?.session, error: error?.message, elapsed });

    if (error) return { ok: false, error: error.message };
    if (!data?.user) return { ok: false, error: "Sign-in failed. Try again." };

    recordSessionStart();
    const fallbackUser = minimalFromSession(data.user);
    acceptedSessionRef.current = true;
    readyUserIdRef.current = fallbackUser.id;
    setUser(fallbackUser);
    try { localStorage.setItem("ec_user_cache", JSON.stringify(fallbackUser)); } catch {}
    setAuthPhase("ready");
    markOnce("ec:auth-ready");
    authLog("auth:fallback-user", { source: "signInImmediate", usedCache: false, code: "SIGNIN_IMMEDIATE" });
    authLog("auth:ready", { source: "signInImmediate", id: data.user.id });
    scheduleExpiryTimer();
    if (data?.session && completeSessionRef.current) {
      setTimeout(() => completeSessionRef.current?.(data.session, "signInResponse"), 0);
    }
    return { ok: true };
  }

  async function register(name, email, password) {
    if (!ClientRateLimit.check("auth")) return { ok: false, error: "Too many attempts. Wait 1 minute." };

    const SIGNUP_TIMEOUT_MS = 15000;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    dbg("register:signup-start");

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("__SIGNUP_TIMEOUT__")), SIGNUP_TIMEOUT_MS)
    );

    let result;
    try {
      result = await Promise.race([
        supabase.auth.signUp({
          email: email.toLowerCase().trim(),
          password,
          options: { data: { name: sanitize(name, 60) } },
        }),
        timeoutPromise,
      ]);
    } catch (err) {
      const elapsed = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
      dbg("register:signup-error", { msg: err?.message, elapsed });
      if (err?.message === "__SIGNUP_TIMEOUT__") {
        return { ok: false, error: "Sign-up request timed out. Check your connection and try again." };
      }
      return { ok: false, error: "Network error during sign-up. Try again." };
    }

    const { data, error } = result || {};
    const elapsed = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    dbg("register:signup-resolved", { hasUser: !!data?.user, error: error?.message, elapsed });

    if (error) return { ok: false, error: error.message };
    if (!data?.user) return { ok: false, error: "Sign-up failed. Try again." };

    recordSessionStart();

    const profile = {
      id: data.user.id,
      email: email.toLowerCase().trim(),
      name: sanitize(name, 60),
      role: "member",
      avatar: name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase(),
      bio: "",
      joined_groups: [],
      activities: [],
      awards: [],
      gpa: "",
      sat: "",
      act: "",
      intended_major: "",
      avatar_url: "",
      social_links: {},
    };

    try {
      await supabase.from("users").upsert([profile], { onConflict: "id" });
      dbg("register:profile-upserted");
    } catch (e) {
      dbg("register:profile-upsert-failed", e?.message);
    }

    try { localStorage.setItem("ec_user_cache", JSON.stringify(profile)); } catch {}
    return { ok: true };
  }

  function logout() {
    clearExpiryTimer();
    clearSessionStart();
    acceptedSessionRef.current = false;
    readyUserIdRef.current = null;
    supabase.auth.signOut();
    sessionStorage.clear();
    localStorage.removeItem("ec_user_cache");
    setUser(null);
  }

  function updateProfile(updates) {
    setUser(u => {
      const next = { ...u, ...updates };
      try { localStorage.setItem("ec_user_cache", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  return (
    <AuthCtx.Provider value={{ user, login, logout, register, authPhase, updateProfile }}>
      {children}
    </AuthCtx.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST PROVIDER
// ═══════════════════════════════════════════════════════════════════════════
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  function toast(msg, type = "info", duration = 3500) {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), duration);
  }
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-wrap">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === "success" && "✓ "}
            {t.type === "error"   && "✗ "}
            {t.type === "warning" && "⚠ "}
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH SCREEN
// ═══════════════════════════════════════════════════════════════════════════
function AuthScreen() {
  const [mode, setMode]     = useState("login");
  const [f, setF]           = useState({ name:"", email:"", password:"", confirm:"" });
  const [errors, setErrors] = useState({});
  const [apiErr, setApiErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [wasExpired] = useState(() => consumeExpiredFlag());
  const [expiredDismissed, setExpiredDismissed] = useState(false);
  const { login, register } = useAuth();
  const toast = useToast();

  const inflight = useRef(false);
  const mounted  = useRef(true);
  const submitWatchdogRef = useRef(null);
  const submitRunRef = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (submitWatchdogRef.current) clearTimeout(submitWatchdogRef.current);
    };
  }, []);

  const s = (k, v) => { setF(p=>({...p,[k]:v})); setErrors(p=>({...p,[k]:""})); setApiErr(""); };

  function validate() {
    const e = {};
    if (mode === "register" && !Validators.minLen(f.name, 2)) e.name = "Name must be at least 2 characters.";
    if (!Validators.email(f.email))                           e.email = "Enter a valid email address.";
    if (!Validators.minLen(f.password, 8))                   e.password = "Password must be at least 8 characters.";
    if (mode === "register" && f.password !== f.confirm)      e.confirm = "Passwords don't match.";
    return e;
  }

  async function submit(ev) {
    if (ev?.preventDefault) ev.preventDefault();
    if (inflight.current || loading) return;
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const runId = submitRunRef.current + 1;
    submitRunRef.current = runId;
    const submitMode = mode;
    const timeoutError = submitMode === "login"
      ? "Login request timed out. Please try again."
      : "Sign-up request timed out. Please try again.";

    inflight.current = true;
    setLoading(true); setApiErr("");
    if (submitWatchdogRef.current) clearTimeout(submitWatchdogRef.current);

    try {
      const watchdogResult = new Promise(resolve => {
        submitWatchdogRef.current = setTimeout(() => {
          if (mounted.current && submitRunRef.current === runId) {
            inflight.current = false;
            setLoading(false);
            setApiErr(timeoutError);
          }
          resolve({ ok: false, error: timeoutError });
        }, 15000);
      });

      const authResult = submitMode === "login"
        ? login(f.email, f.password)
        : register(f.name, f.email, f.password);

      const res = await Promise.race([authResult, watchdogResult]);
      if (!mounted.current || submitRunRef.current !== runId) return;
      if (!res?.ok) {
        setApiErr(res?.error || "Something went wrong. Try again.");
        return;
      }
      toast(submitMode === "login" ? "Welcome back!" : "Account created!", "success");
    } catch (err) {
      if (mounted.current && submitRunRef.current === runId) {
        setApiErr(err?.message || "Something went wrong. Try again.");
      }
    } finally {
      if (submitWatchdogRef.current) {
        clearTimeout(submitWatchdogRef.current);
        submitWatchdogRef.current = null;
      }
      if (mounted.current && submitRunRef.current === runId) {
        inflight.current = false;
        setLoading(false);
      }
    }
  }

  return (
    <div className="auth-screen">
      <SiteBackground tier="auth" />
      <div className="auth-box page-surface">
        <div style={{ textAlign:"center", marginBottom:"2rem" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"2.5rem", letterSpacing:".04em", lineHeight:1 }}>
            EXTRA<span style={{ color:"var(--orange)" }}>CREW</span>
          </div>
          <div style={{ fontSize:".72rem", fontWeight:600, letterSpacing:".1em", textTransform:"uppercase", color:"var(--muted)", marginTop:".4rem" }}>
            Connecting Students · Building Futures
          </div>
        </div>

        {wasExpired && !expiredDismissed && (
          <div role="status" aria-live="polite"
               style={{ background:"var(--amber-lt)", border:"2px solid var(--amber)", padding:".65rem .8rem", marginBottom:"1.1rem", fontSize:".78rem", color:"var(--ink)", display:"flex", alignItems:"flex-start", gap:".55rem" }}>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, letterSpacing:".04em", marginBottom:".15rem" }}>Your session expired. Please sign in again.</div>
              <div style={{ color:"var(--muted)", fontSize:".72rem" }}>Sessions last 1 hour.</div>
            </div>
            <button type="button" onClick={() => setExpiredDismissed(true)}
                    aria-label="Dismiss"
                    style={{ border:"none", background:"transparent", fontSize:"1rem", lineHeight:1, cursor:"pointer", color:"var(--muted)" }}>×</button>
          </div>
        )}
        <div style={{ display:"flex", border:"2px solid var(--ink)", borderRadius:"12px", overflow:"hidden", marginBottom:"1.6rem" }}>
          {["login","register"].map(m => (
            <button type="button" key={m} disabled={loading} onClick={() => { setMode(m); setErrors({}); setApiErr(""); }}
              style={{ flex:1, padding:".5rem", fontFamily:"var(--font-body)", fontWeight:700, fontSize:".7rem", letterSpacing:".07em", textTransform:"uppercase", border:"none", cursor:loading?"not-allowed":"pointer", background:mode===m?"var(--ink)":"transparent", color:mode===m?"var(--paper)":"var(--muted)", opacity:loading&&mode!==m?.5:1, transition:"all .12s" }}>
              {m === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} noValidate style={{ display:"flex", flexDirection:"column", gap:".85rem" }}>
          <fieldset disabled={loading} style={{ border:"none", padding:0, display:"contents" }}>
            {mode === "register" && (
              <div>
                <label>Full Name</label>
                <input autoComplete="name" value={f.name} onChange={e=>s("name",e.target.value)} placeholder="Alex Johnson" className={errors.name?"error":""} maxLength={60}/>
                {errors.name && <div className="field-error">{errors.name}</div>}
              </div>
            )}
            <div>
              <label>Email</label>
              <input type="email" inputMode="email" autoComplete="email" value={f.email} onChange={e=>s("email",e.target.value)} placeholder="you@school.edu" className={errors.email?"error":""}/>
              {errors.email && <div className="field-error">{errors.email}</div>}
            </div>
            <div>
              <label>Password</label>
              <input type="password" autoComplete={mode==="login"?"current-password":"new-password"} value={f.password} onChange={e=>s("password",e.target.value)} placeholder={mode==="register"?"Min. 8 characters":"••••••••"} className={errors.password?"error":""} maxLength={128}/>
              {errors.password && <div className="field-error">{errors.password}</div>}
            </div>
            {mode === "register" && (
              <div>
                <label>Confirm Password</label>
                <input type="password" autoComplete="new-password" value={f.confirm} onChange={e=>s("confirm",e.target.value)} placeholder="Repeat password" className={errors.confirm?"error":""}/>
                {errors.confirm && <div className="field-error">{errors.confirm}</div>}
              </div>
            )}
            {apiErr && (
              <div role="alert" aria-live="polite" style={{ background:"var(--red-lt)", border:"2px solid var(--red)", padding:".6rem .8rem", fontSize:".78rem", color:"var(--red)", fontWeight:600 }}>
                ✗ {apiErr}
              </div>
            )}
            <button type="submit" className="btn btn-orange" disabled={loading} aria-busy={loading} style={{ justifyContent:"center", marginTop:".3rem" }}>
              {loading ? <><Spinner size={14}/>{mode==="login"?"Signing in…":"Creating account…"}</> : mode==="login" ? "Sign In →" : "Create Account →"}
            </button>
          </fieldset>
        </form>

        <div style={{ marginTop:"1.4rem", padding:"1rem", background:"var(--paper2)", border:"1.5px solid var(--paper3)", fontSize:".72rem", color:"var(--muted)" }}>
          <div style={{ fontWeight:700, letterSpacing:".05em", textTransform:"uppercase", marginBottom:".4rem", fontSize:".62rem" }}>Demo Credentials</div>
          <div>📧 demo@extracrew.app</div>
          <div>🔑 demo1234</div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOBBY (eager — landing page)
// ═══════════════════════════════════════════════════════════════════════════
function ApplyModal({ g, onClose, onSubmit }) {
  const toast = useToast();
  const [f, setF] = useState({ gpa:"", sat:"", act:"", message:"" });
  const s = (k, v) => setF(p => ({...p, [k]:v}));
  const reqs = g.requirements || {};
  function submit() {
    if (f.message && !passesContentPolicy(f.message)) { toast("Content not allowed.", "error"); return; }
    onSubmit({ gpa: f.gpa, sat: f.sat, act: f.act, message: sanitize(f.message, 500) });
    onClose();
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:460 }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"1.6rem", letterSpacing:".02em", marginBottom:".4rem" }}>APPLY TO GROUP</div>
        <div style={{ fontWeight:700, fontSize:".9rem", marginBottom:"1.2rem", color:"var(--muted)" }}>{g.name}</div>
        {(reqs.min_gpa || reqs.min_sat || reqs.min_act || reqs.text) && (
          <div style={{ background:"var(--paper2)", border:"1.5px solid var(--paper3)", padding:".8rem", marginBottom:"1.2rem", fontSize:".82rem" }}>
            <div style={{ fontWeight:700, fontSize:".6rem", letterSpacing:".07em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".4rem" }}>Requirements</div>
            {reqs.min_gpa && <div>Min GPA: <strong>{reqs.min_gpa}</strong></div>}
            {reqs.min_sat && <div>Min SAT: <strong>{reqs.min_sat}</strong></div>}
            {reqs.min_act && <div>Min ACT: <strong>{reqs.min_act}</strong></div>}
            {reqs.text && <div style={{ marginTop:".4rem", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>{reqs.text}</div>}
          </div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:".7rem" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:".6rem" }}>
            <div><label>Your GPA</label><input value={f.gpa} onChange={e=>s("gpa",e.target.value)} placeholder="4.0" maxLength={6}/></div>
            <div><label>SAT Score</label><input value={f.sat} onChange={e=>s("sat",e.target.value)} placeholder="1500" maxLength={6}/></div>
            <div><label>ACT Score</label><input value={f.act} onChange={e=>s("act",e.target.value)} placeholder="34" maxLength={4}/></div>
          </div>
          <div>
            <label>Message to Leader</label>
            <textarea rows={3} value={f.message} onChange={e=>s("message",e.target.value)} placeholder="Tell the leader why you want to join…" maxLength={500}/>
          </div>
        </div>
        <div style={{ display:"flex", gap:".6rem", marginTop:"1.2rem", justifyContent:"flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-orange" onClick={submit}>Submit Application →</button>
        </div>
      </div>
    </div>
  );
}

const GroupCard = memo(function GroupCard({ g, onJoin, onApply, userId }) {
  const { user: currentUser } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUser, setProfileUser] = useState(null);
  const cat        = CATS.find(c => c.id === g.category);
  const isIn       = g.members.includes(userId);
  const full       = g.members.length >= g.max;
  const groupType  = g.group_type || "open";
  const hasApplied = (g.applications || []).some(a => a.userId === userId && a.status === "pending");
  const cardBg     = CAT_BG[cat?.color]     || "var(--chalk)";
  const cardAccent = CAT_ACCENT[cat?.color] || "var(--ink)";
  const cardShadow = CAT_SHADOW[cat?.color] || "rgba(15,14,13,.35)";

  async function openCreator() {
    if (g.byId === currentUser?.id) {
      setProfileUser(currentUser);
    } else {
      const { data } = await supabase.from("users").select("name, bio, activities, awards").eq("id", g.byId).single();
      if (data) setProfileUser(data);
    }
    setProfileOpen(true);
  }

  return (
    <>
      <div className="card" style={{ display:"flex", flexDirection:"column", gap:".9rem", background: cardBg, borderColor: cardAccent, boxShadow: `4px 4px 0 ${cardShadow}` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:".5rem" }}>
          <div>
            <div style={{ fontSize:".63rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".3rem" }}>{cat?.icon} {g.sub}</div>
            <div style={{ fontFamily:"var(--font-body)", fontWeight:700, fontSize:"1rem", lineHeight:1.25 }}>{g.name}</div>
          </div>
          <span className={`tag ${CAT_TAG[cat?.color]||""}`} style={{ flexShrink:0 }}>{g.remote ? "Remote" : g.location.split(",")[0]}</span>
        </div>
        <p style={{ fontSize:".83rem", color:"var(--muted)", lineHeight:1.6, fontStyle:"italic", fontFamily:"var(--font-serif)" }}>{g.desc}</p>
        <div style={{ display:"flex", flexWrap:"wrap", gap:".3rem" }}>
          {g.tags.map(t => <span key={t} className="tag" style={{ fontSize:".6rem" }}>{t}</span>)}
          {groupType === "invite_only" && <span className="tag" style={{ fontSize:".6rem", background:"var(--blue)", color:"var(--paper)", border:"none" }}>Invite Only</span>}
          {groupType === "closed"      && <span className="tag" style={{ fontSize:".6rem", background:"var(--red)",  color:"var(--paper)", border:"none" }}>Closed</span>}
        </div>
        <div style={{ borderTop:"1.5px solid var(--paper3)", paddingTop:".85rem" }}>
          <MemberBar count={g.members.length} max={g.max}/>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:".7rem" }}>
            <div style={{ display:"flex", alignItems:"center", gap:".4rem" }}>
              <span style={{ fontSize:".65rem", color:"var(--muted2)", textTransform:"uppercase", letterSpacing:".05em", fontWeight:600 }}>{ago(g.ts)}</span>
              <button onClick={openCreator} style={{ background:"none", border:"none", padding:0, cursor:"pointer", fontSize:".6rem", color:"var(--muted2)", fontFamily:"var(--font-body)", textDecoration:"underline dotted" }}>· {g.byName}</button>
            </div>
            {isIn ? (
              <span className="tag tag-green">✓ Joined</span>
            ) : full ? (
              <span style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em" }}>Full</span>
            ) : groupType === "closed" ? (
              <span style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em" }}>Closed</span>
            ) : groupType === "invite_only" ? (
              hasApplied
                ? <span style={{ fontSize:".72rem", color:"var(--blue)", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em" }}>Applied</span>
                : <button className="btn btn-sm" onClick={() => onApply(g)}>Apply →</button>
            ) : (
              <button className="btn btn-sm" onClick={() => onJoin(g.id)}>Join →</button>
            )}
          </div>
        </div>
      </div>
      {profileOpen && profileUser && <UserProfileModal u={profileUser} onClose={() => { setProfileOpen(false); setProfileUser(null); }}/>}
    </>
  );
}, (prev, next) => (
  prev.g === next.g && prev.userId === next.userId && prev.onJoin === next.onJoin && prev.onApply === next.onApply
));

function CreateModal({ onClose, onCreate, userId, userName }) {
  const toast = useToast();
  const [f, setF]           = useState({ name:"", category:"", sub:"", location:"", remote:false, desc:"", tags:"", max:8, group_type:"open", min_gpa:"", min_sat:"", min_act:"", req_text:"" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const s = (k, v) => { setF(p=>({...p,[k]:v})); setErrors(p=>({...p,[k]:""})); };

  function validate() {
    const e = {};
    if (!Validators.required(f.name))           e.name     = "Group name is required.";
    if (!Validators.maxLen(f.name, 80))          e.name     = "Name too long (max 80 chars).";
    if (!Validators.noScript(f.name))            e.name     = "Invalid characters.";
    if (!f.category)                             e.category = "Select a category.";
    if (!Validators.minLen(f.desc, 20))          e.desc     = "Describe your group in at least 20 characters.";
    if (!Validators.noScript(f.desc))            e.desc     = "Invalid characters.";
    if (f.req_text && !Validators.noScript(f.req_text)) e.req_text = "Invalid characters.";
    return e;
  }

  async function submit() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    const reqs = {
      ...(f.min_gpa  ? { min_gpa:  parseFloat(f.min_gpa)  } : {}),
      ...(f.min_sat  ? { min_sat:  parseInt(f.min_sat)    } : {}),
      ...(f.min_act  ? { min_act:  parseInt(f.min_act)    } : {}),
      ...(f.req_text ? { req_text: sanitize(f.req_text, 200) } : {}),
    };
    const group = {
      name:         sanitize(f.name, 80),
      category:     f.category,
      sub:          sanitize(f.sub, 60) || f.category,
      location:     f.remote ? "Remote" : sanitize(f.location, 60) || "Remote",
      remote:       f.remote,
      members:      [userId],
      max:          Math.min(50, Math.max(2, Number(f.max) || 8)),
      desc:         sanitize(f.desc, 500),
      tags:         f.tags.split(",").map(t => sanitize(t.trim(), 30)).filter(Boolean).slice(0, 8),
      byId:         userId,
      byName:       userName,
      group_type:   f.group_type,
      requirements: reqs,
      applications: [],
    };
    setSubmitting(true);
    const { data, error } = await supabase.from("groups").insert([group]).select().single();
    setSubmitting(false);
    if (error) { toast("Failed to create group: " + error.message, "error"); return; }
    onCreate(data || group);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ fontFamily:"var(--font-display)", fontSize:"2rem", letterSpacing:".02em", marginBottom:"1.4rem" }}>NEW GROUP</div>
        <div style={{ display:"flex", flexDirection:"column", gap:".85rem" }}>
          <div>
            <label>Group Name *</label>
            <input value={f.name} onChange={e=>s("name",e.target.value)} placeholder="e.g. FRC Team 9871" className={errors.name?"error":""} maxLength={80}/>
            {errors.name && <div className="field-error">{errors.name}</div>}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".7rem" }}>
            <div>
              <label>Category *</label>
              <select value={f.category} onChange={e=>s("category",e.target.value)} className={errors.category?"error":""}>
                <option value="">Select…</option>
                {CATS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
              {errors.category && <div className="field-error">{errors.category}</div>}
            </div>
            <div><label>Subcategory</label><input value={f.sub} onChange={e=>s("sub",e.target.value)} placeholder="e.g. Robotics (FRC)" maxLength={60}/></div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:".6rem" }}>
            <input type="checkbox" id="rm" checked={f.remote} onChange={e=>s("remote",e.target.checked)} style={{ width:"auto", accentColor:"var(--orange)" }}/>
            <label htmlFor="rm" style={{ margin:0, textTransform:"none", fontSize:".85rem", letterSpacing:0, color:"var(--ink)" }}>This group meets remotely</label>
          </div>
          {!f.remote && <div><label>Location</label><input value={f.location} onChange={e=>s("location",e.target.value)} placeholder="City, State" maxLength={60}/></div>}
          <div>
            <label>Description *</label>
            <textarea rows={3} value={f.desc} onChange={e=>s("desc",e.target.value)} placeholder="What does your group do?" className={errors.desc?"error":""} maxLength={500}/>
            {errors.desc && <div className="field-error">{errors.desc}</div>}
          </div>
          <div><label>Tags (comma-separated, max 8)</label><input value={f.tags} onChange={e=>s("tags",e.target.value)} placeholder="Java, CAD, Fundraising" maxLength={200}/></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".7rem" }}>
            <div><label>Max Members</label><input type="number" min={2} max={50} value={f.max} onChange={e=>s("max",e.target.value)}/></div>
            <div>
              <label>Group Type</label>
              <select value={f.group_type} onChange={e=>s("group_type",e.target.value)}>
                <option value="open">Open — anyone can join</option>
                <option value="invite_only">Invite Only — apply to join</option>
                <option value="closed">Closed — no new members</option>
              </select>
            </div>
          </div>
          <div style={{ border:"1.5px solid var(--paper3)", borderRadius:4, padding:".85rem", display:"flex", flexDirection:"column", gap:".7rem" }}>
              <div style={{ fontSize:".72rem", fontWeight:700, letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)" }}>Requirements to Join (all optional)</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:".6rem" }}>
                <div><label>Min GPA</label><input type="number" min={0} max={4} step={0.01} value={f.min_gpa} onChange={e=>s("min_gpa",e.target.value)} placeholder="e.g. 3.5"/></div>
                <div><label>Min SAT</label><input type="number" min={400} max={1600} value={f.min_sat} onChange={e=>s("min_sat",e.target.value)} placeholder="e.g. 1400"/></div>
                <div><label>Min ACT</label><input type="number" min={1} max={36} value={f.min_act} onChange={e=>s("min_act",e.target.value)} placeholder="e.g. 30"/></div>
              </div>
              <div>
                <label>Custom Requirement Text</label>
                <textarea rows={2} value={f.req_text} onChange={e=>s("req_text",e.target.value)} placeholder="e.g. Must be available weekends…" maxLength={200} className={errors.req_text?"error":""}/>
                {errors.req_text && <div className="field-error">{errors.req_text}</div>}
              </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:".6rem", marginTop:"1.4rem", justifyContent:"flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-orange" onClick={submit} disabled={submitting}>{submitting ? "Creating…" : "Create Group"}</button>
        </div>
      </div>
    </div>
  );
}

function LobbyPage({ groups, setGroups, initCat }) {
  const { user } = useAuth();
  const toast    = useToast();
  const [q, setQ]               = useState("");
  const [cat, setCat]           = useState(initCat || "all");
  const [fmt, setFmt]           = useState("all");
  const [modal, setModal]       = useState(false);
  const [dist, setDist]         = useState("any");
  const [userCoords, setUserCoords] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [passDistIds, setPassDistIds]   = useState(null);
  const [applyGroup, setApplyGroup]     = useState(null);

  useEffect(() => {
    if (dist === "any") { setPassDistIds(null); return; }
    if (!userCoords) { setPassDistIds(null); return; }
    const miles = dist === "25" ? 25 : dist === "50" ? 50 : 100;
    const passing = new Set();
    groups.forEach(g => {
      if (g.remote || (!g.lat && !g.lng)) { passing.add(g.id); return; }
      if (haversine(userCoords.lat, userCoords.lng, g.lat, g.lng) <= miles) passing.add(g.id);
    });
    setPassDistIds(passing);
  }, [dist, userCoords, groups]);

  function handleDistChange(val) {
    setDist(val);
    if (val !== "any" && !userCoords) {
      if (!navigator.geolocation) { toast("Geolocation not supported by your browser.", "warning"); setDist("any"); return; }
      setGeoLoading(true);
      navigator.geolocation.getCurrentPosition(
        pos => { setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoLoading(false); },
        () => { toast("Location access denied. Distance filter requires location.", "warning"); setGeoLoading(false); setDist("any"); }
      );
    }
  }

  const joining = useRef(new Set());
  const join = useCallback(async (id) => {
    if (joining.current.has(id)) return;
    const g = groups.find(x => x.id === id);
    if (!g || g.members.includes(user.id)) return;
    if (g.members.length >= g.max) { toast("This group is full.", "warning"); return; }
    joining.current.add(id);
    const newMembers = [...g.members, user.id];
    setGroups(gs => gs.map(x => x.id===id ? {...x, members:newMembers} : x));
    try {
      const { error } = await supabase.from("groups").update({ members: newMembers }).eq("id", id);
      if (error) throw error;
      toast(`Joined "${g.name}"!`, "success");
    } catch (err) {
      setGroups(gs => gs.map(x => x.id===id ? {...x, members:x.members.filter(m=>m!==user.id)} : x));
      toast("Failed to join: " + (err?.message || "network error"), "error");
    } finally {
      joining.current.delete(id);
    }
  }, [groups, user.id, setGroups, toast]);

  async function apply(id, appData) {
    const g = groups.find(x => x.id === id);
    const newApps = [...(g?.applications || []), { userId: user.id, name: user.name, ts: Date.now(), status: "pending", ...appData }];
    setGroups(gs => gs.map(x => x.id===id ? {...x, applications:newApps} : x));
    await supabase.from("groups").update({ applications: newApps }).eq("id", id);
    toast("Application submitted!", "success");
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return groups.filter(g => {
      if (cat !== "all" && g.category !== cat) return false;
      if (fmt === "remote" && !g.remote) return false;
      if (fmt === "local"  &&  g.remote) return false;
      if (query && ![g.name, g.desc, ...g.tags].some(x => x.toLowerCase().includes(query))) return false;
      if (passDistIds !== null && !passDistIds.has(g.id)) return false;
      return true;
    });
  }, [groups, cat, fmt, q, passDistIds]);

  const onCardApply = useCallback((grp) => setApplyGroup(grp), []);

  return (
    <div style={{ padding:"2rem 0" }}>
      <div style={{ borderBottom:"2px solid var(--ink)", paddingBottom:"1.5rem", marginBottom:"2rem", display:"flex", justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:"1rem" }}>
        <div>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"clamp(3rem,8vw,5.5rem)", lineHeight:.9, letterSpacing:".02em" }}>ACTIVITY<br/><span style={{ WebkitTextStroke:"2px var(--ink)", color:"transparent" }}>LOBBY</span></div>
          <p style={{ marginTop:".8rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:"1rem" }}>Browse groups, find your crew, or start your own.</p>
        </div>
        <button className="btn btn-orange" onClick={() => setModal(true)} style={{ alignSelf:"flex-end" }}>+ Start a Group</button>
      </div>

      <div style={{ display:"flex", gap:".6rem", flexWrap:"wrap", marginBottom:"1.2rem", alignItems:"center" }}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search groups…" style={{ maxWidth:220 }}/>
        <select value={fmt} onChange={e=>setFmt(e.target.value)} style={{ maxWidth:150 }}>
          <option value="all">All Formats</option>
          <option value="remote">Remote</option>
          <option value="local">In-Person</option>
        </select>
        <select value={dist} onChange={e=>handleDistChange(e.target.value)} style={{ maxWidth:180 }}>
          <option value="any">Any Distance</option>
          <option value="25">Within 25 miles</option>
          <option value="50">Within 50 miles</option>
          <option value="100">Within 100 miles</option>
        </select>
        {userCoords && dist !== "any" && (
          <span style={{ fontSize:".75rem", color:"var(--muted)", fontStyle:"italic", display:"flex", alignItems:"center", gap:".3rem" }}>
            📍 Using your location
          </span>
        )}
        {geoLoading && (
          <span style={{ fontSize:".75rem", color:"var(--muted)", fontStyle:"italic", display:"flex", alignItems:"center", gap:".3rem" }}>
            <Spinner/> Getting location…
          </span>
        )}
      </div>
      <div style={{ display:"flex", gap:".4rem", flexWrap:"wrap", marginBottom:"1.8rem" }}>
        {["all", ...CATS.map(c=>c.id)].map(id => {
          const c = CATS.find(x => x.id === id);
          const active = cat === id;
          return (
            <button key={id} onClick={() => setCat(id)} style={{ fontFamily:"var(--font-body)", fontWeight:700, fontSize:".67rem", letterSpacing:".06em", textTransform:"uppercase", border:"2px solid var(--ink)", background:active?"var(--ink)":"transparent", color:active?"var(--paper)":"var(--ink)", padding:".28rem .8rem", cursor:"pointer", transition:"all .1s", borderRadius:"999px" }}>
              {c ? `${c.icon} ${c.label}` : "All"}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div style={{ border:"2px dashed var(--muted2)", padding:"4rem", textAlign:"center" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"2.5rem", color:"var(--muted2)", marginBottom:".5rem" }}>NOTHING YET</div>
          <div style={{ color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>Try different filters, or be the first to start a group.</div>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(288px,1fr))", gap:"1rem" }}>
          {filtered.map(g => <GroupCard key={g.id} g={g} onJoin={join} onApply={onCardApply} userId={user.id}/>)}
        </div>
      )}
      {modal && <CreateModal onClose={() => setModal(false)} userId={user.id} userName={user.name} onCreate={g => { setGroups(p=>[g,...p]); setModal(false); toast("Group created!", "success"); }}/>}
      {applyGroup && <ApplyModal g={applyGroup} onClose={() => setApplyGroup(null)} onSubmit={(data) => apply(applyGroup.id, data)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════════════════════════════════════════
function AppShell() {
  const { user, authPhase } = useAuth();
  const [page, setPage]         = useState("lobby");
  const [groups, setGroups]         = useState(null);
  const [jumpGroup, setJumpGroup]   = useState(null);
  const [lobbyFilter, setLobbyFilter] = useState("all");
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [messagesUnread, setMessagesUnread] = useState(0);

  // Remove the static SSR'd #boot-shell from app/layout.jsx as soon as auth
  // bootstrap has decided what to render.
  useEffect(() => {
    if (authPhase === "boot") return;
    if (typeof document === "undefined") return;
    const el = document.getElementById("boot-shell");
    if (el) {
      el.remove();
      dbg("ui:boot-shell-removed", authPhase);
      markOnce("ec:first-shell");
    }
  }, [authPhase]);

  // Load groups only after user session is confirmed. The realtime subscription
  // is deferred to idle so it doesn't contend with the initial fetch.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let resolved = false;
    const GROUPS_TIMEOUT_MS = 6000;

    setGroups(null);
    dbg("groups:fetch-start");

    const timeout = setTimeout(() => {
      if (cancelled || resolved) return;
      // eslint-disable-next-line no-console
      console.warn("[ec] groups fetch timed out; continuing with empty lobby.");
      dbg("groups:timeout");
      setGroups([]);
      markOnce("ec:groups-loaded");
    }, GROUPS_TIMEOUT_MS);

    supabase.from("groups").select("*").order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        resolved = true;
        clearTimeout(timeout);
        if (error) {
          // eslint-disable-next-line no-console
          console.warn("[ec] groups fetch failed:", error.message);
          setGroups([]);
          markOnce("ec:groups-loaded");
          return;
        }
        setGroups(data?.length ? data : SEED_GROUPS);
        dbg("groups:loaded", data?.length ?? 0);
        markOnce("ec:groups-loaded");
      })
      .catch(err => {
        if (cancelled) return;
        resolved = true;
        clearTimeout(timeout);
        // eslint-disable-next-line no-console
        console.warn("[ec] groups fetch threw:", err?.message || err);
        setGroups([]);
        markOnce("ec:groups-loaded");
      });

    let ch = null;
    const attachRealtime = () => {
      ch = supabase.channel("groups-rt")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "groups" }, ({ new: g }) =>
          setGroups(prev => prev?.some(x => x.id === g.id) ? prev : [g, ...(prev || [])])
        )
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "groups" }, ({ new: g }) =>
          setGroups(prev => (prev || []).map(x => x.id === g.id ? g : x))
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "groups" }, ({ old: g }) =>
          setGroups(prev => (prev || []).filter(x => x.id !== g.id))
        )
        .subscribe();
    };
    const ric = typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback
      : (cb) => setTimeout(cb, 300);
    const cic = typeof window !== "undefined" && typeof window.cancelIdleCallback === "function"
      ? window.cancelIdleCallback
      : clearTimeout;
    const idleHandle = ric(attachRealtime, { timeout: 2000 });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      cic(idleHandle);
      if (ch) supabase.removeChannel(ch);
    };
  }, [user?.id]);

  // Presence — also deferred to idle.
  useEffect(() => {
    if (!user) return;
    let presenceCh = null;
    const attachPresence = () => {
      presenceCh = supabase.channel("online-users")
        .on("presence", { event: "sync" }, () => {
          const state = presenceCh.presenceState();
          setOnlineUsers(new Set(Object.values(state).flat().map(p => p.user_id)));
        })
        .subscribe(async status => {
          if (status === "SUBSCRIBED") await presenceCh.track({ user_id: user.id });
        });
    };
    const ric = typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback
      : (cb) => setTimeout(cb, 300);
    const cic = typeof window !== "undefined" && typeof window.cancelIdleCallback === "function"
      ? window.cancelIdleCallback
      : clearTimeout;
    const idleHandle = ric(attachPresence, { timeout: 2000 });
    return () => {
      cic(idleHandle);
      if (presenceCh) supabase.removeChannel(presenceCh);
    };
  }, [user?.id]);

  useEffect(() => {
    if (authPhase === "ready" && user && groups) {
      markOnce("ec:app-interactive");
      printBootSummary();
    }
  }, [authPhase, user, groups]);

  if (authPhase === "boot") return null;
  if (authPhase === "no-session") return <AuthScreen/>;
  if (authPhase === "session-loading-profile" || !user) return <BootStateOverlay label="Loading your profile…"/>;
  if (!groups) return <BootStateOverlay label="Loading workspace…"/>;

  function goChat(gid) { setJumpGroup(gid); setPage("messages"); }

  const fullPage = page === "messages";
  const bgTier = BG_TIER_FOR_PAGE[page] || "subtle";

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", position:"relative" }}>
      <SiteBackground tier={bgTier} />
      <header className="page-surface" style={{ borderBottom:"2px solid var(--ink)", background:"var(--paper)", position:"sticky", top:0, zIndex:50, flexShrink:0 }}>
        <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem", height:58, display:"flex", alignItems:"center", gap:"1.4rem" }}>
          <div onClick={() => { setLobbyFilter("all"); setPage("lobby"); }} style={{ cursor:"pointer", flexShrink:0, display:"flex", alignItems:"baseline" }}>
            <span style={{ fontFamily:"var(--font-display)", fontSize:"1.35rem", letterSpacing:".05em" }}>EXTRA</span>
            <span style={{ fontFamily:"var(--font-display)", fontSize:"1.35rem", letterSpacing:".05em", color:"var(--orange)" }}>CREW</span>
          </div>
          <nav style={{ display:"flex", alignItems:"center", flex:1, overflowX:"auto", gap:".1rem" }}>
            {PAGES_CONFIG.map(p => (
              <button key={p.id} className={`nav-link ${page===p.id?"active":""}`} onClick={() => { if (p.id === "lobby") setLobbyFilter("all"); setPage(p.id); }}>
                <span style={{ position:"relative" }}>
                  {p.icon} {p.label}
                  {p.id === "messages" && messagesUnread > 0 && (
                    <span style={{ position:"absolute", top:-7, right:-10, background:"var(--orange)", color:"var(--paper)", borderRadius:"999px", fontSize:".5rem", fontWeight:700, padding:"1px 4px", lineHeight:1.4, pointerEvents:"none" }}>
                      {messagesUnread > 99 ? "99+" : messagesUnread}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </nav>
          <div onClick={() => setPage("profile")} style={{ flexShrink:0, display:"flex", alignItems:"center", gap:".5rem", border:"2px solid var(--ink)", padding:".25rem .65rem", background:"var(--paper2)", fontSize:".72rem", fontWeight:700, letterSpacing:".05em", textTransform:"uppercase", cursor:"pointer" }}>
            <div className="dot-online"/>
            {user.name}
          </div>
        </div>
      </header>

      <main className="page-surface" style={{ flex:1, overflow:fullPage?"hidden":"auto" }}>
        <OnlineCtx.Provider value={onlineUsers}>
          {page==="lobby"    && <div className="page-surface" style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><LobbyPage groups={groups} setGroups={setGroups} initCat={lobbyFilter}/></div>}
          {page==="advisor"  && <div className="page-surface" style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><AdvisorPage goLobby={(cats) => { setLobbyFilter(cats?.[0] || "all"); setPage("lobby"); }} goProfile={()=>setPage("profile")}/></div>}
          {page==="mygroups" && <div className="page-surface" style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><MyGroupsPage groups={groups} setGroups={setGroups} goChat={goChat}/></div>}
          {page==="messages" && <ChatPage groups={groups} setGroups={setGroups} jumpGroup={jumpGroup} onUnreadChange={setMessagesUnread}/>}
          {page==="friends"  && <div className="page-surface" style={{ maxWidth:860,  margin:"0 auto", padding:"0 1.4rem" }}><FriendsPage/></div>}
          {page==="aichat"   && <div className="page-surface" style={{ maxWidth:860,  margin:"0 auto", padding:"0 1.4rem" }}><AIChatPage/></div>}
          {page==="profile"  && <div className="page-surface" style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><ProfilePage/></div>}
        </OnlineCtx.Provider>
      </main>

      {!fullPage && (
        <footer className="page-surface" style={{ borderTop:"2px solid var(--ink)", padding:".7rem 1.4rem", display:"flex", justifyContent:"space-between", alignItems:"center", background:"var(--paper2)" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:".9rem", letterSpacing:".08em" }}>EXTRACREW</div>
          <div style={{ fontSize:".65rem", fontWeight:600, letterSpacing:".07em", textTransform:"uppercase", color:"var(--muted)" }}>Connecting Students · Building Futures</div>
        </footer>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <AuthProvider>
      <ToastProvider>
        <CallProvider>
          <AppShell/>
        </CallProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
