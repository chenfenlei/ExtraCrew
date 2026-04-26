"use client";

import { useState, useRef } from "react";
import { sanitize, Validators } from "@/lib/security";
import {
  supabase, useAuth, useToast, Spinner,
  ACTIVITY_TYPES, GRADE_OPTIONS,
} from "./shared";

export default function ProfilePage() {
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
    const gpa = sanitize(acad.gpa, 10);
    const sat = sanitize(acad.sat, 10);
    const act = sanitize(acad.act, 6);
    const intended_major = sanitize(acad.intended_major, 80);
    const { error } = await supabase
      .from("users")
      .upsert({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
        bio: user.bio || "",
        gpa, sat, act,
        intended_major,
        activities: cleanActs,
        awards,
      }, { onConflict: "id" });
    if (error) {
      toast(error.message, "error");
      setSaving(false);
      return;
    }
    toast("Profile saved!", "success");
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

      <div className="card" style={{ marginBottom:"1.2rem" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"1.2rem", marginBottom:"1.2rem" }}>
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

      <div className="card" style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:".72rem", color:"var(--muted)" }}>Signed in as <strong style={{ color:"var(--ink)" }}>{user.email}</strong></div>
        <button className="btn btn-ghost" onClick={logout}>Sign Out →</button>
      </div>
    </div>
  );
}
