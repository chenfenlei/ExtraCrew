"use client";
// ─────────────────────────────────────────────────────────────────────────────
// app/_ec/UserProfileModal.jsx — Clickable public profile modal
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { supabase, Spinner, initials } from "./shared";

export default function UserProfileModal({ userId, u: initialU, onClose }) {
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

  const showStats = u.stats_public !== false;
  const sl = u.social_links || {};

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:500, maxHeight:"85vh", overflowY:"auto" }}>
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
