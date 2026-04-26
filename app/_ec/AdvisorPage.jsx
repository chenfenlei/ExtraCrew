"use client";

import { useState, useEffect } from "react";
import { sanitize, passesContentPolicy, ClientRateLimit } from "@/lib/security";
import { callClaude } from "@/lib/api";
import { useAuth, useToast, Spinner } from "./shared";

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

export default function AdvisorPage({ goLobby, goProfile }) {
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
  }, []);

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
