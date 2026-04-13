"use client";

import { useState, useEffect, useRef, createContext, useContext } from "react";
import { sanitize, Validators, passesContentPolicy, ClientRateLimit } from "@/lib/security";
import { callClaude } from "@/lib/api";
import { CATS, CAT_TAG, SEED_GROUPS, SEED_MESSAGES, MOCK_USERS, AI_TOOLS } from "@/lib/data";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE HELPERS  (swap .set/.get calls for Supabase client in production)
// ═══════════════════════════════════════════════════════════════════════════
const DB = {
  load: async (key, fallback) => {
    try {
      const raw = localStorage.getItem("ec:" + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  save: async (key, val) => {
    try { localStorage.setItem("ec:" + key, JSON.stringify(val)); } catch {}
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// AUTH CONTEXT
// ═══════════════════════════════════════════════════════════════════════════
const AuthCtx = createContext(null);
const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from("users")
          .select("*")
          .eq("id", session.user.id)
          .single();
        if (profile) setUser({ ...profile, password: undefined });
      }
      setSessionLoading(false);
    });
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

  return (
    <AuthCtx.Provider value={{ user, login, logout, register, sessionLoading }}>
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
// LOBBY
// ═══════════════════════════════════════════════════════════════════════════
const CAT_BG      = { blue:"var(--blue-lt)",   red:"var(--red-lt)",   green:"var(--green-lt)",   orange:"var(--orange-lt)"   };
const CAT_ACCENT  = { blue:"var(--blue)",      red:"var(--red)",      green:"var(--green)",      orange:"var(--orange)"      };
const CAT_SHADOW  = { blue:"#1a3a6b55",        red:"#c0392b55",       green:"#1a6b3c55",         orange:"#e8500a55"          };

function GroupCard({ g, onJoin, userId }) {
  const cat   = CATS.find(c => c.id === g.category);
  const isIn  = g.members.includes(userId);
  const full  = g.members.length >= g.max;
  const cardBg     = CAT_BG[cat?.color]     || "var(--chalk)";
  const cardAccent = CAT_ACCENT[cat?.color] || "var(--ink)";
  const cardShadow = CAT_SHADOW[cat?.color] || "rgba(15,14,13,.35)";
  return (
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
      </div>
      <div style={{ borderTop:"1.5px solid var(--paper3)", paddingTop:".85rem" }}>
        <MemberBar count={g.members.length} max={g.max}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:".7rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:".4rem" }}>
            <span style={{ fontSize:".65rem", color:"var(--muted2)", textTransform:"uppercase", letterSpacing:".05em", fontWeight:600 }}>{ago(g.ts)}</span>
            <span style={{ fontSize:".6rem", color:"var(--muted2)" }}>· {g.byName}</span>
          </div>
          {isIn  ? <span className="tag tag-green">✓ Joined</span>
          : full  ? <span style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:".05em" }}>Full</span>
          : <button className="btn btn-sm" onClick={() => onJoin(g.id)}>Join →</button>}
        </div>
      </div>
    </div>
  );
}

function CreateModal({ onClose, onCreate, userId, userName }) {
  const [f, setF]           = useState({ name:"", category:"", sub:"", location:"", remote:false, desc:"", tags:"", max:8 });
  const [errors, setErrors] = useState({});
  const s = (k, v) => { setF(p=>({...p,[k]:v})); setErrors(p=>({...p,[k]:""})); };

  function validate() {
    const e = {};
    if (!Validators.required(f.name))           e.name     = "Group name is required.";
    if (!Validators.maxLen(f.name, 80))          e.name     = "Name too long (max 80 chars).";
    if (!Validators.noScript(f.name))            e.name     = "Invalid characters.";
    if (!f.category)                             e.category = "Select a category.";
    if (!Validators.minLen(f.desc, 20))          e.desc     = "Describe your group in at least 20 characters.";
    if (!Validators.noScript(f.desc))            e.desc     = "Invalid characters.";
    return e;
  }

  function submit() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    onCreate({
      id: "g" + Date.now(),
      name:     sanitize(f.name, 80),
      category: f.category,
      sub:      sanitize(f.sub, 60) || f.category,
      location: f.remote ? "Remote" : sanitize(f.location, 60) || "Remote",
      remote:   f.remote,
      members:  [userId],
      max:      Math.min(50, Math.max(2, Number(f.max) || 8)),
      desc:     sanitize(f.desc, 500),
      tags:     f.tags.split(",").map(t => sanitize(t.trim(), 30)).filter(Boolean).slice(0, 8),
      byId:     userId,
      byName:   userName,
      ts:       Date.now(),
    });
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
          <div><label>Max Members</label><input type="number" min={2} max={50} value={f.max} onChange={e=>s("max",e.target.value)}/></div>
        </div>
        <div style={{ display:"flex", gap:".6rem", marginTop:"1.4rem", justifyContent:"flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-orange" onClick={submit}>Create Group</button>
        </div>
      </div>
    </div>
  );
}

function LobbyPage({ groups, setGroups }) {
  const { user } = useAuth();
  const toast    = useToast();
  const [q, setQ]         = useState("");
  const [cat, setCat]     = useState("all");
  const [fmt, setFmt]     = useState("all");
  const [modal, setModal] = useState(false);

  function join(id) {
    const g = groups.find(x => x.id === id);
    if (!g || g.members.includes(user.id)) return;
    if (g.members.length >= g.max) { toast("This group is full.", "warning"); return; }
    setGroups(gs => gs.map(g => g.id===id ? {...g, members:[...g.members, user.id]} : g));
    toast(`Joined "${g.name}"!`, "success");
  }

  const filtered = groups.filter(g => {
    if (cat !== "all" && g.category !== cat) return false;
    if (fmt === "remote" && !g.remote) return false;
    if (fmt === "local"  &&  g.remote) return false;
    if (q && ![g.name, g.desc, ...g.tags].some(x => x.toLowerCase().includes(q.toLowerCase()))) return false;
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
          {filtered.map(g => <GroupCard key={g.id} g={g} onJoin={join} userId={user.id}/>)}
        </div>
      )}
      {modal && <CreateModal onClose={() => setModal(false)} userId={user.id} userName={user.name} onCreate={g => { setGroups(p=>[g,...p]); setModal(false); toast("Group created!", "success"); }}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADVISOR
// ═══════════════════════════════════════════════════════════════════════════
function AdvisorPage({ goLobby }) {
  const toast = useToast();
  const [f, setF]           = useState({ gpa:"", sat:"", act:"", major:"", interests:"", activities:"" });
  const [loading, setLoading] = useState(false);
  const [res, setRes]       = useState(null);
  const set = (k, v) => setF(p => ({...p,[k]:v}));
  const remaining = ClientRateLimit.remaining("claude");

  async function analyze() {
    if (!f.major) { toast("Please enter your intended major.", "warning"); return; }
    if (!passesContentPolicy(f.interests + f.activities)) { toast("Content not allowed.", "error"); return; }
    if (remaining <= 0) { toast("AI request limit reached. Try again in a minute.", "error"); return; }
    setLoading(true); setRes(null);
    try {
      const sys = `You are an expert college admissions counselor. Return ONLY valid JSON (no markdown, no backticks) with this exact shape:
{"summary":"string","schools":[{"name":"","tier":"Reach|Match|Safety","reason":""}],"strengths":[""],"gaps":[""],"activities":[{"name":"","why":"","category":"stem|premed|biz|arts|social|law|env|sports"}]}
Rules: 5-7 schools, 4-6 activities, be specific and realistic.`;
      const raw  = await callClaude(sys,
        `GPA:${sanitize(f.gpa)||"N/A"} SAT:${sanitize(f.sat)||"N/A"} ACT:${sanitize(f.act)||"N/A"} Major:${sanitize(f.major)} Interests:${sanitize(f.interests)||"N/A"} Activities:${sanitize(f.activities)||"None"}`,
        [], { maxTokens: 1200 }
      );
      const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
      if (!parsed.schools || !parsed.activities) throw new Error("bad shape");
      setRes(parsed);
    } catch(e) {
      if (e.message === "RATE_LIMITED") toast("Rate limit reached. Wait 1 minute.", "error");
      else { setRes({error:true}); toast("Analysis failed. Try again.", "error"); }
    }
    setLoading(false);
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
            <div><label>Interests & Hobbies</label><input value={f.interests}  onChange={e=>set("interests",e.target.value)}  placeholder="robotics, writing…" maxLength={200}/></div>
            <div><label>Current Activities</label> <textarea rows={2} value={f.activities} onChange={e=>set("activities",e.target.value)} placeholder="school band, JV soccer…" maxLength={400}/></div>
            <button className="btn btn-orange" onClick={analyze} disabled={loading||!f.major} style={{ marginTop:".4rem", width:"100%", justifyContent:"center" }}>
              {loading ? <><Spinner size={14}/>Analyzing…</> : "Analyze My Profile →"}
            </button>
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:"1.1rem" }}>
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
                <button className="btn btn-orange" style={{ width:"100%", justifyContent:"center" }} onClick={goLobby}>Find Groups in Lobby →</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MY GROUPS
// ═══════════════════════════════════════════════════════════════════════════
function MyGroupsPage({ groups, setGroups, goChat }) {
  const { user } = useAuth();
  const toast    = useToast();
  const mine     = groups.filter(g => g.members.includes(user.id));

  function leave(id) {
    const g = groups.find(x => x.id === id);
    if (g?.byId === user.id) { toast("You own this group — delete it instead.", "warning"); return; }
    setGroups(gs => gs.map(g => g.id===id ? {...g, members:g.members.filter(m=>m!==user.id)} : g));
    toast("Left the group.", "success");
  }
  function deleteGroup(id) {
    setGroups(gs => gs.filter(g => g.id !== id));
    toast("Group deleted.", "success");
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
            return (
            <div key={g.id} className="card fade-up" style={{ display:"flex", flexDirection:"column", gap:".8rem", background: mcBg, borderColor: mcAccent, boxShadow: `4px 4px 0 ${mcShadow}` }}>
              <div>
                <div style={{ fontSize:".63rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".25rem" }}>{mcat?.icon} {g.sub}</div>
                <div style={{ fontFamily:"var(--font-body)", fontWeight:700, fontSize:".97rem", lineHeight:1.25 }}>{g.name}</div>
              </div>
              <p style={{ fontSize:".83rem", color:"var(--muted)", lineHeight:1.55, fontStyle:"italic", fontFamily:"var(--font-serif)", flex:1 }}>{g.desc}</p>
              <MemberBar count={g.members.length} max={g.max}/>
              <div style={{ borderTop:"1.5px solid var(--paper3)", paddingTop:".75rem", display:"flex", justifyContent:"space-between", alignItems:"center", gap:".5rem", flexWrap:"wrap" }}>
                {g.byId === user.id ? <span className="tag tag-orange">👑 Owner</span> : <span className="tag tag-blue">Member</span>}
                <div style={{ display:"flex", gap:".4rem" }}>
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT
// ═══════════════════════════════════════════════════════════════════════════
function ChatPage({ groups, jumpGroup }) {
  const { user } = useAuth();
  const toast    = useToast();
  const [msgs, setMsgs]       = useState(null);
  const [active, setActive]   = useState(null);
  const [input, setInput]     = useState("");
  const [showDM, setShowDM]   = useState(false);
  const [dmTarget, setDmTarget] = useState("");
  const endRef = useRef(null);

  useEffect(() => { DB.load("msgs", null).then(d => setMsgs(d || SEED_MESSAGES)); }, []);
  useEffect(() => { if (msgs) DB.save("msgs", msgs); }, [msgs]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, active]);
  useEffect(() => {
    if (jumpGroup && msgs !== null) {
      const g = groups.find(x => x.id === jumpGroup);
      if (g) setActive({ id: jumpGroup, type:"group", name:g.name });
    }
  }, [jumpGroup, msgs]);

  const mine     = groups.filter(g => g.members.includes(user.id));
  const dmKeys   = msgs ? Object.keys(msgs).filter(k => k.startsWith("dm_") && k.includes(user.id)) : [];

  const groupThreads = mine.map(g => {
    const m = msgs?.[g.id] || [];
    const last = m[m.length-1];
    return { id:g.id, type:"group", name:g.name, preview:last?.text?.slice(0,38)||"No messages", ts:last?.ts||g.ts };
  });
  const dmThreads = dmKeys.map(k => {
    const otherId = k.replace("dm_","").split("_").find(p => p !== user.id);
    const otherUser = MOCK_USERS.find(u => u.id === otherId);
    const m = msgs?.[k] || [];
    const last = m[m.length-1];
    return { id:k, type:"dm", name:otherUser?.name||"?", preview:last?.text?.slice(0,38)||"", ts:last?.ts||0 };
  });

  function dmKey(aId, bId) { return "dm_" + [aId,bId].sort().join("_"); }
  function canSend(t) {
    if (!t) return false;
    if (t.type === "group") return groups.find(g=>g.id===t.id)?.members.includes(user.id);
    return true;
  }

  function send() {
    if (!input.trim() || !active) return;
    if (!canSend(active)) { toast("Join this group to send messages.", "warning"); return; }
    const text = sanitize(input.trim(), 2000);
    if (!text || !passesContentPolicy(text)) return;
    const msg = { id:"m"+Date.now(), senderId:user.id, senderName:user.name, text, ts:Date.now() };
    setMsgs(p => ({ ...p, [active.id]: [...(p[active.id]||[]), msg] }));
    setInput("");
  }

  function startDM() {
    if (!dmTarget) return;
    const k = dmKey(user.id, dmTarget);
    setMsgs(p => ({ ...p, [k]: p[k] || [] }));
    const target = MOCK_USERS.find(u => u.id === dmTarget);
    setActive({ id:k, type:"dm", name:target?.name||"?" });
    setShowDM(false); setDmTarget("");
  }

  const threadMsgs  = active && msgs ? (msgs[active.id]||[]) : [];
  const activeGroup = active?.type==="group" ? mine.find(g=>g.id===active.id) : null;

  if (!msgs) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"calc(100vh - 58px)", gap:".8rem", color:"var(--muted)" }}><Spinner/>Loading…</div>;

  return (
    <div className="chat-layout">
      <div className="chat-sidebar">
        <div style={{ padding:".85rem 1rem", borderBottom:"2px solid var(--ink)", display:"flex", alignItems:"center", justifyContent:"space-between", background:"var(--paper3)" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"1.1rem", letterSpacing:".04em" }}>MESSAGES</div>
          <button className="btn btn-sm btn-orange" onClick={() => setShowDM(true)}>+ DM</button>
        </div>
        {groupThreads.length > 0 && <>
          <div style={{ padding:".5rem 1rem .25rem", fontSize:".6rem", fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", color:"var(--muted)", background:"var(--paper2)", borderBottom:"1px solid var(--paper3)" }}>Groups</div>
          {groupThreads.map(t => (
            <div key={t.id} className={`chat-thread ${active?.id===t.id?"active":""}`} onClick={() => setActive(t)}>
              <Avatar name={t.name[0]} size={32}/>
              <div style={{ flex:1, overflow:"hidden" }}>
                <div className="thread-name">{t.name}</div>
                <div className="thread-preview">{t.preview}</div>
              </div>
              <span className="tag" style={{ fontSize:".55rem", flexShrink:0 }}>Group</span>
            </div>
          ))}
        </>}
        <div style={{ padding:".5rem 1rem .25rem", fontSize:".6rem", fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", color:"var(--muted)", background:"var(--paper2)", borderBottom:"1px solid var(--paper3)" }}>Direct Messages</div>
        {dmThreads.length === 0 && <div style={{ padding:".8rem 1rem", fontSize:".78rem", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)" }}>No DMs yet — hit + DM to start one.</div>}
        {dmThreads.map(t => (
          <div key={t.id} className={`chat-thread ${active?.id===t.id?"active":""}`} onClick={() => setActive(t)}>
            <Avatar name={t.name} size={32}/>
            <div style={{ flex:1, overflow:"hidden" }}>
              <div className="thread-name">{t.name}</div>
              <div className="thread-preview">{t.preview}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="chat-main">
        {!active ? (
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"1rem" }}>
            <div style={{ fontFamily:"var(--font-display)", fontSize:"2.5rem", letterSpacing:".05em", color:"var(--paper3)" }}>SELECT A CHAT</div>
            <div style={{ fontStyle:"italic", fontFamily:"var(--font-serif)", color:"var(--muted2)" }}>Choose a group or DM from the sidebar.</div>
          </div>
        ) : (
          <>
            <div style={{ padding:".8rem 1.2rem", borderBottom:"2px solid var(--ink)", display:"flex", alignItems:"center", gap:".8rem", background:"var(--paper2)" }}>
              <Avatar name={active.name} size={32}/>
              <div>
                <div style={{ fontFamily:"var(--font-body)", fontWeight:700, fontSize:".95rem" }}>{active.name}</div>
                {activeGroup && <div style={{ fontSize:".7rem", color:"var(--muted)", fontStyle:"italic" }}>{activeGroup.members.length} members · {activeGroup.sub}</div>}
                {active.type==="dm" && <div style={{ fontSize:".68rem", color:"var(--green)", fontWeight:700, letterSpacing:".05em", textTransform:"uppercase" }}>● Direct Message</div>}
              </div>
              {activeGroup && <div style={{ marginLeft:"auto", display:"flex", gap:".35rem", flexWrap:"wrap" }}>{activeGroup.tags.slice(0,2).map(t=><span key={t} className="tag" style={{fontSize:".58rem"}}>{t}</span>)}</div>}
            </div>
            <div className="chat-messages">
              {threadMsgs.length===0 && <div style={{ textAlign:"center", color:"var(--muted)", fontStyle:"italic", fontFamily:"var(--font-serif)", margin:"2rem 0" }}>No messages yet — say something! 👋</div>}
              {threadMsgs.map((m, i) => {
                const self = m.senderId === user.id;
                const showSender = !self && (i===0 || threadMsgs[i-1]?.senderId !== m.senderId);
                return (
                  <div key={m.id} style={{ display:"flex", flexDirection:"column", alignItems:self?"flex-end":"flex-start", gap:".12rem", animation:"msgIn .2s ease" }}>
                    {showSender && <div style={{ fontSize:".63rem", fontWeight:700, color:avatarColor(m.senderName), marginLeft:"2.6rem", letterSpacing:".04em" }}>{m.senderName}</div>}
                    <div style={{ display:"flex", alignItems:"flex-end", gap:".45rem", flexDirection:self?"row-reverse":"row" }}>
                      {!self && (i===0 || threadMsgs[i-1]?.senderId!==m.senderId) ? <Avatar name={m.senderName} size={24}/> : <div style={{ width:24 }}/>}
                      <div className={`msg-bubble ${self?"msg-self":"msg-other"}`}>
                        {m.text}
                        <div style={{ fontSize:".6rem", opacity:.55, marginTop:".2rem", textAlign:self?"right":"left" }}>{ftime(m.ts)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef}/>
            </div>
            <div className="chat-input-row">
              {canSend(active) ? (
                <>
                  <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}}} placeholder={`Message ${active.name}…`} rows={1} style={{ resize:"none", maxHeight:110, overflowY:"auto", flex:1 }} maxLength={2000}/>
                  <button className="btn" onClick={send} disabled={!input.trim()}>Send</button>
                </>
              ) : (
                <div style={{ flex:1, fontSize:".78rem", color:"var(--muted)", fontStyle:"italic", padding:".4rem 0" }}>Join this group to send messages.</div>
              )}
            </div>
          </>
        )}
      </div>

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
  const { user, logout } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [bio, setBio]         = useState(user?.bio || "");

  function saveBio() {
    const clean = sanitize(bio, 300);
    if (!Validators.maxLen(clean, 300)) { toast("Bio too long (max 300 chars).", "warning"); return; }
    user.bio = clean;
    setEditing(false);
    toast("Profile updated!", "success");
  }

  return (
    <div style={{ padding:"2rem 0", maxWidth:560, margin:"0 auto" }}>
      <div style={{ borderBottom:"2px solid var(--ink)", paddingBottom:"1.5rem", marginBottom:"2rem" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"clamp(3rem,8vw,5.5rem)", lineHeight:.9, letterSpacing:".02em" }}>YOUR<br/><span style={{ WebkitTextStroke:"2px var(--ink)", color:"transparent" }}>PROFILE</span></div>
      </div>
      <div className="card" style={{ display:"flex", flexDirection:"column", gap:"1.2rem" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"1.2rem" }}>
          <div style={{ width:60, height:60, border:"3px solid var(--orange)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"var(--font-display)", fontSize:"1.4rem", background:"var(--orange-lt)", color:"var(--orange)" }}>{user?.avatar}</div>
          <div>
            <div style={{ fontWeight:700, fontSize:"1.1rem" }}>{user?.name}</div>
            <div style={{ fontSize:".75rem", color:"var(--muted)", marginTop:".2rem" }}>{user?.email}</div>
            <span className="tag tag-blue" style={{ fontSize:".6rem", marginTop:".3rem" }}>{user?.role}</span>
          </div>
        </div>
        <div style={{ borderTop:"1.5px solid var(--paper3)", paddingTop:"1rem" }}>
          <label>Bio</label>
          {editing ? (
            <>
              <textarea rows={3} value={bio} onChange={e=>setBio(e.target.value)} maxLength={300}/>
              <div style={{ display:"flex", gap:".5rem", marginTop:".6rem" }}>
                <button className="btn btn-orange btn-sm" onClick={saveBio}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"1rem" }}>
              <p style={{ fontSize:".85rem", fontStyle:"italic", fontFamily:"var(--font-serif)", color:"var(--muted)", lineHeight:1.6 }}>{user?.bio || "No bio yet."}</p>
              <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)} style={{ flexShrink:0 }}>Edit</button>
            </div>
          )}
        </div>
        <div style={{ borderTop:"1.5px solid var(--paper3)", paddingTop:"1rem" }}>
          <div style={{ fontSize:".68rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".6rem" }}>Security Status</div>
          <div style={{ fontSize:".78rem", color:"var(--muted)", lineHeight:1.8 }}>
            <div>✓ Session token active (expires in 24h)</div>
            <div>✓ All inputs sanitized before use</div>
            <div>✓ API key never sent to browser</div>
            <div>✓ Rate limiting enforced — {ClientRateLimit.remaining("claude")} AI calls left this minute</div>
          </div>
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
  const [groups, setGroups]     = useState(null);
  const [jumpGroup, setJumpGroup] = useState(null);

  useEffect(() => { DB.load("groups", null).then(d => setGroups(d || SEED_GROUPS)); }, []);
  useEffect(() => { if (groups) DB.save("groups", groups); }, [groups]);

  if (sessionLoading) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", gap:".8rem", color:"var(--muted)", fontFamily:"var(--font-display)", letterSpacing:".05em", fontSize:"1.2rem" }}><Spinner/>LOADING…</div>;
  if (!user) return <AuthScreen/>;
  if (!groups) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", gap:".8rem", color:"var(--muted)", fontFamily:"var(--font-display)", letterSpacing:".05em", fontSize:"1.2rem" }}><Spinner/>LOADING EXTRACREW…</div>;

  function goChat(gid) { setJumpGroup(gid); setPage("messages"); }

  const PAGES = [
    { id:"lobby",    label:"Lobby",     icon:"🏟" },
    { id:"advisor",  label:"Advisor",   icon:"📋" },
    { id:"mygroups", label:"My Groups", icon:"👥" },
    { id:"messages", label:"Messages",  icon:"💬" },
    { id:"aichat",   label:"AI Chat",   icon:"🤖" },
    { id:"tools",    label:"Dev Tools", icon:"🛠"  },
    { id:"profile",  label:"Profile",   icon:"👤" },
  ];

  const fullPage = page === "messages";

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column" }}>
      <header style={{ borderBottom:"2px solid var(--ink)", background:"var(--paper)", position:"sticky", top:0, zIndex:50, flexShrink:0 }}>
        <div style={{ maxWidth:fullPage?"100%":1160, margin:"0 auto", padding:"0 1.4rem", height:58, display:"flex", alignItems:"center", gap:"1.4rem" }}>
          <div onClick={() => setPage("lobby")} style={{ cursor:"pointer", flexShrink:0, display:"flex", alignItems:"baseline" }}>
            <span style={{ fontFamily:"var(--font-display)", fontSize:"1.35rem", letterSpacing:".05em" }}>EXTRA</span>
            <span style={{ fontFamily:"var(--font-display)", fontSize:"1.35rem", letterSpacing:".05em", color:"var(--orange)" }}>CREW</span>
          </div>
          <nav style={{ display:"flex", alignItems:"center", flex:1, overflowX:"auto", gap:".1rem" }}>
            {PAGES.map(p => (
              <button key={p.id} className={`nav-link ${page===p.id?"active":""}`} onClick={() => setPage(p.id)}>
                {p.icon} {p.label}
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
        {page==="lobby"    && <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><LobbyPage groups={groups} setGroups={setGroups}/></div>}
        {page==="advisor"  && <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><AdvisorPage goLobby={()=>setPage("lobby")}/></div>}
        {page==="mygroups" && <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><MyGroupsPage groups={groups} setGroups={setGroups} goChat={goChat}/></div>}
        {page==="messages" && <ChatPage groups={groups} jumpGroup={jumpGroup}/>}
        {page==="aichat"   && <div style={{ maxWidth:860,  margin:"0 auto", padding:"0 1.4rem" }}><AIChatPage/></div>}
        {page==="tools"    && <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><ToolsPage/></div>}
        {page==="profile"  && <div style={{ maxWidth:1160, margin:"0 auto", padding:"0 1.4rem" }}><ProfilePage/></div>}
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