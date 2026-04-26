"use client";

import { useState, useEffect } from "react";
import { Validators } from "@/lib/security";
import { supabase, useAuth, useToast, Spinner, Avatar, initials } from "./shared";
import UserProfileModal from "./UserProfileModal";

export default function FriendsPage() {
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
