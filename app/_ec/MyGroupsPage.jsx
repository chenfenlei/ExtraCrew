"use client";

import { useState } from "react";
import { CATS } from "@/lib/data";
import { supabase, useAuth, useToast, MemberBar, ago, CAT_BG, CAT_ACCENT, CAT_SHADOW } from "./shared";

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

export default function MyGroupsPage({ groups, setGroups, goChat }) {
  const { user } = useAuth();
  const toast    = useToast();
  const [appsModal, setAppsModal] = useState(null);
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
