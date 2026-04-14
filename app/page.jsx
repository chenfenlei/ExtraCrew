"use client";

import { useState, useEffect, useRef, createContext, useContext } from "react";
import { sanitize, Validators, passesContentPolicy, ClientRateLimit } from "@/lib/security";
import { callClaude } from "@/lib/api";
import { CATS, CAT_TAG, SEED_GROUPS, MOCK_USERS, AI_TOOLS } from "@/lib/data";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// ─── Distance helpers ─────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function fileIcon(type) {
  if (!type) return "📎";
  if (type.startsWith("video/")) return "🎥";
  if (type.startsWith("audio/")) return "🎵";
  if (type === "application/pdf") return "📄";
  return "📎";
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH CONTEXT
// ═══════════════════════════════════════════════════════════════════════════
const AuthCtx = createContext(null);
const useAuth = () => useContext(AuthCtx);

// ─── Online presence context ──────────────────────────────────────────────
const OnlineCtx = createContext(new Set());
const useOnline = () => useContext(OnlineCtx);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    // Timeout fallback — if loading takes more than 5 seconds, give up and show login
    const timeout = setTimeout(() => {
      setSessionLoading(false);
    }, 5000);

    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      clearTimeout(timeout);
      if (error || !session?.user) {
        // Clear any corrupted auth state
        await supabase.auth.signOut();
        setSessionLoading(false);
        return;
      }
      try {
        const { data: profile } = await supabase
          .from("users")
          .select("*")
          .eq("id", session.user.id)
          .single();
        if (profile) setUser({ ...profile, password: undefined });
      } catch (e) {
        await supabase.auth.signOut();
      }
      setSessionLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_OUT") {
          setUser(null);
          return;
        }
        if (session?.user) {
          const { data: profile } = await supabase
            .from("users")
            .select("*")
            .eq("id", session.user.id)
            .single();
          if (profile) setUser({ ...profile, password: undefined });
        }
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function login(email, password) {
    if (!ClientRateLimit.check("auth")) return { ok: false, error: "Too many attempts. Wait 1 minute." };
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });
    if (error) return { ok: false, error: error.message };
    const { data: profile } = await supabase
      .from("users")
      .select("*")
      .eq("id", data.user.id)
      .single();
    setUser({ ...profile, password: undefined });
    return { ok: true };
  }

  async function register(name, email, password) {
    if (!ClientRateLimit.check("auth")) return { ok: false, error: "Too many attempts. Wait 1 minute." };
    const { data, error } = await supabase.auth.signUp({
      email: email.toLowerCase().trim(),
      password,
    });
    if (error) return { ok: false, error: error.message };
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
    const { error: insertError } = await supabase.from("users").insert([profile]);
    if (insertError) return { ok: false, error: insertError.message };
    setUser(profile);
    return { ok: true };
  }

  function logout() {
    supabase.auth.signOut();
    sessionStorage.clear();
    setUser(null);
  }

  function updateProfile(updates) {
    setUser(u => ({ ...u, ...updates }));
  }

  return (
    <AuthCtx.Provider value={{ user, login, logout, register, sessionLoading, updateProfile }}>
      {children}
    </AuthCtx.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST CONTEXT
// ═══════════════════════════════════════════════════════════════════════════
const ToastCtx = createContext(null);
const useToast = () => useContext(ToastCtx);

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
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════
const AVATAR_COLORS = ["#e8500a","#1a6b3c","#1a3a6b","#8b3a8b","#c07a14","#2a7a7a"];
function avatarColor(n) { let h = 0; for (const c of (n||"?")) h = (h*31+c.charCodeAt(0)) % AVATAR_COLORS.length; return AVATAR_COLORS[h]; }
function initials(n) { return (n||"?") === "You" ? "ME" : n.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase(); }
function ago(ts) { const d = Math.floor((Date.now()-ts)/864e5); return d===0?"today":d===1?"yesterday":`${d}d ago`; }
function ftime(ts) { return new Date(ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); }

const ACTIVITY_TYPES = [
  "Academic","Art","Athletics: Club","Athletics: JV/Varsity","Career-Oriented",
  "Community Service (Volunteer)","Computer/Technology","Cultural","Dance","Debate/Speech",
  "Environmental","Family Responsibilities","Foreign Exchange","Journalism/Publication",
  "Junior R.O.T.C.","LGBT","Music: Instrumental","Music: Vocal","Religious","Research",
  "Robotics","School Spirit","Science/Math","Social Justice","Student Govt./Politics",
  "Theater/Drama","Work (paid)","Other Club/Activity",
];
const GRADE_OPTIONS = ["9","10","11","12","Post-graduate"];

function Spinner({ size = 18 }) {
  return <div className="spinner" style={{ width: size, height: size }} />;
}

function Avatar({ name, size = 34 }) {
  const col = avatarColor(name);
  return (
    <div className="avatar" style={{ width: size, height: size, color: col, background: col + "18", fontSize: size < 28 ? ".58rem" : ".72rem" }}>
      {initials(name)}
    </div>
  );
}

function MemberBar({ count, max }) {
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

// ═══════════════════════════════════════════════════════════════════════════
// AUTH SCREEN
// ═══════════════════════════════════════════════════════════════════════════
function AuthScreen() {
  const [mode, setMode]     = useState("login");
  const [f, setF]           = useState({ name:"", email:"", password:"", confirm:"" });
  const [errors, setErrors] = useState({});
  const [apiErr, setApiErr] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const toast = useToast();
  const s = (k, v) => { setF(p=>({...p,[k]:v})); setErrors(p=>({...p,[k]:""})); setApiErr(""); };

  function validate() {
    const e = {};
    if (mode === "register" && !Validators.minLen(f.name, 2)) e.name = "Name must be at least 2 characters.";
    if (!Validators.email(f.email))                           e.email = "Enter a valid email address.";
    if (!Validators.minLen(f.password, 8))                   e.password = "Password must be at least 8 characters.";
    if (mode === "register" && f.password !== f.confirm)      e.confirm = "Passwords don't match.";
    return e;
  }

  async function submit() {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true); setApiErr("");
    await new Promise(r => setTimeout(r, 300));
    const res = mode === "login"
      ? await login(f.email, f.password)
      : await register(f.name, f.email, f.password);
    setLoading(false);
    if (!res.ok) { setApiErr(res.error); return; }
    toast(mode === "login" ? "Welcome back!" : "Account created!", "success");
  }

  return (
    <div className="auth-screen">
      <div className="auth-box">
        <div style={{ textAlign:"center", marginBottom:"2rem" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"2.5rem", letterSpacing:".04em", lineHeight:1 }}>
            EXTRA<span style={{ color:"var(--orange)" }}>CREW</span>
          </div>
          <div style={{ fontSize:".72rem", fontWeight:600, letterSpacing:".1em", textTransform:"uppercase", color:"var(--muted)", marginTop:".4rem" }}>
            Connecting Students · Building Futures
          </div>
        </div>

        <div style={{ display:"flex", border:"2px solid var(--ink)", borderRadius:"12px", overflow:"hidden", marginBottom:"1.6rem" }}>
          {["login","register"].map(m => (
            <button key={m} onClick={() => { setMode(m); setErrors({}); setApiErr(""); }}
              style={{ flex:1, padding:".5rem", fontFamily:"var(--font-body)", fontWeight:700, fontSize:".7rem", letterSpacing:".07em", textTransform:"uppercase", border:"none", cursor:"pointer", background:mode===m?"var(--ink)":"transparent", color:mode===m?"var(--paper)":"var(--muted)", transition:"all .12s" }}>
              {m === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:".85rem" }}>
          {mode === "register" && (
            <div>
              <label>Full Name</label>
              <input value={f.name} onChange={e=>s("name",e.target.value)} placeholder="Alex Johnson" className={errors.name?"error":""} maxLength={60}/>
              {errors.name && <div className="field-error">{errors.name}</div>}
            </div>
          )}
          <div>
            <label>Email</label>
            <input type="email" value={f.email} onChange={e=>s("email",e.target.value)} placeholder="you@school.edu" className={errors.email?"error":""}/>
            {errors.email && <div className="field-error">{errors.email}</div>}
          </div>
          <div>
            <label>Password</label>
            <input type="password" value={f.password} onChange={e=>s("password",e.target.value)} placeholder={mode==="register"?"Min. 8 characters":"••••••••"} className={errors.password?"error":""}
              onKeyDown={e=>e.key==="Enter"&&mode==="login"&&submit()} maxLength={128}/>
            {errors.password && <div className="field-error">{errors.password}</div>}
          </div>
          {mode === "register" && (
            <div>
              <label>Confirm Password</label>
              <input type="password" value={f.confirm} onChange={e=>s("confirm",e.target.value)} placeholder="Repeat password" className={errors.confirm?"error":""}
                onKeyDown={e=>e.key==="Enter"&&submit()}/>
              {errors.confirm && <div className="field-error">{errors.confirm}</div>}
            </div>
          )}
          {apiErr && (
            <div style={{ background:"var(--red-lt)", border:"2px solid var(--red)", padding:".6rem .8rem", fontSize:".78rem", color:"var(--red)", fontWeight:600 }}>
              ✗ {apiErr}
            </div>
          )}
          <button className="btn btn-orange" onClick={submit} disabled={loading} style={{ justifyContent:"center", marginTop:".3rem" }}>
            {loading ? <><Spinner size={14}/>Processing…</> : mode==="login" ? "Sign In →" : "Create Account →"}
          </button>
        </div>

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
// USER PROFILE MODAL (clickable public view — used everywhere)
// ═══════════════════════════════════════════════════════════════════════════
function UserProfileModal({ userId, u: initialU, onClose }) {
  const [u, setU] = useState(initialU || null);
  const [loading, setLoading] = useState(!initialU);

  useEffect(() => {
    if (initialU) return;
    supabase.from("users").select("*").eq("id", userId).single().then(({ data }) => {
      setU(data || null);
      setLoading(false);
    });
  }, [userId]);

  if (loading) return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth:460, textAlign:"center", padding:"3rem" }}><Spinner size={28}/></div>
    </div>
  );
  if (!u) return null;

  const showStats = u.stats_public !== false; // hidden only if explicitly false
  const sl = u.social_links || {};

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:500, maxHeight:"85vh", overflowY:"auto" }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.2rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
            <div style={{ width:56, height:56, borderRadius:"50%", border:"2.5px solid var(--orange)", flexShrink:0, overflow:"hidden", background:"var(--orange-lt)", display:"flex", alignItems:"center", justifyContent:"center" }}>
              {u.avatar_url
                ? <img src={u.avatar_url} alt="avatar" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                : <div style={{ fontFamily:"var(--font-display)", fontSize:"1.2rem", color:"var(--orange)" }}>{initials(u.name)}</div>}
            </div>
            <div>
              <div style={{ fontFamily:"var(--font-display)", fontSize:"1.1rem", letterSpacing:".03em" }}>{u.name}</div>
              {u.bio && <p style={{ fontSize:".78rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", lineHeight:1.5, marginTop:".2rem", maxWidth:280 }}>{u.bio}</p>}
              <div style={{ display:"flex", gap:".3rem", marginTop:".35rem", flexWrap:"wrap" }}>
                {sl.linkedin  && <a href={sl.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize:".7rem", fontWeight:700, border:"1.5px solid var(--ink)", padding:".1rem .3rem", textDecoration:"none", color:"var(--ink)" }}>in</a>}
                {sl.instagram && <a href={`https://instagram.com/${sl.instagram}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:".7rem", fontWeight:700, border:"1.5px solid var(--ink)", padding:".1rem .3rem", textDecoration:"none", color:"var(--ink)" }}>@</a>}
                {sl.email     && <a href={`mailto:${sl.email}`} style={{ fontSize:".7rem", fontWeight:700, border:"1.5px solid var(--ink)", padding:".1rem .3rem", textDecoration:"none", color:"var(--ink)" }}>✉</a>}
                {sl.whatsapp  && <a href={`https://wa.me/${sl.whatsapp}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:".7rem", fontWeight:700, border:"1.5px solid var(--ink)", padding:".1rem .3rem", textDecoration:"none", color:"var(--ink)" }}>WA</a>}
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Academic stats */}
        {showStats && (u.gpa || u.sat || u.act || u.intended_major) && (
          <div style={{ background:"var(--paper2)", border:"1.5px solid var(--paper3)", padding:".75rem .9rem", marginBottom:"1rem" }}>
            <div style={{ fontSize:".6rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".5rem" }}>Academic Profile</div>
            <div style={{ display:"flex", gap:"1.2rem", flexWrap:"wrap", fontSize:".82rem" }}>
              {u.gpa            && <div><span style={{ color:"var(--muted)", fontWeight:600 }}>GPA </span>{u.gpa}</div>}
              {u.sat            && <div><span style={{ color:"var(--muted)", fontWeight:600 }}>SAT </span>{u.sat}</div>}
              {u.act            && <div><span style={{ color:"var(--muted)", fontWeight:600 }}>ACT </span>{u.act}</div>}
              {u.intended_major && <div><span style={{ color:"var(--muted)", fontWeight:600 }}>Major </span>{u.intended_major}</div>}
            </div>
          </div>
        )}

        {/* Activities */}
        {u.activities?.length > 0 && (
          <>
            <div style={{ fontFamily:"var(--font-display)", fontSize:".85rem", letterSpacing:".04em", marginBottom:".55rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".4rem" }}>ACTIVITIES</div>
            <div style={{ display:"flex", flexDirection:"column", gap:".4rem", marginBottom:"1rem", maxHeight:200, overflowY:"auto" }}>
              {u.activities.map((a, i) => (
                <div key={i} style={{ padding:".5rem .7rem", background:"var(--paper2)", border:"1px solid var(--paper3)", fontSize:".8rem" }}>
                  <div style={{ fontWeight:700 }}>{a.position}{a.org_name ? ` — ${a.org_name}` : ""}</div>
                  {a.description && <div style={{ color:"var(--muted)", fontSize:".75rem", fontStyle:"italic", marginTop:".1rem" }}>{a.description}</div>}
                  <div style={{ color:"var(--muted2)", fontSize:".68rem", marginTop:".2rem" }}>{a.activity_type}{a.grades?.length ? ` · Gr. ${a.grades.join(", ")}` : ""}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Awards */}
        {u.awards?.length > 0 && (
          <>
            <div style={{ fontFamily:"var(--font-display)", fontSize:".85rem", letterSpacing:".04em", marginBottom:".55rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".4rem" }}>HONORS & AWARDS</div>
            <div style={{ display:"flex", flexDirection:"column", gap:".4rem", marginBottom:"1rem" }}>
              {u.awards.map((a, i) => (
                <div key={i} style={{ padding:".5rem .7rem", background:"var(--paper2)", border:"1px solid var(--paper3)", fontSize:".8rem" }}>
                  <div style={{ fontWeight:700 }}>{a.title}</div>
                  <div style={{ color:"var(--muted)", fontSize:".75rem", marginTop:".1rem" }}>
                    {Array.isArray(a.recognition) ? a.recognition.join(", ") : a.recognition}
                    {a.grades?.length ? ` · Gr. ${a.grades.join(", ")}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!u.activities?.length && !u.awards?.length && !showStats && (
          <p style={{ color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:".85rem" }}>No public profile info yet.</p>
        )}

        <div style={{ display:"flex", justifyContent:"flex-end", marginTop:".5rem" }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOBBY
// ═══════════════════════════════════════════════════════════════════════════

// ─── Call modal (Whereby embedded room) ──────────────────────────────────
function CallModal({ title, roomId, type, onClose }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:"min(900px,95vw)", padding:0, overflow:"hidden" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:".75rem 1rem", borderBottom:"2px solid var(--ink)", background:"var(--paper2)" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"1rem", letterSpacing:".04em" }}>{type === "video" ? "📹" : "📞"} {title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕ End</button>
        </div>
        <iframe
          src={`https://whereby.com/extracrew-${roomId}`}
          allow="camera; microphone; fullscreen; speaker; display-capture"
          style={{ width:"100%", height:"65vh", border:"none", display:"block" }}
          title={`${type} call`}
        />
      </div>
    </div>
  );
}

// ─── Nickname editor (tiny sub-component for GroupInfoPanel) ─────────────
function NicknameEditor({ current, onSave, onCancel }) {
  const [v, setV] = useState(current);
  return (
    <div style={{ display:"flex", gap:".4rem" }}>
      <input value={v} onChange={e=>setV(e.target.value)} maxLength={40} style={{ fontSize:".8rem", flex:1 }} autoFocus/>
      <button className="btn btn-sm btn-orange" onClick={() => onSave(v)}>Save</button>
      <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
    </div>
  );
}

// ─── Group info panel (⋯ menu in chat header) ────────────────────────────
function GroupInfoPanel({ group, groups, setGroups, msgs, userId, onClose }) {
  const toast   = useToast();
  const isLeader = group.byId === userId;
  const fileRef  = useRef(null);
  const currentGroup = groups.find(g => g.id === group.id) || group;

  const [nickname,     setNickname]     = useState(() => { try { return localStorage.getItem(`ec:nick_${group.id}_${userId}`) || ""; } catch { return ""; } });
  const [nickEdit,     setNickEdit]     = useState(false);
  const [muted,        setMuted]        = useState(() => { try { return localStorage.getItem(`ec:mute_${group.id}_${userId}`) === "1"; } catch { return false; } });
  const [notice,       setNotice]       = useState(currentGroup.notice || "");
  const [editNotice,   setEditNotice]   = useState(false);
  const [searchQ,      setSearchQ]      = useState("");
  const [uploading,    setUploading]    = useState(false);
  const [editSettings, setEditSettings] = useState(false);
  const [newType,      setNewType]      = useState(currentGroup.group_type  || "open");
  const [newMinGpa,    setNewMinGpa]    = useState(currentGroup.requirements?.min_gpa  || "");
  const [newMinSat,    setNewMinSat]    = useState(currentGroup.requirements?.min_sat  || "");
  const [newMinAct,    setNewMinAct]    = useState(currentGroup.requirements?.min_act  || "");
  const [newReqText,   setNewReqText]   = useState(currentGroup.requirements?.req_text || "");

  const threadMsgs   = msgs?.[group.id] || [];
  const filteredMsgs = searchQ ? threadMsgs.filter(m => (m.text||"").toLowerCase().includes(searchQ.toLowerCase())) : [];

  function saveMuted(val) {
    setMuted(val);
    try { localStorage.setItem(`ec:mute_${group.id}_${userId}`, val ? "1" : "0"); } catch {}
  }
  function saveNickname(val) {
    const clean = sanitize(val, 40);
    setNickname(clean); setNickEdit(false);
    try { localStorage.setItem(`ec:nick_${group.id}_${userId}`, clean); } catch {}
    toast("Nickname updated!", "success");
  }
  async function saveNotice() {
    const clean = sanitize(notice, 300);
    setGroups(gs => gs.map(g => g.id === group.id ? { ...g, notice: clean } : g));
    setEditNotice(false);
    await supabase.from("groups").update({ notice: clean }).eq("id", group.id);
    toast("Notice updated!", "success");
  }
  async function saveSettings() {
    if (newReqText && !Validators.noScript(newReqText)) { toast("Invalid characters.", "error"); return; }
    const reqs = {
      ...(newMinGpa  ? { min_gpa:  parseFloat(newMinGpa)  } : {}),
      ...(newMinSat  ? { min_sat:  parseInt(newMinSat)    } : {}),
      ...(newMinAct  ? { min_act:  parseInt(newMinAct)    } : {}),
      ...(newReqText ? { req_text: sanitize(newReqText, 200) } : {}),
    };
    setGroups(gs => gs.map(g => g.id === group.id ? { ...g, group_type: newType, requirements: reqs } : g));
    setEditSettings(false);
    await supabase.from("groups").update({ group_type: newType, requirements: reqs }).eq("id", group.id);
    toast("Group settings updated!", "success");
  }
  async function uploadAvatar(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast("Image must be under 5MB.", "warning"); return; }
    setUploading(true);
    const ext  = file.name.split(".").pop();
    const path = `${group.id}.${ext}`;
    const { error: upErr } = await supabase.storage.from("group-avatars").upload(path, file, { upsert: true });
    if (upErr) { toast("Upload failed.", "error"); setUploading(false); return; }
    const { data } = supabase.storage.from("group-avatars").getPublicUrl(path);
    setGroups(gs => gs.map(g => g.id === group.id ? { ...g, avatar_url: data.publicUrl } : g));
    toast("Group photo updated!", "success");
    setUploading(false);
  }
  async function leaveGroup() {
    const newMembers = currentGroup.members.filter(m => m !== userId);
    setGroups(gs => gs.map(g => g.id === group.id ? { ...g, members: newMembers } : g));
    await supabase.from("groups").update({ members: newMembers }).eq("id", group.id);
    toast("Left the group.", "success");
    onClose();
  }

  const reqs = currentGroup.requirements || {};

  return (
    <div style={{ position:"absolute", top:0, right:0, height:"100%", width:300, background:"var(--paper)", borderLeft:"2px solid var(--ink)", display:"flex", flexDirection:"column", zIndex:30, overflowY:"auto" }}>
      <div style={{ padding:".8rem 1rem", borderBottom:"2px solid var(--ink)", display:"flex", justifyContent:"space-between", alignItems:"center", background:"var(--paper2)", flexShrink:0 }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:".95rem", letterSpacing:".04em" }}>GROUP INFO</div>
        <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:".85rem", fontWeight:700, padding:".2rem .4rem" }}>✕</button>
      </div>

      <div style={{ padding:"1rem", display:"flex", flexDirection:"column", gap:"1.1rem" }}>
        {/* Group avatar */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:".5rem" }}>
          <div
            style={{ width:70, height:70, borderRadius:"50%", border:"3px solid var(--ink)", overflow:"hidden", background:"var(--paper2)", display:"flex", alignItems:"center", justifyContent:"center", cursor:isLeader?"pointer":"default" }}
            onClick={() => isLeader && fileRef.current?.click()}
          >
            {currentGroup.avatar_url
              ? <img src={currentGroup.avatar_url} alt="group" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
              : <div style={{ fontFamily:"var(--font-display)", fontSize:"1.5rem", color:"var(--muted2)" }}>{currentGroup.name?.[0]?.toUpperCase()}</div>}
          </div>
          {isLeader && (
            <>
              <button className="btn btn-ghost btn-sm" style={{ fontSize:".62rem" }} onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Spinner size={12}/> : "📷 Change Photo"}
              </button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }}/>
            </>
          )}
          <div style={{ fontWeight:700, fontSize:".92rem", textAlign:"center" }}>{currentGroup.name}</div>
          <div style={{ fontSize:".7rem", color:"var(--muted)", textAlign:"center" }}>{currentGroup.members.length}/{currentGroup.max} members · {currentGroup.sub}</div>
        </div>

        {/* QR code */}
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".4rem" }}>Share Link</div>
          <img src="https://api.qrserver.com/v1/create-qr-code/?data=extracrew.vercel.app&size=150x150" alt="QR" style={{ border:"2px solid var(--ink)", padding:4, background:"#fff" }}/>
        </div>

        {/* Notice */}
        <div>
          <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".35rem" }}>📌 Notice</div>
          {editNotice ? (
            <div>
              <textarea rows={3} value={notice} onChange={e=>setNotice(e.target.value)} maxLength={300} style={{ width:"100%", fontSize:".8rem" }}/>
              <div style={{ display:"flex", gap:".4rem", marginTop:".35rem" }}>
                <button className="btn btn-sm btn-orange" onClick={saveNotice}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditNotice(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize:".8rem", color:currentGroup.notice?"var(--ink)":"var(--muted)", fontStyle:currentGroup.notice?"normal":"italic", fontFamily:currentGroup.notice?"var(--font-body)":"var(--font-serif)", lineHeight:1.5 }}>
                {currentGroup.notice || "No notice set."}
              </div>
              {isLeader && <button onClick={() => { setNotice(currentGroup.notice||""); setEditNotice(true); }} style={{ background:"none", border:"none", cursor:"pointer", fontSize:".62rem", color:"var(--blue)", padding:0, fontFamily:"var(--font-body)", marginTop:".25rem" }}>Edit notice</button>}
            </div>
          )}
        </div>

        {/* Requirements */}
        {(reqs.min_gpa || reqs.min_sat || reqs.min_act || reqs.req_text) && (
          <div style={{ background:"var(--paper2)", border:"1.5px solid var(--paper3)", padding:".65rem .75rem" }}>
            <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".4rem" }}>Requirements to Join</div>
            <div style={{ fontSize:".78rem", display:"flex", flexDirection:"column", gap:".2rem" }}>
              {reqs.min_gpa  && <div>Min GPA: <strong>{reqs.min_gpa}</strong></div>}
              {reqs.min_sat  && <div>Min SAT: <strong>{reqs.min_sat}</strong></div>}
              {reqs.min_act  && <div>Min ACT: <strong>{reqs.min_act}</strong></div>}
              {reqs.req_text && <div style={{ fontStyle:"italic", fontFamily:"var(--font-serif)", marginTop:".2rem" }}>{reqs.req_text}</div>}
            </div>
          </div>
        )}

        {/* Members */}
        <div>
          <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".35rem" }}>Members ({currentGroup.members.length})</div>
          <div style={{ display:"flex", flexDirection:"column", gap:".25rem", maxHeight:160, overflowY:"auto" }}>
            {currentGroup.members.map((mid, idx) => (
              <div key={mid} style={{ display:"flex", alignItems:"center", gap:".45rem", padding:".3rem .4rem", background:"var(--paper2)", fontSize:".78rem" }}>
                <div style={{ width:22, height:22, borderRadius:"50%", background:"var(--paper3)", border:"1px solid var(--paper3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:".55rem", fontWeight:700, flexShrink:0 }}>{idx+1}</div>
                <span style={{ flex:1 }}>{mid === userId ? `You` : mid === currentGroup.byId ? currentGroup.byName : "Member"}</span>
                {mid === currentGroup.byId && <span style={{ fontSize:".52rem", fontWeight:700, color:"var(--orange)", letterSpacing:".04em" }}>LEADER</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Mute */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:".8rem", fontWeight:600 }}>🔔 Mute notifications</span>
          <button onClick={() => saveMuted(!muted)} style={{ background:muted?"var(--ink)":"transparent", color:muted?"var(--paper)":"var(--ink)", border:"2px solid var(--ink)", padding:".22rem .6rem", fontSize:".7rem", fontWeight:700, cursor:"pointer", fontFamily:"var(--font-body)", letterSpacing:".05em" }}>
            {muted ? "Muted" : "Mute"}
          </button>
        </div>

        {/* Nickname */}
        <div>
          <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".3rem" }}>My Nickname</div>
          {nickEdit
            ? <NicknameEditor current={nickname} onSave={saveNickname} onCancel={() => setNickEdit(false)}/>
            : <div style={{ display:"flex", alignItems:"center", gap:".5rem" }}>
                <span style={{ fontSize:".82rem" }}>{nickname || "(none)"}</span>
                <button onClick={() => setNickEdit(true)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:".62rem", color:"var(--blue)", padding:0, fontFamily:"var(--font-body)" }}>Edit</button>
              </div>}
        </div>

        {/* Search messages */}
        <div>
          <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".3rem" }}>🔍 Search Messages</div>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search chat history…" style={{ fontSize:".8rem" }}/>
          {searchQ && (
            <div style={{ marginTop:".4rem", maxHeight:110, overflowY:"auto", display:"flex", flexDirection:"column", gap:".2rem" }}>
              {filteredMsgs.length === 0
                ? <div style={{ fontSize:".72rem", color:"var(--muted)", fontStyle:"italic" }}>No messages found.</div>
                : filteredMsgs.map(m => (
                    <div key={m.id} style={{ fontSize:".72rem", background:"var(--paper2)", padding:".28rem .45rem", border:"1px solid var(--paper3)" }}>
                      <span style={{ fontWeight:700, color:avatarColor(m.senderName) }}>{m.senderName}: </span>
                      {(m.text||"").slice(0,60)}{(m.text||"").length>60?"…":""}
                    </div>
                  ))}
            </div>
          )}
        </div>

        {/* Leader settings */}
        {isLeader && (
          <div style={{ border:"1.5px solid var(--paper3)", padding:".75rem", background:"var(--paper2)" }}>
            <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--orange)", marginBottom:".6rem" }}>Leader Settings</div>
            {editSettings ? (
              <div style={{ display:"flex", flexDirection:"column", gap:".55rem" }}>
                <div>
                  <label style={{ fontSize:".62rem" }}>Group Type</label>
                  <select value={newType} onChange={e=>setNewType(e.target.value)} style={{ fontSize:".8rem" }}>
                    <option value="open">Open — anyone can join</option>
                    <option value="invite_only">Invite Only — apply to join</option>
                    <option value="closed">Closed — no new members</option>
                  </select>
                </div>
                <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)" }}>Requirements (optional)</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:".35rem" }}>
                  <div><label style={{ fontSize:".58rem" }}>Min GPA</label><input type="number" value={newMinGpa} onChange={e=>setNewMinGpa(e.target.value)} style={{ fontSize:".75rem" }}/></div>
                  <div><label style={{ fontSize:".58rem" }}>Min SAT</label><input type="number" value={newMinSat} onChange={e=>setNewMinSat(e.target.value)} style={{ fontSize:".75rem" }}/></div>
                  <div><label style={{ fontSize:".58rem" }}>Min ACT</label><input type="number" value={newMinAct} onChange={e=>setNewMinAct(e.target.value)} style={{ fontSize:".75rem" }}/></div>
                </div>
                <div>
                  <label style={{ fontSize:".58rem" }}>Custom Text</label>
                  <textarea rows={2} value={newReqText} onChange={e=>setNewReqText(e.target.value)} maxLength={200} style={{ fontSize:".76rem" }}/>
                </div>
                <div style={{ display:"flex", gap:".4rem" }}>
                  <button className="btn btn-sm btn-orange" onClick={saveSettings}>Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditSettings(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize:".78rem", marginBottom:".45rem" }}>Type: <strong>{currentGroup.group_type || "open"}</strong></div>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditSettings(true)} style={{ fontSize:".62rem" }}>Edit Type & Requirements</button>
              </div>
            )}
          </div>
        )}

        {/* Leave */}
        {currentGroup.byId !== userId && (
          <button className="btn btn-sm btn-danger" onClick={leaveGroup} style={{ width:"100%" }}>Leave Group</button>
        )}
      </div>
    </div>
  );
}

// ─── Friends page ─────────────────────────────────────────────────────────
function FriendsPage() {
  const { user } = useAuth();
  const toast    = useToast();
  const [searchEmail, setSearchEmail] = useState("");
  const [searching,   setSearching]   = useState(false);
  const [found,       setFound]       = useState(null);
  const [viewProfile, setViewProfile] = useState(null);

  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || "null") || fallback; } catch { return fallback; } };
  const save = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

  const [friends,  setFriends]  = useState(() => load(`ec:friends_${user?.id}`,  []));
  const [requests, setRequests] = useState(() => load(`ec:freqs_${user?.id}`,    []));
  const [sent,     setSent]     = useState(() => load(`ec:fsent_${user?.id}`,    []));

  function saveFriends(v)  { setFriends(v);  save(`ec:friends_${user.id}`, v); }
  function saveRequests(v) { setRequests(v); save(`ec:freqs_${user.id}`,   v); }
  function saveSent(v)     { setSent(v);     save(`ec:fsent_${user.id}`,   v); }

  // Pull any incoming requests stored via Supabase
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("users").select("friend_requests, friends").eq("id", user.id).single().then(({ data }) => {
      if (!data) return;
      if (data.friend_requests?.length) {
        const existing = requests.map(r => r.fromId);
        const newReqs  = (data.friend_requests || []).filter(r => !existing.includes(r.fromId));
        if (newReqs.length) saveRequests([...requests, ...newReqs]);
      }
      if (data.friends?.length) {
        const existingIds = friends.map(f => f.id);
        const newF = (data.friends || []).filter(f => !existingIds.includes(f.id));
        if (newF.length) saveFriends([...friends, ...newF]);
      }
    });
  }, [user?.id]); // eslint-disable-line

  async function searchUser() {
    const email = searchEmail.trim().toLowerCase();
    if (!Validators.email(email)) { toast("Enter a valid email.", "warning"); return; }
    if (email === user.email.toLowerCase()) { toast("That's you!", "warning"); return; }
    setSearching(true);
    const { data } = await supabase.from("users").select("id, name, email, avatar, avatar_url").eq("email", email).single();
    setSearching(false);
    if (!data) { toast("No user found with that email.", "warning"); setFound(null); return; }
    setFound(data);
  }

  async function sendRequest() {
    if (!found) return;
    if (friends.some(f => f.id === found.id)) { toast("Already friends!", "info"); return; }
    if (sent.some(s => s.toId === found.id)) { toast("Request already sent.", "info"); return; }
    try {
      const { data: td } = await supabase.from("users").select("friend_requests").eq("id", found.id).single();
      const prev = td?.friend_requests || [];
      await supabase.from("users").update({ friend_requests: [...prev, { fromId: user.id, fromName: user.name, fromEmail: user.email, ts: Date.now() }] }).eq("id", found.id);
    } catch {}
    saveSent([...sent, { toId: found.id, toName: found.name, toEmail: found.email, ts: Date.now() }]);
    toast(`Friend request sent to ${found.name}!`, "success");
    setFound(null); setSearchEmail("");
  }

  function acceptRequest(req) {
    const nf = { id: req.fromId, name: req.fromName, email: req.fromEmail, ts: Date.now() };
    saveFriends([...friends, nf]);
    saveRequests(requests.filter(r => r.fromId !== req.fromId));
    try { supabase.from("users").update({ friends: [...friends, nf] }).eq("id", user.id); } catch {}
    toast(`${req.fromName} is now your friend!`, "success");
  }
  function declineRequest(req) {
    saveRequests(requests.filter(r => r.fromId !== req.fromId));
    toast("Request declined.", "success");
  }
  function removeFriend(fid) {
    saveFriends(friends.filter(f => f.id !== fid));
    toast("Friend removed.", "success");
  }

  return (
    <div style={{ padding:"2rem 0", maxWidth:680, margin:"0 auto" }}>
      <div style={{ borderBottom:"2px solid var(--ink)", paddingBottom:"1.5rem", marginBottom:"2rem" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"clamp(3rem,8vw,5.5rem)", lineHeight:.9, letterSpacing:".02em" }}>FRIENDS</div>
        <p style={{ marginTop:".8rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:"1rem" }}>Connect with other students by their email address.</p>
      </div>

      {/* Search */}
      <div className="card" style={{ marginBottom:"1.2rem" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"1.1rem", letterSpacing:".04em", marginBottom:".85rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>ADD FRIEND</div>
        <div style={{ display:"flex", gap:".6rem" }}>
          <input value={searchEmail} onChange={e=>setSearchEmail(e.target.value)} placeholder="friend@school.edu" type="email" style={{ flex:1 }} onKeyDown={e=>e.key==="Enter"&&searchUser()} maxLength={120}/>
          <button className="btn btn-orange" onClick={searchUser} disabled={searching}>{searching ? <Spinner size={14}/> : "Find →"}</button>
        </div>
        {found && (
          <div style={{ marginTop:".8rem", display:"flex", justifyContent:"space-between", alignItems:"center", padding:".75rem .9rem", background:"var(--paper2)", border:"1.5px solid var(--paper3)" }}>
            <button onClick={() => setViewProfile(found)} style={{ display:"flex", alignItems:"center", gap:".6rem", background:"none", border:"none", cursor:"pointer", padding:0, textAlign:"left" }}>
              <div style={{ width:36, height:36, borderRadius:"50%", overflow:"hidden", background:"var(--orange-lt)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {found.avatar_url ? <img src={found.avatar_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : <span style={{ fontFamily:"var(--font-display)", fontSize:".9rem", color:"var(--orange)" }}>{initials(found.name)}</span>}
              </div>
              <div>
                <div style={{ fontWeight:700, fontSize:".9rem" }}>{found.name}</div>
                <div style={{ fontSize:".72rem", color:"var(--muted)" }}>{found.email}</div>
              </div>
            </button>
            <button className="btn btn-sm btn-orange" onClick={sendRequest}>Send Request →</button>
          </div>
        )}
      </div>

      {/* Incoming requests */}
      {requests.length > 0 && (
        <div className="card" style={{ marginBottom:"1.2rem" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"1.1rem", letterSpacing:".04em", marginBottom:".85rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>
            REQUESTS
            <span style={{ background:"var(--red)", color:"#fff", borderRadius:"999px", fontSize:".62rem", padding:".1rem .42rem", marginLeft:".5rem", verticalAlign:"middle", fontFamily:"var(--font-body)", fontWeight:700 }}>{requests.length}</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:".6rem" }}>
            {requests.map((r, i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:".65rem .8rem", background:"var(--paper2)", border:"1.5px solid var(--paper3)" }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:".88rem" }}>{r.fromName}</div>
                  <div style={{ fontSize:".72rem", color:"var(--muted)" }}>{r.fromEmail}</div>
                </div>
                <div style={{ display:"flex", gap:".4rem" }}>
                  <button className="btn btn-sm btn-orange" onClick={() => acceptRequest(r)}>Accept</button>
                  <button className="btn btn-sm btn-danger" onClick={() => declineRequest(r)}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Friends list */}
      <div className="card">
        <div style={{ fontFamily:"var(--font-display)", fontSize:"1.1rem", letterSpacing:".04em", marginBottom:".85rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>MY FRIENDS ({friends.length})</div>
        {friends.length === 0
          ? <p style={{ color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:".85rem" }}>No friends yet. Search by email above to connect.</p>
          : (
            <div style={{ display:"flex", flexDirection:"column", gap:".5rem" }}>
              {friends.map((f, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:".65rem .8rem", background:"var(--paper2)", border:"1.5px solid var(--paper3)" }}>
                  <button onClick={() => setViewProfile(f)} style={{ display:"flex", alignItems:"center", gap:".6rem", background:"none", border:"none", cursor:"pointer", padding:0, textAlign:"left" }}>
                    <Avatar name={f.name} size={32}/>
                    <div>
                      <div style={{ fontWeight:700, fontSize:".88rem" }}>{f.name}</div>
                      <div style={{ fontSize:".72rem", color:"var(--muted)" }}>{f.email}</div>
                    </div>
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => removeFriend(f.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}
      </div>

      {viewProfile && <UserProfileModal u={viewProfile} onClose={() => setViewProfile(null)}/>}
    </div>
  );
}

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

function ApplicationsModal({ g, onClose, onApprove, onDecline }) {
  const apps = (g.applications || []).filter(a => a.status === "pending");
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:540 }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"1.6rem", letterSpacing:".02em", marginBottom:".4rem" }}>APPLICATIONS</div>
        <div style={{ fontWeight:700, fontSize:".85rem", marginBottom:"1.2rem", color:"var(--muted)" }}>{g.name} · {apps.length} pending</div>
        {apps.length === 0 ? (
          <p style={{ color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>No pending applications.</p>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:".8rem" }}>
            {apps.map((a, i) => (
              <div key={i} style={{ border:"1.5px solid var(--paper3)", padding:"1rem", background:"var(--paper2)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:".45rem" }}>
                  <div style={{ fontWeight:700, fontSize:".9rem" }}>{a.name}</div>
                  <div style={{ fontSize:".65rem", color:"var(--muted)", fontWeight:600, letterSpacing:".04em" }}>{ago(a.ts)}</div>
                </div>
                <div style={{ display:"flex", gap:"1rem", fontSize:".78rem", marginBottom:".45rem", flexWrap:"wrap" }}>
                  {a.gpa && <div><span style={{ fontWeight:600, color:"var(--muted)" }}>GPA:</span> {a.gpa}</div>}
                  {a.sat && <div><span style={{ fontWeight:600, color:"var(--muted)" }}>SAT:</span> {a.sat}</div>}
                  {a.act && <div><span style={{ fontWeight:600, color:"var(--muted)" }}>ACT:</span> {a.act}</div>}
                </div>
                {a.message && <p style={{ fontSize:".8rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", margin:"0 0 .75rem" }}>{a.message}</p>}
                <div style={{ display:"flex", gap:".5rem" }}>
                  <button className="btn btn-sm btn-orange" onClick={() => onApprove(a.userId)}>Approve</button>
                  <button className="btn btn-sm" style={{ background:"var(--red)", color:"var(--paper)", borderColor:"var(--red)" }} onClick={() => onDecline(a.userId)}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop:"1.2rem", display:"flex", justifyContent:"flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const CAT_BG      = { blue:"var(--blue-lt)",   red:"var(--red-lt)",   green:"var(--green-lt)",   orange:"var(--orange-lt)"   };
const CAT_ACCENT  = { blue:"var(--blue)",      red:"var(--red)",      green:"var(--green)",      orange:"var(--orange)"      };
const CAT_SHADOW  = { blue:"#1a3a6b55",        red:"#c0392b55",       green:"#1a6b3c55",         orange:"#e8500a55"          };

function GroupCard({ g, onJoin, onApply, userId }) {
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
}

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
  const [passDistIds, setPassDistIds]   = useState(null); // null = not yet computed
  const [applyGroup, setApplyGroup]     = useState(null);

  // Compute passing group IDs when dist / userCoords / groups change
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

  async function join(id) {
    const g = groups.find(x => x.id === id);
    if (!g || g.members.includes(user.id)) return;
    if (g.members.length >= g.max) { toast("This group is full.", "warning"); return; }
    const newMembers = [...g.members, user.id];
    setGroups(gs => gs.map(x => x.id===id ? {...x, members:newMembers} : x));
    const { error } = await supabase.from("groups").update({ members: newMembers }).eq("id", id);
    if (error) {
      setGroups(gs => gs.map(x => x.id===id ? {...x, members:x.members.filter(m=>m!==user.id)} : x));
      toast("Failed to join: " + error.message, "error");
    } else {
      toast(`Joined "${g.name}"!`, "success");
    }
  }

  async function apply(id, appData) {
    const g = groups.find(x => x.id === id);
    const newApps = [...(g?.applications || []), { userId: user.id, name: user.name, ts: Date.now(), status: "pending", ...appData }];
    setGroups(gs => gs.map(x => x.id===id ? {...x, applications:newApps} : x));
    await supabase.from("groups").update({ applications: newApps }).eq("id", id);
    toast("Application submitted!", "success");
  }

  const filtered = groups.filter(g => {
    if (cat !== "all" && g.category !== cat) return false;
    if (fmt === "remote" && !g.remote) return false;
    if (fmt === "local"  &&  g.remote) return false;
    if (q && ![g.name, g.desc, ...g.tags].some(x => x.toLowerCase().includes(q.toLowerCase()))) return false;
    if (passDistIds !== null && !passDistIds.has(g.id)) return false;
    return true;
  });

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
          {filtered.map(g => <GroupCard key={g.id} g={g} onJoin={join} onApply={(grp) => setApplyGroup(grp)} userId={user.id}/>)}
        </div>
      )}
      {modal && <CreateModal onClose={() => setModal(false)} userId={user.id} userName={user.name} onCreate={g => { setGroups(p=>[g,...p]); setModal(false); toast("Group created!", "success"); }}/>}
      {applyGroup && <ApplyModal g={applyGroup} onClose={() => setApplyGroup(null)} onSubmit={(data) => apply(applyGroup.id, data)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADVISOR
// ═══════════════════════════════════════════════════════════════════════════
function AdvisorPage({ goLobby, goProfile }) {
  const toast = useToast();
  const { user } = useAuth();
  const [f, setF]           = useState({ gpa:"", sat:"", act:"", major:"" });
  const [loading, setLoading] = useState(false);
  const [res, setRes]       = useState(null);
  const [caLoading, setCaLoading] = useState(false);
  const [caRes, setCaRes]   = useState(null);
  const set = (k, v) => setF(p => ({...p,[k]:v}));
  const remaining = ClientRateLimit.remaining("claude");

  useEffect(() => {
    if (user) setF(p => ({ ...p, gpa: user.gpa||"", sat: user.sat||"", act: user.act||"", major: user.intended_major||"" }));
  }, []); // pre-fill once on mount

  async function analyze() {
    if (!f.major) { toast("Please enter your intended major.", "warning"); return; }
    if (!passesContentPolicy(f.major)) { toast("Content not allowed.", "error"); return; }
    if (remaining <= 0) { toast("AI request limit reached. Try again in a minute.", "error"); return; }
    setLoading(true); setRes(null);
    try {
      const profileActs = user?.activities?.length
        ? user.activities.map(a => `${a.position} at ${a.org_name} (${a.activity_type})`).join("; ")
        : null;
      const profileAwds = user?.awards?.length
        ? user.awards.map(a => a.title).join("; ")
        : null;
      const activitiesStr = profileActs || "None";
      const awardsLine = profileAwds ? ` Awards:${profileAwds}` : "";
      const sys = `You are an expert college admissions counselor. Return ONLY valid JSON (no markdown, no backticks) with this exact shape:
{"summary":"string","schools":[{"name":"","tier":"Reach|Match|Safety","reason":""}],"strengths":[""],"gaps":[""],"activities":[{"name":"","why":"","category":"stem|premed|biz|arts|social|law|env|sports"}]}
Rules: 5-7 schools, 4-6 activities, be specific and realistic.`;
      const raw  = await callClaude(sys,
        `GPA:${sanitize(f.gpa)||"N/A"} SAT:${sanitize(f.sat)||"N/A"} ACT:${sanitize(f.act)||"N/A"} Major:${sanitize(f.major)} Activities:${activitiesStr}${awardsLine}`,
        [], { maxTokens: 1200 }
      );
      const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
      if (!parsed.schools || !parsed.activities) throw new Error("bad shape");
      // Filter out activities the user already has
      const userActNames = (user?.activities || []).flatMap(a => [a.org_name, a.position].filter(s => s && s.length > 3).map(s => s.toLowerCase()));
      parsed.activities = parsed.activities.filter(a => {
        const name = (a.name || "").toLowerCase();
        return !userActNames.some(existing => name.includes(existing) || existing.includes(name));
      });
      setRes(parsed);
    } catch(e) {
      if (e.message === "RATE_LIMITED") toast("Rate limit reached. Wait 1 minute.", "error");
      else { setRes({error:true}); toast("Analysis failed. Try again.", "error"); }
    }
    setLoading(false);
  }

  async function formatForCommonApp() {
    if (!res?.activities) return;
    if (remaining <= 0) { toast("AI request limit reached. Try again in a minute.", "error"); return; }
    setCaLoading(true); setCaRes(null);
    try {
      const sys = `You are a Common App expert. Return ONLY valid JSON, no markdown, no backticks:
{
  "activities": [
    {
      "activity_type": "one of: Academic, Art, Athletics: Club, Athletics: JV/Varsity, Career-Oriented, Community Service (Volunteer), Computer/Technology, Cultural, Dance, Debate/Speech, Environmental, Family Responsibilities, Foreign Exchange, Journalism/Publication, Junior R.O.T.C., LGBT, Music: Instrumental, Music: Vocal, Religious, Research, Robotics, School Spirit, Science/Math, Social Justice, Student Govt./Politics, Theater/Drama, Work (paid), Other Club/Activity",
      "position": "max 50 characters",
      "org_name": "max 100 characters",
      "description": "max 150 characters, strong action verbs, quantify impact",
      "grades": ["9","10","11","12"],
      "timing": "During school year OR During school break OR All year",
      "hours_per_week": 0,
      "weeks_per_year": 0
    }
  ],
  "awards": [
    {
      "title": "max 100 characters",
      "grades": ["9","10","11","12"],
      "recognition": "School OR State/Regional OR National OR International"
    }
  ]
}
Rules:
- Return exactly 10 activities and up to 5 awards
- STRICTLY enforce character limits
- Pick activity_type from the exact list provided`;
      const profileActs = user?.activities?.length
        ? user.activities.map(a => `${a.position} at ${a.org_name} (${a.activity_type}): ${a.description}`).join("\n")
        : null;
      const profileAwds = user?.awards?.length
        ? user.awards.map(a => `${a.title} (${Array.isArray(a.recognition) ? a.recognition.join("/") : a.recognition})`).join(", ")
        : null;
      const activitiesContext = profileActs || "None";
      const prompt = `Student major: ${f.major}
Current activities: ${activitiesContext}${profileAwds ? `\nHonors/Awards: ${profileAwds}` : ""}
GPA: ${f.gpa}, SAT: ${f.sat}, ACT: ${f.act}
Advisor recommended activities: ${res.activities.map(a => `${a.name}: ${a.why}`).join(', ')}`;
      const raw = await callClaude(sys, prompt, [], { maxTokens: 2000 });
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      if (!parsed.activities) throw new Error("bad shape");
      setCaRes(parsed);
    } catch(e) {
      if (e.message === "RATE_LIMITED") toast("Rate limit reached. Wait 1 minute.", "error");
      else { setCaRes({ error: true }); toast("Formatting failed. Try again.", "error"); }
    }
    setCaLoading(false);
  }

  const TC = { Reach:"var(--red)", Match:"var(--blue)", Safety:"var(--green)" };

  return (
    <div style={{ padding:"2rem 0" }}>
      {remaining <= 3 && remaining > 0 && <div className="rate-banner">⚠ {remaining} AI requests remaining this minute</div>}
      <div style={{ borderBottom:"2px solid var(--ink)", paddingBottom:"1.5rem", marginBottom:"2rem" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"clamp(3rem,8vw,5.5rem)", lineHeight:.9, letterSpacing:".02em" }}>PROFILE<br/><span style={{ WebkitTextStroke:"2px var(--ink)", color:"transparent" }}>ADVISOR</span></div>
        <p style={{ marginTop:".8rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:"1rem" }}>Enter your stats and get honest college + activity recommendations.</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"380px 1fr", gap:"2rem", alignItems:"start" }} className="resp-grid">
        <div style={{ border:"2px solid var(--ink)", padding:"1.6rem", boxShadow:"5px 5px 0 var(--ink)", background:"var(--chalk)" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"1.4rem", letterSpacing:".03em", marginBottom:"1.2rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".8rem" }}>YOUR STATS</div>
          <div style={{ display:"flex", flexDirection:"column", gap:".8rem" }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".6rem" }}>
              <div><label>GPA (Weighted)</label><input value={f.gpa} onChange={e=>set("gpa",e.target.value)} placeholder="4.2" maxLength={6}/></div>
              <div><label>SAT Score</label>    <input value={f.sat} onChange={e=>set("sat",e.target.value)} placeholder="1480" maxLength={6}/></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".6rem" }}>
              <div><label>ACT Score</label>      <input value={f.act}   onChange={e=>set("act",e.target.value)}   placeholder="32" maxLength={4}/></div>
              <div><label>Intended Major *</label><input value={f.major} onChange={e=>set("major",e.target.value)} placeholder="Mech. Engineering" maxLength={80}/></div>
            </div>
            <div>
              <label style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                Current Activities
                {user?.activities?.length > 0 && <span style={{ color:"var(--green)", fontSize:".6rem", fontWeight:700 }}>✓ {user.activities.length} from profile</span>}
              </label>
              {user?.activities?.length > 0 ? (
                <div style={{ display:"flex", flexDirection:"column", gap:".4rem", maxHeight:200, overflowY:"auto", padding:".2rem 0" }}>
                  {user.activities.map((a, i) => (
                    <div key={i} style={{ padding:".5rem .7rem", background:"var(--paper2)", border:"1px solid var(--paper3)", fontSize:".78rem" }}>
                      <div style={{ fontWeight:700, fontSize:".7rem", letterSpacing:".05em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".15rem" }}>{a.activity_type}</div>
                      <div style={{ fontWeight:600 }}>{a.position}{a.org_name ? <span style={{ fontWeight:400, color:"var(--muted)" }}> · {a.org_name}</span> : null}</div>
                      {a.description && <div style={{ color:"var(--muted)", marginTop:".1rem", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:".75rem" }}>{a.description}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding:".6rem .7rem", background:"var(--paper2)", border:"1px solid var(--paper3)", fontSize:".8rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>No activities on profile yet.</div>
              )}
              {goProfile && <button className="btn btn-ghost btn-sm" onClick={goProfile} style={{ marginTop:".4rem", fontSize:".68rem" }}>Edit in Profile →</button>}
            </div>
            <button className="btn btn-orange" onClick={analyze} disabled={loading||!f.major} style={{ marginTop:".4rem", width:"100%", justifyContent:"center" }}>
              {loading ? <><Spinner size={14}/>Analyzing…</> : "Analyze My Profile →"}
            </button>
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:"1.1rem" }}>
          <div className="card fade-up">
            <div style={{ fontFamily:"var(--font-display)", fontSize:"1.2rem", letterSpacing:".04em", marginBottom:".85rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>YOUR HONORS & AWARDS</div>
            {user?.awards?.length > 0 ? (
              <div style={{ display:"flex", flexDirection:"column", gap:".4rem" }}>
                {user.awards.map((a, i) => (
                  <div key={i} style={{ padding:".55rem .75rem", background:"var(--paper2)", border:"1px solid var(--paper3)", fontSize:".82rem" }}>
                    <div style={{ fontWeight:700 }}>{a.title}</div>
                    <div style={{ color:"var(--muted)", fontSize:".73rem", marginTop:".15rem" }}>
                      {Array.isArray(a.recognition) ? a.recognition.join(", ") : a.recognition}
                      {a.grades?.length ? ` · Gr. ${a.grades.join(", ")}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"1rem" }}>
                <p style={{ color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:".85rem", margin:0 }}>No awards yet — add them in your Profile.</p>
                {goProfile && <button className="btn btn-ghost btn-sm" onClick={goProfile} style={{ flexShrink:0 }}>Edit in Profile →</button>}
              </div>
            )}
          </div>

          {!res && !loading && (
            <div style={{ border:"2px dashed var(--muted2)", padding:"4rem", textAlign:"center" }}>
              <div style={{ fontFamily:"var(--font-display)", fontSize:"2.2rem", color:"var(--muted2)", marginBottom:".5rem" }}>RESULTS HERE</div>
              <div style={{ color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>Fill out your profile and click Analyze.</div>
            </div>
          )}
          {loading && <div style={{ border:"2px solid var(--ink)", padding:"3rem", textAlign:"center", boxShadow:"4px 4px 0 var(--ink)", background:"var(--chalk)" }}><Spinner size={28}/><div style={{ marginTop:"1rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>Crunching your profile…</div></div>}
          {res?.error && <div style={{ border:"2px solid var(--red)", padding:"1rem", color:"var(--red)", fontWeight:600 }}>Something went wrong. Try again.</div>}
          {res && !res.error && (
            <>
              <div className="card fade-up">
                <div style={{ fontFamily:"var(--font-display)", fontSize:"1.2rem", letterSpacing:".04em", marginBottom:".7rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>PROFILE SUMMARY</div>
                <p style={{ fontFamily:"var(--font-serif)", fontStyle:"italic", lineHeight:1.7, fontSize:".95rem" }}>{res.summary}</p>
                <div style={{ display:"flex", gap:"1.5rem", marginTop:"1rem", flexWrap:"wrap" }}>
                  <div>
                    <div style={{ fontSize:".63rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--green)", marginBottom:".4rem" }}>Strengths</div>
                    {res.strengths?.map(s => <div key={s} style={{ fontSize:".8rem", color:"var(--muted)", marginBottom:".2rem", display:"flex", gap:".4rem" }}><span style={{ color:"var(--green)", fontWeight:700 }}>+</span>{s}</div>)}
                  </div>
                  <div>
                    <div style={{ fontSize:".63rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--orange)", marginBottom:".4rem" }}>Areas to Grow</div>
                    {res.gaps?.map(g => <div key={g} style={{ fontSize:".8rem", color:"var(--muted)", marginBottom:".2rem", display:"flex", gap:".4rem" }}><span style={{ color:"var(--orange)", fontWeight:700 }}>△</span>{g}</div>)}
                  </div>
                </div>
              </div>
              <div className="card fade-up">
                <div style={{ fontFamily:"var(--font-display)", fontSize:"1.2rem", letterSpacing:".04em", marginBottom:".85rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>COLLEGE MATCHES</div>
                <div style={{ display:"flex", flexDirection:"column", gap:".45rem" }}>
                  {res.schools?.map(s => (
                    <div key={s.name} style={{ display:"flex", gap:".7rem", alignItems:"flex-start", padding:".55rem .7rem", background:"var(--paper2)", border:"1px solid var(--paper3)" }}>
                      <span style={{ fontSize:".6rem", fontWeight:700, padding:".18rem .45rem", border:"1.5px solid", borderColor:TC[s.tier], color:TC[s.tier], flexShrink:0, background:TC[s.tier]+"12" }}>{s.tier?.toUpperCase()}</span>
                      <div><div style={{ fontWeight:600, fontSize:".88rem" }}>{s.name}</div><div style={{ fontSize:".75rem", color:"var(--muted)", marginTop:".1rem" }}>{s.reason}</div></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card fade-up">
                <div style={{ fontFamily:"var(--font-display)", fontSize:"1.2rem", letterSpacing:".04em", marginBottom:".85rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>RECOMMENDED ACTIVITIES</div>
                <div style={{ display:"flex", flexDirection:"column", gap:".5rem", marginBottom:"1.1rem" }}>
                  {res.activities?.map(a => (
                    <div key={a.name} style={{ padding:".65rem .8rem", background:"var(--paper2)", border:"1px solid var(--paper3)" }}>
                      <div style={{ fontWeight:700, fontSize:".875rem", marginBottom:".15rem" }}>{a.name}</div>
                      <div style={{ fontSize:".75rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>{a.why}</div>
                    </div>
                  ))}
                </div>
                <button className="btn btn-orange" style={{ width:"100%", justifyContent:"center" }} onClick={() => goLobby([...new Set((res?.activities||[]).map(a=>a.category).filter(Boolean))])}>Find Groups in Lobby →</button>
                <button className="btn" style={{ width:"100%", justifyContent:"center", marginTop:".6rem", background:"var(--ink)", color:"var(--paper)" }} onClick={formatForCommonApp} disabled={caLoading}>
                  {caLoading ? <><Spinner size={14}/>Formatting…</> : "Format for Common App →"}
                </button>
              </div>
              {caLoading && (
                <div style={{ border:"2px solid var(--ink)", padding:"3rem", textAlign:"center", boxShadow:"4px 4px 0 var(--ink)", background:"var(--chalk)" }}>
                  <Spinner size={28}/>
                  <div style={{ marginTop:"1rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>Formatting for Common App…</div>
                </div>
              )}
              {caRes?.error && <div style={{ border:"2px solid var(--red)", padding:"1rem", color:"var(--red)", fontWeight:600 }}>Formatting failed. Try again.</div>}
              {caRes && !caRes.error && <CommonAppResults caRes={caRes} toast={toast}/>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMON APP RESULTS
// ═══════════════════════════════════════════════════════════════════════════
function CommonAppResults({ caRes, toast }) {
  function cc(text, max) {
    const len = (text || "").length;
    return <span style={{ fontSize:".63rem", fontWeight:700, color:len > max ? "var(--red)" : "var(--muted)", marginLeft:".3rem" }}>{len}/{max}</span>;
  }
  function copyText(text) {
    navigator.clipboard.writeText(text).catch(() => {});
    toast("Copied!", "success");
  }
  function activityText(a, i) {
    return [
      `[${i+1}] ${a.org_name}`,
      `Activity Type: ${a.activity_type}`,
      `Position/Leadership: ${a.position}`,
      `Description: ${a.description}`,
      `Grades: ${(a.grades||[]).join(", ")}`,
      `Timing: ${a.timing}`,
      `Hours/week: ${a.hours_per_week} | Weeks/year: ${a.weeks_per_year}`,
    ].join("\n");
  }
  function awardText(a, i) {
    return [
      `[${i+1}] ${a.title}`,
      `Grades: ${(a.grades||[]).join(", ")}`,
      `Recognition: ${a.recognition}`,
    ].join("\n");
  }
  function copyAll() {
    const acts = (caRes.activities||[]).map((a,i) => activityText(a,i)).join("\n\n");
    const awds = (caRes.awards||[]).map((a,i) => awardText(a,i)).join("\n\n");
    copyText(`=== ACTIVITIES ===\n\n${acts}${awds ? `\n\n=== HONORS & AWARDS ===\n\n${awds}` : ""}`);
  }

  return (
    <div className="card fade-up">
      <div style={{ fontFamily:"var(--font-display)", fontSize:"1.2rem", letterSpacing:".04em", marginBottom:".85rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>COMMON APP FORMAT</div>

      <div style={{ fontFamily:"var(--font-display)", fontSize:".9rem", letterSpacing:".04em", marginBottom:".6rem", color:"var(--orange)" }}>ACTIVITIES</div>
      <div style={{ display:"flex", flexDirection:"column", gap:".7rem", marginBottom:"1.5rem" }}>
        {(caRes.activities||[]).map((a,i) => (
          <div key={i} style={{ padding:".8rem", background:"var(--paper2)", border:"1px solid var(--paper3)" }}>
            <div style={{ fontWeight:700, fontSize:".7rem", letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".5rem" }}>Activity {i+1}</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".35rem .8rem", fontSize:".8rem", marginBottom:".5rem" }}>
              <div><span style={{ fontWeight:600, color:"var(--muted)" }}>Type:</span> {a.activity_type}</div>
              <div><span style={{ fontWeight:600, color:"var(--muted)" }}>Grades:</span> {(a.grades||[]).join(", ")}</div>
              <div style={{ gridColumn:"1/-1" }}><span style={{ fontWeight:600, color:"var(--muted)" }}>Position:</span> {a.position}{cc(a.position, 50)}</div>
              <div style={{ gridColumn:"1/-1" }}><span style={{ fontWeight:600, color:"var(--muted)" }}>Organization:</span> {a.org_name}{cc(a.org_name, 100)}</div>
              <div style={{ gridColumn:"1/-1" }}><span style={{ fontWeight:600, color:"var(--muted)" }}>Description:</span> {a.description}{cc(a.description, 150)}</div>
              <div><span style={{ fontWeight:600, color:"var(--muted)" }}>Timing:</span> {a.timing}</div>
              <div><span style={{ fontWeight:600, color:"var(--muted)" }}>Hours/wk:</span> {a.hours_per_week} | <span style={{ fontWeight:600, color:"var(--muted)" }}>Wks/yr:</span> {a.weeks_per_year}</div>
            </div>
            <button className="btn" style={{ padding:".22rem .65rem", fontSize:".68rem" }} onClick={() => copyText(activityText(a,i))}>Copy</button>
          </div>
        ))}
      </div>

      {(caRes.awards||[]).length > 0 && (
        <>
          <div style={{ fontFamily:"var(--font-display)", fontSize:".9rem", letterSpacing:".04em", marginBottom:".6rem", color:"var(--orange)" }}>HONORS & AWARDS</div>
          <div style={{ display:"flex", flexDirection:"column", gap:".7rem", marginBottom:"1.5rem" }}>
            {(caRes.awards||[]).map((a,i) => (
              <div key={i} style={{ padding:".8rem", background:"var(--paper2)", border:"1px solid var(--paper3)" }}>
                <div style={{ fontWeight:700, fontSize:".7rem", letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".5rem" }}>Award {i+1}</div>
                <div style={{ display:"flex", flexDirection:"column", gap:".3rem", fontSize:".8rem", marginBottom:".5rem" }}>
                  <div><span style={{ fontWeight:600, color:"var(--muted)" }}>Title:</span> {a.title}{cc(a.title, 100)}</div>
                  <div><span style={{ fontWeight:600, color:"var(--muted)" }}>Grades:</span> {(a.grades||[]).join(", ")}</div>
                  <div><span style={{ fontWeight:600, color:"var(--muted)" }}>Recognition:</span> {a.recognition}</div>
                </div>
                <button className="btn" style={{ padding:".22rem .65rem", fontSize:".68rem" }} onClick={() => copyText(awardText(a,i))}>Copy</button>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="btn btn-orange" style={{ width:"100%", justifyContent:"center" }} onClick={copyAll}>Copy All →</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MY GROUPS
// ═══════════════════════════════════════════════════════════════════════════
function MyGroupsPage({ groups, setGroups, goChat }) {
  const { user } = useAuth();
  const toast    = useToast();
  const [appsModal, setAppsModal] = useState(null); // group object
  const mine     = groups.filter(g => g.members.includes(user.id));

  async function leave(id) {
    const g = groups.find(x => x.id === id);
    if (g?.byId === user.id) { toast("You own this group — delete it instead.", "warning"); return; }
    const newMembers = g.members.filter(m => m !== user.id);
    setGroups(gs => gs.map(x => x.id===id ? {...x, members:newMembers} : x));
    await supabase.from("groups").update({ members: newMembers }).eq("id", id);
    toast("Left the group.", "success");
  }
  async function deleteGroup(id) {
    setGroups(gs => gs.filter(g => g.id !== id));
    await supabase.from("groups").delete().eq("id", id);
    toast("Group deleted.", "success");
  }
  async function approveApp(groupId, appUserId) {
    const g = groups.find(x => x.id === groupId);
    const newApps    = (g?.applications || []).map(a => a.userId === appUserId ? { ...a, status: "approved" } : a);
    const newMembers = g.members.includes(appUserId) ? g.members : [...g.members, appUserId];
    setGroups(gs => gs.map(x => x.id===groupId ? {...x, applications:newApps, members:newMembers} : x));
    setAppsModal(prev => prev ? { ...prev, applications: newApps, members: newMembers } : null);
    await supabase.from("groups").update({ applications: newApps, members: newMembers }).eq("id", groupId);
    toast("Application approved.", "success");
  }
  async function declineApp(groupId, appUserId) {
    const g = groups.find(x => x.id === groupId);
    const newApps = (g?.applications || []).map(a => a.userId === appUserId ? { ...a, status: "declined" } : a);
    setGroups(gs => gs.map(x => x.id===groupId ? {...x, applications:newApps} : x));
    setAppsModal(prev => prev ? { ...prev, applications: newApps } : null);
    await supabase.from("groups").update({ applications: newApps }).eq("id", groupId);
    toast("Application declined.", "success");
  }

  return (
    <div style={{ padding:"2rem 0" }}>
      <div style={{ borderBottom:"2px solid var(--ink)", paddingBottom:"1.5rem", marginBottom:"2rem" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"clamp(3rem,8vw,5.5rem)", lineHeight:.9, letterSpacing:".02em" }}>MY<br/><span style={{ WebkitTextStroke:"2px var(--ink)", color:"transparent" }}>GROUPS</span></div>
        <p style={{ marginTop:".8rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:"1rem" }}>Groups you've created or joined.</p>
      </div>
      {mine.length === 0 ? (
        <div style={{ border:"2px dashed var(--muted2)", padding:"4rem", textAlign:"center" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"2.2rem", color:"var(--muted2)", marginBottom:".5rem" }}>NO GROUPS YET</div>
          <div style={{ color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>Head to the Lobby to join or start one.</div>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(288px,1fr))", gap:"1rem" }}>
          {mine.map(g => {
            const mcat = CATS.find(c=>c.id===g.category);
            const mcBg     = CAT_BG[mcat?.color]     || "var(--chalk)";
            const mcAccent = CAT_ACCENT[mcat?.color] || "var(--ink)";
            const mcShadow = CAT_SHADOW[mcat?.color] || "rgba(15,14,13,.35)";
            const pendingCount = g.byId === user.id && g.group_type === "invite_only"
              ? (g.applications || []).filter(a => a.status === "pending").length
              : 0;
            return (
            <div key={g.id} className="card fade-up" style={{ display:"flex", flexDirection:"column", gap:".8rem", background: mcBg, borderColor: mcAccent, boxShadow: `4px 4px 0 ${mcShadow}` }}>
              <div>
                <div style={{ fontSize:".63rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".25rem" }}>{mcat?.icon} {g.sub}</div>
                <div style={{ fontFamily:"var(--font-body)", fontWeight:700, fontSize:".97rem", lineHeight:1.25 }}>{g.name}</div>
              </div>
              <p style={{ fontSize:".83rem", color:"var(--muted)", lineHeight:1.55, fontStyle:"italic", fontFamily:"var(--font-serif)", flex:1 }}>{g.desc}</p>
              <MemberBar count={g.members.length} max={g.max}/>
              <div style={{ borderTop:"1.5px solid var(--paper3)", paddingTop:".75rem", display:"flex", justifyContent:"space-between", alignItems:"center", gap:".5rem", flexWrap:"wrap" }}>
                <div style={{ display:"flex", gap:".4rem", alignItems:"center" }}>
                  {g.byId === user.id ? <span className="tag tag-orange">👑 Owner</span> : <span className="tag tag-blue">Member</span>}
                  {pendingCount > 0 && (
                    <span style={{ background:"var(--red)", color:"#fff", borderRadius:"999px", fontSize:".62rem", fontWeight:700, padding:".1rem .45rem", lineHeight:1.4 }}>{pendingCount}</span>
                  )}
                </div>
                <div style={{ display:"flex", gap:".4rem", flexWrap:"wrap" }}>
                  {g.byId === user.id && g.group_type === "invite_only" && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setAppsModal(g)}>
                      Applications{pendingCount > 0 ? ` (${pendingCount})` : ""}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => goChat(g.id)}>💬 Chat</button>
                  {g.byId === user.id
                    ? <button className="btn btn-sm btn-danger" onClick={() => deleteGroup(g.id)}>Delete</button>
                    : <button className="btn btn-sm btn-danger" onClick={() => leave(g.id)}>Leave</button>}
                </div>
              </div>
            </div>
          ); })}
        </div>
      )}
      {appsModal && <ApplicationsModal g={appsModal} onClose={() => setAppsModal(null)} onApprove={(uid) => approveApp(appsModal.id, uid)} onDecline={(uid) => declineApp(appsModal.id, uid)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT
// ═══════════════════════════════════════════════════════════════════════════
function ChatPage({ groups, setGroups, jumpGroup, onUnreadChange }) {
  const { user }   = useAuth();
  const toast      = useToast();
  const onlineUsers = useOnline();

  // ── per-thread message state ──────────────────────────────────────────
  const [threadMsgs, setThreadMsgs]   = useState([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [previews, setPreviews]       = useState({});     // { threadId: { text, ts } }
  const [unreadMap, setUnreadMap]     = useState({});     // { threadId: count }
  const [lastRead, setLastRead]       = useState(() => {
    try { return JSON.parse(localStorage.getItem("ec:lastRead") || "{}"); } catch { return {}; }
  });
  const [dmThreadList, setDmThreadList] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`ec:dms_${user.id}`) || "[]"); } catch { return []; }
  }); // [{ id, name, otherId }]

  const [active, setActive]           = useState(null);
  const [input, setInput]             = useState("");
  const [showDM, setShowDM]           = useState(false);
  const [dmTarget, setDmTarget]       = useState("");
  const [callModal, setCallModal]     = useState(null);
  const [showInfo, setShowInfo]       = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [profileUser, setProfileUser] = useState(null);

  const endRef      = useRef(null);
  const fileRef     = useRef(null);
  const activeRef   = useRef(null);   // stale-closure-safe ref to active
  const threadChRef = useRef(null);   // current thread channel
  const globalChRef = useRef(null);   // global unread-tracking channel

  const mine = groups.filter(g => g.members.includes(user.id));

  // keep activeRef in sync
  useEffect(() => { activeRef.current = active; }, [active]);

  // auto-scroll
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [threadMsgs]);

  // report total unread to parent nav badge
  useEffect(() => {
    const total = Object.values(unreadMap).reduce((s, n) => s + n, 0);
    onUnreadChange?.(total);
  }, [unreadMap]);

  // jump to group from MyGroups → Go to Chat
  useEffect(() => {
    if (jumpGroup) {
      const g = groups.find(x => x.id === jumpGroup);
      if (g) openThread({ id: jumpGroup, type:"group", name:g.name });
    }
  }, [jumpGroup]);

  // Load sidebar previews + initial unread counts + global subscription
  useEffect(() => {
    const allThreads = [...mine.map(g => ({ id: g.id })), ...dmThreadList];

    // sidebar previews: last message per thread
    allThreads.forEach(t => {
      supabase.from("messages").select("*").eq("thread_id", t.id)
        .order("created_at", { ascending: false }).limit(1)
        .then(({ data }) => {
          if (data?.[0]) {
            const m = data[0];
            setPreviews(p => ({ ...p, [t.id]: { text: m.text || "📎 Media", ts: new Date(m.created_at).getTime() } }));
          }
        });
    });

    // initial unread: count messages since last open, not sent by self
    allThreads.forEach(t => {
      const since = lastRead[t.id] || "1970-01-01T00:00:00Z";
      supabase.from("messages").select("id", { count:"exact", head:true })
        .eq("thread_id", t.id).gt("created_at", since).neq("sender_id", user.id)
        .then(({ count }) => { if (count) setUnreadMap(p => ({ ...p, [t.id]: count })); });
    });

    // global subscription for unread on non-active threads
    const myIds = new Set(allThreads.map(t => t.id));
    const globalCh = supabase.channel("msgs-unread-global")
      .on("postgres_changes", { event:"INSERT", schema:"public", table:"messages" }, ({ new: msg }) => {
        if (!myIds.has(msg.thread_id) || msg.sender_id === user.id) return;
        if (msg.thread_id === activeRef.current?.id) return;
        setUnreadMap(p => ({ ...p, [msg.thread_id]: (p[msg.thread_id] || 0) + 1 }));
        setPreviews(p => ({ ...p, [msg.thread_id]: { text: msg.text || "📎 Media", ts: new Date(msg.created_at).getTime() } }));
      })
      .subscribe();
    globalChRef.current = globalCh;
    return () => { supabase.removeChannel(globalCh); globalChRef.current = null; };
  }, []); // intentionally once on mount

  // subscribe to active thread messages
  useEffect(() => {
    if (!active) return;
    if (threadChRef.current) { supabase.removeChannel(threadChRef.current); threadChRef.current = null; }

    setMsgsLoading(true);
    supabase.from("messages").select("*").eq("thread_id", active.id).order("created_at")
      .then(({ data }) => { setThreadMsgs((data || []).map(normalizeMsg)); setMsgsLoading(false); });

    const ch = supabase.channel(`thread:${active.id}`)
      .on("postgres_changes", { event:"INSERT", schema:"public", table:"messages", filter:`thread_id=eq.${active.id}` }, ({ new: msg }) => {
        const nm = normalizeMsg(msg);
        setThreadMsgs(p => p.some(m => m.id === nm.id) ? p : [...p, nm]);
        setPreviews(p => ({ ...p, [active.id]: { text: nm.text || "📎 Media", ts: nm.ts } }));
      })
      .subscribe();
    threadChRef.current = ch;
    return () => { supabase.removeChannel(ch); threadChRef.current = null; };
  }, [active?.id]);

  function normalizeMsg(m) {
    return {
      id:         m.id,
      senderId:   m.sender_id   ?? m.senderId   ?? "",
      senderName: m.sender_name ?? m.senderName ?? "",
      text:       m.text        ?? "",
      media:      m.media       ?? null,
      ts:         m.created_at  ? new Date(m.created_at).getTime() : (m.ts || 0),
    };
  }

  function openThread(t) {
    setActive(t);
    setShowInfo(false);
    const now = new Date().toISOString();
    setLastRead(prev => {
      const next = { ...prev, [t.id]: now };
      localStorage.setItem("ec:lastRead", JSON.stringify(next));
      return next;
    });
    setUnreadMap(p => ({ ...p, [t.id]: 0 }));
  }

  function dmKey(aId, bId) { return "dm_" + [aId,bId].sort().join("_"); }
  function canSend(t) {
    if (!t) return false;
    if (t.type === "group") return groups.find(g=>g.id===t.id)?.members.includes(user.id);
    return true;
  }

  async function send() {
    if (!input.trim() || !active) return;
    if (!canSend(active)) { toast("Join this group to send messages.", "warning"); return; }
    const text = sanitize(input.trim(), 2000);
    if (!text || !passesContentPolicy(text)) return;
    setInput("");
    const { data, error } = await supabase.from("messages").insert({
      thread_id: active.id, sender_id: user.id, sender_name: user.name, text,
    }).select().single();
    if (error) { toast("Send failed: " + error.message, "error"); return; }
    const nm = normalizeMsg(data);
    setThreadMsgs(p => p.some(m => m.id === nm.id) ? p : [...p, nm]);
    setPreviews(p => ({ ...p, [active.id]: { text: nm.text, ts: nm.ts } }));
  }

  function startDM() {
    if (!dmTarget) return;
    const k = dmKey(user.id, dmTarget);
    const target = MOCK_USERS.find(u => u.id === dmTarget);
    setDmThreadList(prev => {
      if (prev.some(dt => dt.id === k)) return prev;
      const next = [...prev, { id:k, name:target?.name||"?", otherId:dmTarget }];
      localStorage.setItem(`ec:dms_${user.id}`, JSON.stringify(next));
      return next;
    });
    openThread({ id:k, type:"dm", name:target?.name||"?" });
    setShowDM(false); setDmTarget("");
  }

  async function uploadFile(file) {
    if (!active) return;
    if (file.size > 20 * 1024 * 1024) { toast("File must be under 20MB.", "warning"); return; }
    setUploading(true);
    try {
      const ext  = file.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("chat-media").upload(path, file);
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("chat-media").getPublicUrl(path);
      const { data, error } = await supabase.from("messages").insert({
        thread_id: active.id, sender_id: user.id, sender_name: user.name,
        text: "", media: { url: publicUrl, type: file.type, name: file.name },
      }).select().single();
      if (error) throw error;
      const nm = normalizeMsg(data);
      setThreadMsgs(p => p.some(m => m.id === nm.id) ? p : [...p, nm]);
      setPreviews(p => ({ ...p, [active.id]: { text: "📎 Media", ts: nm.ts } }));
    } catch(e) {
      toast("Upload failed: " + e.message, "error");
    } finally {
      setUploading(false);
    }
  }

  const activeGroup    = active?.type==="group" ? mine.find(g=>g.id===active.id) : null;
  const groupThreads   = mine.map(g => ({
    id:g.id, type:"group", name:g.name,
    preview: previews[g.id]?.text || "No messages",
    ts:      previews[g.id]?.ts   || (g.created_at ? new Date(g.created_at).getTime() : g.ts || 0),
    unread:  unreadMap[g.id] || 0,
  }));
  const dmThreadsView  = dmThreadList.map(dt => ({
    ...dt, type:"dm",
    preview: previews[dt.id]?.text || "",
    ts:      previews[dt.id]?.ts   || 0,
    unread:  unreadMap[dt.id] || 0,
  }));

  return (
    <div className="chat-layout">
      {/* ── Sidebar ── */}
      <div className="chat-sidebar">
        <div style={{ padding:".85rem 1rem", borderBottom:"2px solid var(--ink)", display:"flex", alignItems:"center", justifyContent:"space-between", background:"var(--paper3)" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"1.1rem", letterSpacing:".04em" }}>MESSAGES</div>
          <button className="btn btn-sm btn-orange" onClick={() => setShowDM(true)}>+ DM</button>
        </div>

        {groupThreads.length > 0 && <>
          <div style={{ padding:".5rem 1rem .25rem", fontSize:".6rem", fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", color:"var(--muted)", background:"var(--paper2)", borderBottom:"1px solid var(--paper3)" }}>Groups</div>
          {groupThreads.map(t => (
            <div key={t.id} className={`chat-thread ${active?.id===t.id?"active":""}`} onClick={() => openThread(t)}>
              <Avatar name={t.name[0]} size={32}/>
              <div style={{ flex:1, overflow:"hidden" }}>
                <div className="thread-name">{t.name}</div>
                <div className="thread-preview">{t.preview}</div>
              </div>
              {t.unread > 0
                ? <span style={{ background:"var(--orange)", color:"var(--paper)", borderRadius:"999px", fontSize:".6rem", fontWeight:700, padding:"1px 6px", flexShrink:0 }}>{t.unread > 99 ? "99+" : t.unread}</span>
                : <span className="tag" style={{ fontSize:".55rem", flexShrink:0 }}>Group</span>
              }
            </div>
          ))}
        </>}

        <div style={{ padding:".5rem 1rem .25rem", fontSize:".6rem", fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", color:"var(--muted)", background:"var(--paper2)", borderBottom:"1px solid var(--paper3)" }}>Direct Messages</div>
        {dmThreadsView.length === 0 && <div style={{ padding:".8rem 1rem", fontSize:".78rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>No DMs yet — hit + DM to start one.</div>}
        {dmThreadsView.map(t => (
          <div key={t.id} className={`chat-thread ${active?.id===t.id?"active":""}`} onClick={() => openThread(t)}>
            <div style={{ position:"relative", flexShrink:0 }}>
              <Avatar name={t.name} size={32}/>
              {onlineUsers?.has(t.otherId) && <div style={{ position:"absolute", bottom:0, right:0, width:9, height:9, borderRadius:"50%", background:"var(--green)", border:"2px solid var(--paper)" }}/>}
            </div>
            <div style={{ flex:1, overflow:"hidden" }}>
              <div className="thread-name">{t.name}</div>
              <div className="thread-preview">{t.preview}</div>
            </div>
            {t.unread > 0 && <span style={{ background:"var(--orange)", color:"var(--paper)", borderRadius:"999px", fontSize:".6rem", fontWeight:700, padding:"1px 6px", flexShrink:0 }}>{t.unread > 99 ? "99+" : t.unread}</span>}
          </div>
        ))}
      </div>

      {/* ── Main ── */}
      <div className="chat-main" style={{ position:"relative" }}>
        {!active ? (
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"1rem" }}>
            <div style={{ fontFamily:"var(--font-display)", fontSize:"2.5rem", letterSpacing:".05em", color:"var(--paper3)" }}>SELECT A CHAT</div>
            <div style={{ fontStyle:"italic", fontFamily:"var(--font-serif)", color:"var(--muted2)" }}>Choose a group or DM from the sidebar.</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding:".8rem 1.2rem", borderBottom:"2px solid var(--ink)", display:"flex", alignItems:"center", gap:".8rem", background:"var(--paper2)" }}>
              <Avatar name={active.name} size={32}/>
              <div>
                <div style={{ fontFamily:"var(--font-body)", fontWeight:700, fontSize:".95rem" }}>{active.name}</div>
                {activeGroup && <div style={{ fontSize:".7rem", color:"var(--muted)", fontStyle:"italic" }}>{activeGroup.members.length} members · {activeGroup.sub}</div>}
                {active.type==="dm" && <div style={{ fontSize:".68rem", color:"var(--green)", fontWeight:700, letterSpacing:".05em", textTransform:"uppercase" }}>● Direct Message</div>}
              </div>
              <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:".35rem", flexWrap:"wrap" }}>
                {activeGroup && activeGroup.tags.slice(0,2).map(t=><span key={t} className="tag" style={{fontSize:".58rem"}}>{t}</span>)}
                <button className="btn btn-ghost btn-sm" onClick={() => setCallModal({ type:"video", roomId:active.id, title:active.name })} title="Video call">📹</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setCallModal({ type:"audio", roomId:active.id, title:active.name })} title="Voice call">📞</button>
                {activeGroup && <button className="btn btn-ghost btn-sm" onClick={() => setShowInfo(v=>!v)} title="Group info">⋯</button>}
              </div>
            </div>

            {/* Messages */}
            <div className="chat-messages">
              {msgsLoading && <div style={{ textAlign:"center", color:"var(--muted)", margin:"2rem 0", display:"flex", alignItems:"center", justifyContent:"center", gap:".5rem" }}><Spinner/>Loading…</div>}
              {!msgsLoading && threadMsgs.length===0 && <div style={{ textAlign:"center", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", margin:"2rem 0" }}>No messages yet — say something! 👋</div>}
              {threadMsgs.map((m, i) => {
                const self       = m.senderId === user.id;
                const showSender = !self && (i===0 || threadMsgs[i-1]?.senderId !== m.senderId);
                return (
                  <div key={m.id} style={{ display:"flex", flexDirection:"column", alignItems:self?"flex-end":"flex-start", gap:".12rem", animation:"msgIn .2s ease" }}>
                    {showSender && <div onClick={() => setProfileUser({ id:m.senderId })} style={{ fontSize:".63rem", fontWeight:700, color:avatarColor(m.senderName), marginLeft:"2.6rem", letterSpacing:".04em", cursor:"pointer" }}>{m.senderName}</div>}
                    <div style={{ display:"flex", alignItems:"flex-end", gap:".45rem", flexDirection:self?"row-reverse":"row" }}>
                      {!self && (i===0 || threadMsgs[i-1]?.senderId!==m.senderId)
                        ? <div onClick={() => setProfileUser({ id:m.senderId })} style={{ cursor:"pointer" }}><Avatar name={m.senderName} size={24}/></div>
                        : <div style={{ width:24 }}/>}
                      <div className={`msg-bubble ${self?"msg-self":"msg-other"}`}>
                        {m.media ? (
                          m.media.type?.startsWith("image/")
                            ? <img src={m.media.url} alt={m.media.name} style={{ maxWidth:220, maxHeight:200, borderRadius:4, display:"block", marginBottom:".2rem" }}/>
                            : <a href={m.media.url} download={m.media.name} style={{ display:"flex", alignItems:"center", gap:".4rem", color:"inherit" }}>
                                <span>{fileIcon(m.media.type)}</span>
                                <span style={{ textDecoration:"underline", fontSize:".8rem" }}>{m.media.name}</span>
                              </a>
                        ) : m.text}
                        <div style={{ fontSize:".6rem", opacity:.55, marginTop:".2rem", textAlign:self?"right":"left" }}>{ftime(m.ts)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef}/>
            </div>

            {/* Input */}
            <div className="chat-input-row">
              {canSend(active) ? (
                <>
                  <input type="file" ref={fileRef} style={{ display:"none" }} onChange={e => { if(e.target.files[0]) uploadFile(e.target.files[0]); e.target.value=""; }}/>
                  <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach file" style={{ flexShrink:0 }}>{uploading ? <Spinner/> : "📎"}</button>
                  <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}}} placeholder={`Message ${active.name}…`} rows={1} style={{ resize:"none", maxHeight:110, overflowY:"auto", flex:1 }} maxLength={2000}/>
                  <button className="btn" onClick={send} disabled={!input.trim()}>Send</button>
                </>
              ) : (
                <div style={{ flex:1, fontSize:".78rem", color:"var(--muted)", fontStyle:"italic", padding:".4rem 0" }}>Join this group to send messages.</div>
              )}
            </div>
            {showInfo && activeGroup && <GroupInfoPanel group={activeGroup} groups={groups} setGroups={setGroups} msgs={{ [activeGroup.id]: threadMsgs }} userId={user.id} onClose={() => setShowInfo(false)}/>}
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {showDM && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowDM(false)}>
          <div className="modal" style={{ maxWidth:360 }}>
            <div style={{ fontFamily:"var(--font-display)", fontSize:"1.6rem", letterSpacing:".04em", marginBottom:"1.2rem" }}>NEW DM</div>
            <label>Select a User</label>
            <select value={dmTarget} onChange={e=>setDmTarget(e.target.value)}>
              <option value="">Choose someone…</option>
              {MOCK_USERS.filter(u=>u.id!==user.id).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <div style={{ display:"flex", gap:".6rem", marginTop:"1.2rem", justifyContent:"flex-end" }}>
              <button className="btn btn-ghost" onClick={()=>setShowDM(false)}>Cancel</button>
              <button className="btn btn-orange" onClick={startDM} disabled={!dmTarget}>Open Chat</button>
            </div>
          </div>
        </div>
      )}
      {callModal && <CallModal title={callModal.title} roomId={callModal.roomId} type={callModal.type} onClose={() => setCallModal(null)}/>}
      {profileUser && <UserProfileModal userId={profileUser.id} onClose={() => setProfileUser(null)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AI CHAT
// ═══════════════════════════════════════════════════════════════════════════
function AIChatPage() {
  const toast = useToast();
  const [msgs, setMsgs] = useState([{ role:"assistant", text:"Hey! I'm the ExtraCrew advisor. Ask me anything about extracurricular activities, college strategy, or how to stand out on applications. 🎓" }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  async function send() {
    if (!input.trim() || loading) return;
    const u = sanitize(input.trim(), 500);
    if (!u || !passesContentPolicy(u)) return;
    if (ClientRateLimit.remaining("claude") <= 0) { toast("AI request limit reached. Try again in a minute.", "error"); return; }
    setInput("");
    setMsgs(p => [...p, { role:"user", text:u }]);
    setLoading(true);
    try {
      const hist = msgs.slice(-10).map(m => ({ role:m.role==="assistant"?"assistant":"user", content:m.text }));
      const r = await callClaude(
        "You are ExtraCrew Advisor, an expert college admissions counselor specializing in extracurriculars for high school students. Be direct, conversational, and honest. Under 180 words unless asked for more.",
        u, hist
      );
      setMsgs(p => [...p, { role:"assistant", text:r }]);
    } catch(e) {
      const msg = e.message==="RATE_LIMITED" ? "Rate limit reached. Wait 1 minute." : "Something went wrong. Try again.";
      setMsgs(p => [...p, { role:"assistant", text:msg }]);
    }
    setLoading(false);
  }

  return (
    <div style={{ padding:"2rem 0", display:"flex", flexDirection:"column", height:"calc(100vh - 120px)" }}>
      <div style={{ borderBottom:"2px solid var(--ink)", paddingBottom:"1.2rem", marginBottom:"1.2rem" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"clamp(2.5rem,6vw,4rem)", lineHeight:.9, letterSpacing:".02em" }}>AI ADVISOR</div>
        <p style={{ marginTop:".6rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>Ask anything about activities, schools, or strategy.</p>
        <div style={{ marginTop:".4rem", fontSize:".65rem", color:"var(--muted2)", fontWeight:600, letterSpacing:".05em", textTransform:"uppercase" }}>{ClientRateLimit.remaining("claude")} AI requests remaining this minute</div>
      </div>
      <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:".75rem", paddingRight:".3rem", marginBottom:"1rem" }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
            <div style={{ maxWidth:"72%", border:"2px solid var(--ink)", padding:".7rem 1rem", fontSize:".875rem", lineHeight:1.65, whiteSpace:"pre-wrap", background:m.role==="user"?"var(--ink)":"var(--chalk)", color:m.role==="user"?"var(--paper)":"var(--ink)", boxShadow:m.role==="user"?"-3px 3px 0 var(--orange)":"3px 3px 0 var(--ink)" }}>
              {m.role==="assistant" && <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", color:"var(--orange)", marginBottom:".35rem" }}>EXTRACREW ADVISOR</div>}
              {m.text}
            </div>
          </div>
        ))}
        {loading && <div style={{ display:"flex" }}><div style={{ border:"2px solid var(--ink)", padding:".7rem 1rem", background:"var(--chalk)", boxShadow:"3px 3px 0 var(--ink)", display:"flex", alignItems:"center", gap:".6rem" }}><Spinner/><span style={{ fontSize:".78rem", color:"var(--muted)", fontStyle:"italic" }}>Thinking…</span></div></div>}
        <div ref={endRef}/>
      </div>
      <div style={{ display:"flex", gap:".5rem" }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ask about activities, schools, or strategy…" style={{ flex:1 }} maxLength={500}/>
        <button className="btn btn-orange" onClick={send} disabled={loading}>Send</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════
function ProfilePage() {
  const { user, logout, updateProfile } = useAuth();
  const toast = useToast();
  const [bioEdit, setBioEdit]       = useState(false);
  const [bio, setBio]               = useState(user?.bio || "");
  const [acad, setAcad]             = useState({ gpa: user?.gpa||"", sat: user?.sat||"", act: user?.act||"", intended_major: user?.intended_major||"" });
  const [activities, setActivities] = useState(user?.activities || []);
  const [awards, setAwards]         = useState(user?.awards || []);
  const [saving, setSaving]         = useState(false);
  const [acadSaving, setAcadSaving] = useState(false);
  const [avatarUrl, setAvatarUrl]   = useState(user?.avatar_url || "");
  const [avatarHover, setAvatarHover] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [links, setLinks]           = useState({ linkedin: user?.social_links?.linkedin || "", instagram: user?.social_links?.instagram || "", email: user?.social_links?.email || "", whatsapp: user?.social_links?.whatsapp || "" });
  const [linksSaving, setLinksSaving] = useState(false);
  const fileInputRef = useRef(null);
  const sa = (k, v) => setAcad(p => ({...p, [k]: v}));

  const blankActivity = () => ({
    activity_type: "Other Club/Activity", position: "", org_name: "", description: "",
    grades: [], timing: "During school year", hours_per_week: 0, weeks_per_year: 0,
  });
  const blankAward = () => ({ title: "", grades: [], recognition: [] });

  async function uploadAvatar(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast("Image must be under 5MB.", "warning"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upErr) { toast("Upload failed. Try again.", "error"); setUploading(false); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = data.publicUrl;
    const { error: dbErr } = await supabase.from("users").update({ avatar_url: url }).eq("id", user.id);
    if (dbErr) { toast("Save failed. Try again.", "error"); setUploading(false); return; }
    setAvatarUrl(url);
    updateProfile({ avatar_url: url });
    toast("Photo updated!", "success");
    setUploading(false);
  }

  async function saveLinks() {
    setLinksSaving(true);
    const cleaned = {
      linkedin: sanitize(links.linkedin, 200),
      instagram: sanitize(links.instagram, 60).replace(/^@/, ""),
      email: sanitize(links.email, 120),
      whatsapp: sanitize(links.whatsapp, 20).replace(/\D/g, ""),
    };
    const { error } = await supabase.from("users").update({ social_links: cleaned }).eq("id", user.id);
    if (error) toast("Save failed. Try again.", "error");
    else { updateProfile({ social_links: cleaned }); toast("Links saved!", "success"); }
    setLinksSaving(false);
  }

  function saveBio() {
    const clean = sanitize(bio, 300);
    if (!Validators.maxLen(clean, 300)) { toast("Bio too long (max 300 chars).", "warning"); return; }
    updateProfile({ bio: clean });
    setBioEdit(false);
    toast("Bio updated!", "success");
  }

  async function saveAcad() {
    setAcadSaving(true);
    const updates = {
      gpa: sanitize(acad.gpa, 10),
      sat: sanitize(acad.sat, 10),
      act: sanitize(acad.act, 6),
      intended_major: sanitize(acad.intended_major, 80),
    };
    const { error } = await supabase.from("users").update(updates).eq("id", user.id);
    if (error) toast("Save failed. Try again.", "error");
    else { updateProfile(updates); toast("Academic profile saved!", "success"); }
    setAcadSaving(false);
  }

  async function saveProfile() {
    setSaving(true);
    const cleanActs = activities.map(a => ({
      ...a, position: sanitize(a.position, 50), org_name: sanitize(a.org_name, 100), description: sanitize(a.description, 150),
    }));
    const updates = {
      gpa: sanitize(acad.gpa, 10),
      sat: sanitize(acad.sat, 10),
      act: sanitize(acad.act, 6),
      intended_major: sanitize(acad.intended_major, 80),
      activities: cleanActs,
      awards,
      social_links: links,
    };
    const { error } = await supabase.from("users").update(updates).eq("id", user.id);
    if (error) toast("Save failed. Try again.", "error");
    else { updateProfile(updates); toast("Profile saved!", "success"); }
    setSaving(false);
  }

  function setAct(i, key, val) { setActivities(prev => prev.map((a, idx) => idx === i ? {...a, [key]: val} : a)); }
  function toggleActGrade(i, g) { setAct(i, "grades", activities[i].grades.includes(g) ? activities[i].grades.filter(x => x !== g) : [...activities[i].grades, g]); }
  function setAwd(i, key, val) { setAwards(prev => prev.map((a, idx) => idx === i ? {...a, [key]: val} : a)); }
  function toggleAwdGrade(i, g) { setAwd(i, "grades", awards[i].grades.includes(g) ? awards[i].grades.filter(x => x !== g) : [...awards[i].grades, g]); }
  function toggleAwdRec(i, r) { const cur = awards[i].recognition || []; setAwd(i, "recognition", cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r]); }

  function cc(text, max) {
    const len = (text || "").length;
    return <span style={{ color: len > max ? "var(--red)" : "var(--muted)", fontSize:".63rem", fontWeight:600, marginLeft:".3rem" }}>{len}/{max}</span>;
  }

  return (
    <div style={{ padding:"2rem 0", maxWidth:700, margin:"0 auto" }}>
      <div style={{ borderBottom:"2px solid var(--ink)", paddingBottom:"1.5rem", marginBottom:"2rem" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"clamp(3rem,8vw,5.5rem)", lineHeight:.9, letterSpacing:".02em" }}>YOUR<br/><span style={{ WebkitTextStroke:"2px var(--ink)", color:"transparent" }}>PROFILE</span></div>
      </div>

      {/* Identity */}
      <div className="card" style={{ marginBottom:"1.2rem" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"1.2rem", marginBottom:"1.2rem" }}>
          {/* Circular avatar with hover upload overlay */}
          <div
            style={{ position:"relative", width:68, height:68, borderRadius:"50%", border:"3px solid var(--orange)", flexShrink:0, cursor:"pointer", overflow:"hidden" }}
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            onClick={() => fileInputRef.current?.click()}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}/>
            ) : (
              <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"var(--font-display)", fontSize:"1.4rem", background:"var(--orange-lt)", color:"var(--orange)" }}>{user?.avatar}</div>
            )}
            {avatarHover && (
              <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.45)", display:"flex", alignItems:"center", justifyContent:"center", borderRadius:"50%" }}>
                {uploading ? <Spinner size={18}/> : <span style={{ fontSize:"1.2rem" }}>📷</span>}
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }}/>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:".6rem", flexWrap:"wrap" }}>
              <div style={{ fontWeight:700, fontSize:"1.1rem" }}>{user?.name}</div>
              {/* Social icons next to name */}
              {user?.social_links?.linkedin && (
                <a href={user.social_links.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize:".75rem", fontWeight:700, border:"1.5px solid var(--ink)", padding:".1rem .35rem", textDecoration:"none", color:"var(--ink)", letterSpacing:".04em" }}>in</a>
              )}
              {user?.social_links?.instagram && (
                <a href={`https://instagram.com/${user.social_links.instagram}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:".75rem", fontWeight:700, border:"1.5px solid var(--ink)", padding:".1rem .35rem", textDecoration:"none", color:"var(--ink)" }}>@</a>
              )}
              {user?.social_links?.email && (
                <a href={`mailto:${user.social_links.email}`} style={{ fontSize:".75rem", fontWeight:700, border:"1.5px solid var(--ink)", padding:".1rem .35rem", textDecoration:"none", color:"var(--ink)" }}>✉</a>
              )}
              {user?.social_links?.whatsapp && (
                <a href={`https://wa.me/${user.social_links.whatsapp}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:".75rem", fontWeight:700, border:"1.5px solid var(--ink)", padding:".1rem .35rem", textDecoration:"none", color:"var(--ink)" }}>WA</a>
              )}
            </div>
            <div style={{ fontSize:".75rem", color:"var(--muted)", marginTop:".2rem" }}>{user?.email}</div>
            <span className="tag tag-blue" style={{ fontSize:".6rem", marginTop:".3rem" }}>{user?.role}</span>
          </div>
        </div>
        <div style={{ borderTop:"1.5px solid var(--paper3)", paddingTop:"1rem" }}>
          <label>Bio</label>
          {bioEdit ? (
            <>
              <textarea rows={3} value={bio} onChange={e=>setBio(e.target.value)} maxLength={300}/>
              <div style={{ display:"flex", gap:".5rem", marginTop:".6rem" }}>
                <button className="btn btn-orange btn-sm" onClick={saveBio}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>setBioEdit(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"1rem" }}>
              <p style={{ fontSize:".85rem", fontStyle:"italic", fontFamily:"var(--font-serif)", color:"var(--muted)", lineHeight:1.6 }}>{user?.bio || "No bio yet."}</p>
              <button className="btn btn-ghost btn-sm" onClick={()=>setBioEdit(true)} style={{ flexShrink:0 }}>Edit</button>
            </div>
          )}
        </div>
        {/* Social links editing section */}
        <div style={{ borderTop:"1.5px solid var(--paper3)", paddingTop:"1rem", marginTop:"1rem" }}>
          <label style={{ marginBottom:".6rem", display:"block" }}>Social Links</label>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".55rem", marginBottom:".75rem" }}>
            <div>
              <label style={{ fontSize:".65rem", letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)", fontWeight:700 }}>LinkedIn URL</label>
              <input value={links.linkedin} onChange={e=>setLinks(p=>({...p,linkedin:e.target.value}))} placeholder="https://linkedin.com/in/…" maxLength={200}/>
            </div>
            <div>
              <label style={{ fontSize:".65rem", letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)", fontWeight:700 }}>Instagram Handle</label>
              <input value={links.instagram} onChange={e=>setLinks(p=>({...p,instagram:e.target.value}))} placeholder="@yourhandle" maxLength={60}/>
            </div>
            <div>
              <label style={{ fontSize:".65rem", letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)", fontWeight:700 }}>Email</label>
              <input value={links.email} onChange={e=>setLinks(p=>({...p,email:e.target.value}))} placeholder="you@email.com" maxLength={120}/>
            </div>
            <div>
              <label style={{ fontSize:".65rem", letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)", fontWeight:700 }}>WhatsApp Number</label>
              <input value={links.whatsapp} onChange={e=>setLinks(p=>({...p,whatsapp:e.target.value}))} placeholder="+1 555 123 4567" maxLength={20}/>
            </div>
          </div>
          <button className="btn btn-sm" onClick={saveLinks} disabled={linksSaving} style={{ width:"100%", justifyContent:"center" }}>
            {linksSaving ? <><Spinner size={12}/>Saving…</> : "Save Links →"}
          </button>
        </div>
      </div>

      {/* Academic Profile */}
      <div className="card" style={{ marginBottom:"1.2rem" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"1.1rem", letterSpacing:".04em", marginBottom:".85rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>ACADEMIC PROFILE</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".7rem" }}>
          <div>
            <label>GPA (Weighted)</label>
            <input value={acad.gpa} onChange={e=>sa("gpa",e.target.value)} placeholder="4.2" maxLength={10}/>
          </div>
          <div>
            <label>Intended Major</label>
            <input value={acad.intended_major} onChange={e=>sa("intended_major",e.target.value)} placeholder="Mechanical Engineering" maxLength={80}/>
          </div>
          <div>
            <label>SAT Score</label>
            <input value={acad.sat} onChange={e=>sa("sat",e.target.value)} placeholder="1480" maxLength={10}/>
          </div>
          <div>
            <label>ACT Score</label>
            <input value={acad.act} onChange={e=>sa("act",e.target.value)} placeholder="32" maxLength={6}/>
          </div>
        </div>
        <button className="btn btn-orange" onClick={saveAcad} disabled={acadSaving} style={{ marginTop:"1rem", width:"100%", justifyContent:"center" }}>
          {acadSaving ? <><Spinner size={14}/>Saving…</> : "Save Academic Profile →"}
        </button>
      </div>

      {/* Activities */}
      <div className="card" style={{ marginBottom:"1.2rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".85rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"1.1rem", letterSpacing:".04em" }}>
            ACTIVITIES <span style={{ fontSize:".65rem", color:"var(--muted)", fontWeight:400, fontFamily:"var(--font-body)", letterSpacing:0 }}>{activities.length}/10</span>
          </div>
          {activities.length < 10 && <button className="btn btn-sm" onClick={() => setActivities(p => [...p, blankActivity()])}>+ Add Activity</button>}
        </div>
        {activities.length === 0 && <p style={{ color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:".85rem" }}>No activities yet. Add up to 10.</p>}
        <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
          {activities.map((a, i) => (
            <div key={i} style={{ border:"1px solid var(--paper3)", padding:"1rem", background:"var(--paper2)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".75rem" }}>
                <div style={{ fontSize:".68rem", fontWeight:700, letterSpacing:".07em", textTransform:"uppercase", color:"var(--muted)" }}>Activity {i+1}</div>
                <button onClick={() => setActivities(p => p.filter((_,idx) => idx !== i))} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--red)", fontWeight:700, fontSize:".75rem", padding:".15rem .5rem", fontFamily:"var(--font-body)" }}>Delete</button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".6rem" }}>
                <div style={{ gridColumn:"1/-1" }}>
                  <label style={{ fontSize:".65rem" }}>Activity Type</label>
                  <select value={a.activity_type} onChange={e => setAct(i, "activity_type", e.target.value)}>
                    {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:".65rem" }}>Position/Leadership {cc(a.position, 50)}</label>
                  <input value={a.position} onChange={e => setAct(i, "position", e.target.value)} maxLength={50} placeholder="e.g. President"/>
                </div>
                <div>
                  <label style={{ fontSize:".65rem" }}>Organization Name {cc(a.org_name, 100)}</label>
                  <input value={a.org_name} onChange={e => setAct(i, "org_name", e.target.value)} maxLength={100} placeholder="e.g. Math Club"/>
                </div>
                <div style={{ gridColumn:"1/-1" }}>
                  <label style={{ fontSize:".65rem" }}>Description {cc(a.description, 150)}</label>
                  <textarea rows={2} value={a.description} onChange={e => setAct(i, "description", e.target.value)} maxLength={160} placeholder="Strong action verbs, quantify impact…"/>
                </div>
                <div style={{ gridColumn:"1/-1" }}>
                  <label style={{ fontSize:".65rem" }}>Grades Participated</label>
                  <div style={{ display:"flex", gap:".7rem", flexWrap:"wrap", marginTop:".35rem" }}>
                    {GRADE_OPTIONS.map(g => (
                      <label key={g} style={{ display:"flex", alignItems:"center", gap:".3rem", fontSize:".8rem", fontWeight:400, textTransform:"none", letterSpacing:0, cursor:"pointer", margin:0 }}>
                        <input type="checkbox" checked={a.grades.includes(g)} onChange={() => toggleActGrade(i, g)} style={{ width:"auto", accentColor:"var(--orange)", cursor:"pointer" }}/>{g}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize:".65rem" }}>Timing</label>
                  <select value={a.timing} onChange={e => setAct(i, "timing", e.target.value)}>
                    <option>During school year</option>
                    <option>During school break</option>
                    <option>All year</option>
                  </select>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".5rem" }}>
                  <div>
                    <label style={{ fontSize:".65rem" }}>Hrs/week</label>
                    <input type="number" value={a.hours_per_week} onChange={e => setAct(i, "hours_per_week", Number(e.target.value))} min={0} max={168}/>
                  </div>
                  <div>
                    <label style={{ fontSize:".65rem" }}>Wks/year</label>
                    <input type="number" value={a.weeks_per_year} onChange={e => setAct(i, "weeks_per_year", Number(e.target.value))} min={0} max={52}/>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Awards */}
      <div className="card" style={{ marginBottom:"1.2rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".85rem", borderBottom:"1.5px solid var(--paper3)", paddingBottom:".5rem" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"1.1rem", letterSpacing:".04em" }}>
            HONORS & AWARDS <span style={{ fontSize:".65rem", color:"var(--muted)", fontWeight:400, fontFamily:"var(--font-body)", letterSpacing:0 }}>{awards.length}/5</span>
          </div>
          {awards.length < 5 && <button className="btn btn-sm" onClick={() => setAwards(p => [...p, blankAward()])}>+ Add Award</button>}
        </div>
        {awards.length === 0 && <p style={{ color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:".85rem" }}>No awards yet. Add up to 5.</p>}
        <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
          {awards.map((a, i) => (
            <div key={i} style={{ border:"1px solid var(--paper3)", padding:"1rem", background:"var(--paper2)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".75rem" }}>
                <div style={{ fontSize:".68rem", fontWeight:700, letterSpacing:".07em", textTransform:"uppercase", color:"var(--muted)" }}>Award {i+1}</div>
                <button onClick={() => setAwards(p => p.filter((_,idx) => idx !== i))} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--red)", fontWeight:700, fontSize:".75rem", padding:".15rem .5rem", fontFamily:"var(--font-body)" }}>Delete</button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:".6rem" }}>
                <div>
                  <label style={{ fontSize:".65rem" }}>Award/Honor Title {cc(a.title, 100)}</label>
                  <input value={a.title} onChange={e => setAwd(i, "title", e.target.value)} maxLength={100} placeholder="e.g. National Merit Scholar"/>
                </div>
                <div>
                  <label style={{ fontSize:".65rem" }}>Grades</label>
                  <div style={{ display:"flex", gap:".7rem", flexWrap:"wrap", marginTop:".35rem" }}>
                    {GRADE_OPTIONS.map(g => (
                      <label key={g} style={{ display:"flex", alignItems:"center", gap:".3rem", fontSize:".8rem", fontWeight:400, textTransform:"none", letterSpacing:0, cursor:"pointer", margin:0 }}>
                        <input type="checkbox" checked={a.grades.includes(g)} onChange={() => toggleAwdGrade(i, g)} style={{ width:"auto", accentColor:"var(--orange)", cursor:"pointer" }}/>{g}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize:".65rem" }}>Recognition Level</label>
                  <div style={{ display:"flex", gap:".7rem", flexWrap:"wrap", marginTop:".35rem" }}>
                    {["School","State/Regional","National","International"].map(r => (
                      <label key={r} style={{ display:"flex", alignItems:"center", gap:".3rem", fontSize:".8rem", fontWeight:400, textTransform:"none", letterSpacing:0, cursor:"pointer", margin:0 }}>
                        <input type="checkbox" checked={(a.recognition||[]).includes(r)} onChange={() => toggleAwdRec(i, r)} style={{ width:"auto", accentColor:"var(--orange)", cursor:"pointer" }}/>{r}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button className="btn btn-orange" onClick={saveProfile} disabled={saving} style={{ width:"100%", justifyContent:"center", marginBottom:"1.4rem" }}>
        {saving ? <><Spinner size={14}/>Saving…</> : "Save Profile →"}
      </button>

      {/* Security */}
      <div className="card">
        <div style={{ fontSize:".68rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".6rem" }}>Security Status</div>
        <div style={{ fontSize:".78rem", color:"var(--muted)", lineHeight:1.8, marginBottom:"1rem" }}>
          <div>✓ Session token active (expires in 24h)</div>
          <div>✓ All inputs sanitized before use</div>
          <div>✓ API key never sent to browser</div>
          <div>✓ Rate limiting enforced — {ClientRateLimit.remaining("claude")} AI calls left this minute</div>
        </div>
        <button className="btn btn-ghost" onClick={logout} style={{ alignSelf:"flex-start" }}>Sign Out →</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DEV TOOLS
// ═══════════════════════════════════════════════════════════════════════════
function ToolsPage() {
  const [open, setOpen]     = useState(null);
  const [filter, setFilter] = useState("All");
  const cats  = ["All", ...Array.from(new Set(AI_TOOLS.map(t=>t.cat)))];
  const shown = AI_TOOLS.filter(t => filter==="All" || t.cat===filter);

  return (
    <div style={{ padding:"2rem 0" }}>
      <div style={{ borderBottom:"2px solid var(--ink)", paddingBottom:"1.5rem", marginBottom:"2rem" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"clamp(2.5rem,7vw,4.5rem)", lineHeight:.9, letterSpacing:".02em" }}>DEV TOOLS<br/><span style={{ WebkitTextStroke:"2px var(--ink)", color:"transparent" }}>GUIDE</span></div>
        <p style={{ marginTop:".8rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", fontSize:"1rem", maxWidth:580 }}>Recommended tools to wire a production backend into ExtraCrew.</p>
      </div>

      <div style={{ border:"2px solid var(--ink)", padding:"1rem 1.4rem", marginBottom:"1.5rem", background:"var(--paper2)", boxShadow:"4px 4px 0 var(--ink)", display:"flex", gap:0, overflowX:"auto", alignItems:"center" }}>
        {[{l:"Browser",s:"React",c:"var(--orange)"},{l:"→",s:"",c:"var(--muted2)"},{l:"/api/claude",s:"Vercel fn",c:"var(--blue)"},{l:"→",s:"",c:"var(--muted2)"},{l:"Anthropic",s:"API Key hidden",c:"var(--ink)"}].map((n,i)=>(
          <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:".4rem .8rem", minWidth:n.l==="→"?28:100 }}>
            <div style={{ fontFamily:n.l==="→"?"var(--font-body)":"var(--font-display)", fontSize:n.l==="→"?"1.2rem":".95rem", color:n.c, lineHeight:1, letterSpacing:".04em" }}>{n.l}</div>
            {n.s && <div style={{ fontSize:".62rem", color:"var(--muted)", marginTop:".2rem", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>{n.s}</div>}
          </div>
        ))}
      </div>

      <div style={{ border:"2px solid var(--green)", padding:"1rem 1.4rem", marginBottom:"2rem", background:"var(--green-lt)", display:"flex", gap:"1.5rem", flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"1.1rem", letterSpacing:".04em", color:"var(--green)" }}>SECURITY ACTIVE</div>
        {["API Key Hidden","Rate Limiting","Input Sanitization","XSS Prevention","CSP Headers","Session Auth","Content Policy"].map(s=>(
          <span key={s} style={{ fontSize:".65rem", fontWeight:700, color:"var(--green)" }}>✓ {s}</span>
        ))}
      </div>

      <div style={{ display:"flex", gap:".4rem", flexWrap:"wrap", marginBottom:"1.4rem" }}>
        {cats.map(c=>(
          <button key={c} onClick={()=>setFilter(c)} style={{ fontFamily:"var(--font-body)", fontWeight:700, fontSize:".67rem", letterSpacing:".06em", textTransform:"uppercase", border:"2px solid var(--ink)", background:filter===c?"var(--orange)":"transparent", color:filter===c?"#fff":"var(--ink)", padding:".28rem .7rem", cursor:"pointer", transition:"all .1s" }}>{c}</button>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))", gap:"1rem" }}>
        {shown.map(t=>(
          <div key={t.id} className={`tool-card ${open===t.id?"open":""}`} onClick={()=>setOpen(open===t.id?null:t.id)}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:".8rem", marginBottom:".8rem" }}>
              <div style={{ width:40, height:40, border:"2px solid var(--ink)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.2rem", flexShrink:0, background:"var(--paper2)" }}>{t.icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:"var(--font-body)", fontWeight:700, fontSize:".97rem" }}>{t.name}</div>
                <span className="tag" style={{ fontSize:".58rem", marginTop:".25rem" }}>{t.cat}</span>
              </div>
              <div style={{ fontSize:".7rem", fontWeight:700, color:"var(--muted)", textTransform:"uppercase" }}>{open===t.id?"▲":"▼"}</div>
            </div>
            <p style={{ fontSize:".82rem", color:"var(--muted)", lineHeight:1.6, fontStyle:"italic", fontFamily:"var(--font-serif)", marginBottom:".85rem" }}>{t.desc}</p>
            <div style={{ display:"flex", flexDirection:"column", gap:".2rem", marginBottom:".85rem" }}>
              {t.uses.map(u=><div key={u} style={{ fontSize:".72rem", display:"flex", gap:".4rem" }}><span style={{ color:"var(--orange)", fontWeight:700, flexShrink:0 }}>—</span>{u}</div>)}
            </div>
            {open===t.id && (
              <div style={{ borderTop:"2px solid var(--ink)", paddingTop:".85rem", marginTop:".3rem", animation:"fadeUp .2s ease" }} onClick={e=>e.stopPropagation()}>
                <div style={{ fontSize:".62rem", fontWeight:700, letterSpacing:".09em", textTransform:"uppercase", color:"var(--orange)", marginBottom:".5rem" }}>Integration Notes</div>
                <p style={{ fontSize:".8rem", color:"var(--muted)", lineHeight:1.65, marginBottom:".9rem", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>{t.how}</p>
                <a href={t.link} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}>
                  <button className="btn btn-ghost btn-sm">Visit {t.name} →</button>
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════════════════════════════════════════
function AppShell() {
  const { user, sessionLoading } = useAuth();
  const [page, setPage]         = useState("lobby");
  const [groups, setGroups]         = useState(null);
  const [jumpGroup, setJumpGroup]   = useState(null);
  const [lobbyFilter, setLobbyFilter] = useState("all");
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [messagesUnread, setMessagesUnread] = useState(0);

  // Load groups from Supabase + real-time subscription
  useEffect(() => {
    supabase.from("groups").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setGroups(data?.length ? data : SEED_GROUPS));

    const ch = supabase.channel("groups-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "groups" }, ({ new: g }) =>
        setGroups(prev => prev.some(x => x.id === g.id) ? prev : [g, ...prev])
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "groups" }, ({ new: g }) =>
        setGroups(prev => prev.map(x => x.id === g.id ? g : x))
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "groups" }, ({ old: g }) =>
        setGroups(prev => prev.filter(x => x.id !== g.id))
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // Presence tracking
  useEffect(() => {
    if (!user) return;
    const presenceCh = supabase.channel("online-users")
      .on("presence", { event: "sync" }, () => {
        const state = presenceCh.presenceState();
        setOnlineUsers(new Set(Object.values(state).flat().map(p => p.user_id)));
      })
      .subscribe(async status => {
        if (status === "SUBSCRIBED") await presenceCh.track({ user_id: user.id });
      });
    return () => supabase.removeChannel(presenceCh);
  }, [user?.id]);

  if (sessionLoading) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", gap:".8rem", color:"var(--muted)", fontFamily:"var(--font-display)", letterSpacing:".05em", fontSize:"1.2rem" }}><Spinner/>LOADING…</div>;
  if (!user) return <AuthScreen/>;
  if (!groups) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", gap:".8rem", color:"var(--muted)", fontFamily:"var(--font-display)", letterSpacing:".05em", fontSize:"1.2rem" }}><Spinner/>LOADING EXTRACREW…</div>;

  function goChat(gid) { setJumpGroup(gid); setPage("messages"); }

  const PAGES = [
    { id:"lobby",    label:"Lobby",     icon:"🏟" },
    { id:"advisor",  label:"Advisor",   icon:"📋" },
    { id:"mygroups", label:"My Groups", icon:"👥" },
    { id:"messages", label:"Messages",  icon:"💬" },
    { id:"friends",  label:"Friends",   icon:"🤝" },
    { id:"aichat",   label:"AI Chat",   icon:"🤖" },
    { id:"tools",    label:"Dev Tools", icon:"🛠"  },
    { id:"profile",  label:"Profile",   icon:"👤" },
  ];

  const fullPage = page === "messages";

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column" }}>
      <header style={{ borderBottom:"2px solid var(--ink)", background:"var(--paper)", position:"sticky", top:0, zIndex:50, flexShrink:0 }}>
        <div style={{ maxWidth:fullPage?"100%":1160, margin:"0 auto", padding:"0 1.4rem", height:58, display:"flex", alignItems:"center", gap:"1.4rem" }}>
          <div onClick={() => { setLobbyFilter("all"); setPage("lobby"); }} style={{ cursor:"pointer", flexShrink:0, display:"flex", alignItems:"baseline" }}>
            <span style={{ fontFamily:"var(--font-display)", fontSize:"1.35rem", letterSpacing:".05em" }}>EXTRA</span>
            <span style={{ fontFamily:"var(--font-display)", fontSize:"1.35rem", letterSpacing:".05em", color:"var(--orange)" }}>CREW</span>
          </div>
          <nav style={{ display:"flex", alignItems:"center", flex:1, overflowX:"auto", gap:".1rem" }}>
            {PAGES.map(p => (
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

      <main style={{ flex:1, overflow:fullPage?"hidden":"auto" }}>
        <OnlineCtx.Provider value={onlineUsers}>
          {page==="lobby"    && <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><LobbyPage groups={groups} setGroups={setGroups} initCat={lobbyFilter}/></div>}
          {page==="advisor"  && <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><AdvisorPage goLobby={(cats) => { setLobbyFilter(cats?.[0] || "all"); setPage("lobby"); }} goProfile={()=>setPage("profile")}/></div>}
          {page==="mygroups" && <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><MyGroupsPage groups={groups} setGroups={setGroups} goChat={goChat}/></div>}
          {page==="messages" && <ChatPage groups={groups} setGroups={setGroups} jumpGroup={jumpGroup} onUnreadChange={setMessagesUnread}/>}
          {page==="friends"  && <div style={{ maxWidth:860,  margin:"0 auto", padding:"0 1.4rem" }}><FriendsPage/></div>}
          {page==="aichat"   && <div style={{ maxWidth:860,  margin:"0 auto", padding:"0 1.4rem" }}><AIChatPage/></div>}
          {page==="tools"    && <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><ToolsPage/></div>}
          {page==="profile"  && <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><ProfilePage/></div>}
        </OnlineCtx.Provider>
      </main>

      {!fullPage && (
        <footer style={{ borderTop:"2px solid var(--ink)", padding:".7rem 1.4rem", display:"flex", justifyContent:"space-between", alignItems:"center", background:"var(--paper2)" }}>
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
        <AppShell/>
      </ToastProvider>
    </AuthProvider>
  );
}