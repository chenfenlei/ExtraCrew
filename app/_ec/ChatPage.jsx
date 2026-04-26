"use client";
// ─────────────────────────────────────────────────────────────────────────────
// app/_ec/ChatPage.jsx — Group + DM chat (lazy-loaded)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo } from "react";
import { sanitize, Validators, passesContentPolicy } from "@/lib/security";
import { MOCK_USERS } from "@/lib/data";
import {
  supabase, useAuth, useToast, useOnline,
  Avatar, Spinner, avatarColor, ftime, fileIcon, dbg,
} from "./shared";
import { useCall } from "./CallSystem";
import UserProfileModal from "./UserProfileModal";

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

        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".4rem" }}>Share Link</div>
          <img src="https://api.qrserver.com/v1/create-qr-code/?data=extracrew.vercel.app&size=150x150" alt="QR" style={{ border:"2px solid var(--ink)", padding:4, background:"#fff" }}/>
        </div>

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

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:".8rem", fontWeight:600 }}>🔔 Mute notifications</span>
          <button onClick={() => saveMuted(!muted)} style={{ background:muted?"var(--ink)":"transparent", color:muted?"var(--paper)":"var(--ink)", border:"2px solid var(--ink)", padding:".22rem .6rem", fontSize:".7rem", fontWeight:700, cursor:"pointer", fontFamily:"var(--font-body)", letterSpacing:".05em" }}>
            {muted ? "Muted" : "Mute"}
          </button>
        </div>

        <div>
          <div style={{ fontSize:".58rem", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--muted)", marginBottom:".3rem" }}>My Nickname</div>
          {nickEdit
            ? <NicknameEditor current={nickname} onSave={saveNickname} onCancel={() => setNickEdit(false)}/>
            : <div style={{ display:"flex", alignItems:"center", gap:".5rem" }}>
                <span style={{ fontSize:".82rem" }}>{nickname || "(none)"}</span>
                <button onClick={() => setNickEdit(true)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:".62rem", color:"var(--blue)", padding:0, fontFamily:"var(--font-body)" }}>Edit</button>
              </div>}
        </div>

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

        {currentGroup.byId !== userId && (
          <button className="btn btn-sm btn-danger" onClick={leaveGroup} style={{ width:"100%" }}>Leave Group</button>
        )}
      </div>
    </div>
  );
}

export default function ChatPage({ groups, setGroups, jumpGroup, onUnreadChange }) {
  const { user }   = useAuth();
  const toast      = useToast();
  const onlineUsers = useOnline();

  const [threadMsgs, setThreadMsgs]   = useState([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [previews, setPreviews]       = useState({});
  const [unreadMap, setUnreadMap]     = useState({});
  const lastReadKey = `ec:lastRead_${user.id}`;
  const [lastRead, setLastRead]       = useState(() => {
    try { return JSON.parse(localStorage.getItem(lastReadKey) || "{}"); } catch { return {}; }
  });
  const [dmThreadList, setDmThreadList] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`ec:dms_${user.id}`) || "[]"); } catch { return []; }
  });

  const [active, setActive]           = useState(null);
  const [input, setInput]             = useState("");
  const [showDM, setShowDM]           = useState(false);
  const [dmTarget, setDmTarget]       = useState("");
  const [showInfo, setShowInfo]       = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [profileUser, setProfileUser] = useState(null);

  const endRef      = useRef(null);
  const fileRef     = useRef(null);
  const activeRef   = useRef(null);
  const threadChRef = useRef(null);
  const myIdsRef    = useRef(new Set());
  const loadedPreviewsRef = useRef(new Set());
  const call = useCall();

  const mine = groups.filter(g => g.members.includes(user.id));
  const mineIds = mine.map(g => g.id);
  const dmIds   = dmThreadList.map(d => d.id);
  const threadsKey = useMemo(() => [...mineIds, ...dmIds].sort().join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mineIds.join("|"), dmIds.join("|")]);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    myIdsRef.current = new Set([...mineIds, ...dmIds]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadsKey]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [threadMsgs]);

  useEffect(() => {
    const total = Object.values(unreadMap).reduce((s, n) => s + n, 0);
    onUnreadChange?.(total);
  }, [unreadMap]);

  useEffect(() => {
    if (!jumpGroup) return;
    const g = groups.find(x => x.id === jumpGroup);
    if (g && g.members.includes(user.id)) openThread({ id: jumpGroup, type:"group", name:g.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpGroup, groups]);

  useEffect(() => {
    const ids = [...mineIds, ...dmIds];
    dbg("chat:threads-key", ids.length);
    ids.forEach(id => {
      if (loadedPreviewsRef.current.has(id)) return;
      loadedPreviewsRef.current.add(id);

      supabase.from("messages").select("text, media, created_at").eq("thread_id", id)
        .order("created_at", { ascending: false }).limit(1)
        .then(({ data }) => {
          if (data?.[0]) {
            const m = data[0];
            setPreviews(p => p[id] ? p : ({ ...p, [id]: { text: m.text || "📎 Media", ts: new Date(m.created_at).getTime() } }));
          }
        });

      const since = lastRead[id] || "1970-01-01T00:00:00Z";
      supabase.from("messages").select("id", { count:"exact", head:true })
        .eq("thread_id", id).gt("created_at", since).neq("sender_id", user.id)
        .then(({ count }) => { if (count) setUnreadMap(p => ({ ...p, [id]: (p[id] || 0) + count })); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadsKey]);

  useEffect(() => {
    const globalCh = supabase.channel("msgs-global-" + user.id)
      .on("postgres_changes", { event:"INSERT", schema:"public", table:"messages" }, async ({ new: msg }) => {
        const tid = msg.thread_id;
        if (!tid) return;

        setPreviews(p => ({ ...p, [tid]: { text: msg.text || "📎 Media", ts: new Date(msg.created_at).getTime() } }));
        if (msg.sender_id === user.id) return;

        const tracked = myIdsRef.current.has(tid);

        if (!tracked && tid.startsWith("dm_")) {
          const [, a, b] = tid.split("_");
          if (a === user.id || b === user.id) {
            const otherId = a === user.id ? b : a;
            const { data: other } = await supabase
              .from("users").select("name").eq("id", otherId).maybeSingle();
            const name = other?.name || msg.sender_name || "Unknown";
            setDmThreadList(prev => {
              if (prev.some(d => d.id === tid)) return prev;
              const next = [...prev, { id: tid, name, otherId }];
              try { localStorage.setItem(`ec:dms_${user.id}`, JSON.stringify(next)); } catch {}
              return next;
            });
          } else {
            return;
          }
        } else if (!tracked) {
          return;
        }

        if (tid !== activeRef.current?.id) {
          setUnreadMap(p => ({ ...p, [tid]: (p[tid] || 0) + 1 }));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(globalCh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active) return;
    dbg("chat:active-thread", active.id);
    if (threadChRef.current) { supabase.removeChannel(threadChRef.current); threadChRef.current = null; }

    setMsgsLoading(true);
    supabase.from("messages").select("*").eq("thread_id", active.id).order("created_at")
      .then(({ data }) => {
        setThreadMsgs((data || []).map(normalizeMsg));
        setMsgsLoading(false);
        dbg("chat:messages-loaded", data?.length ?? 0);
      });

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
      try { localStorage.setItem(lastReadKey, JSON.stringify(next)); } catch {}
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
    openThread({ id:k, type:"dm", name:target?.name||"?", otherId: dmTarget });
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

      <div className="chat-main" style={{ position:"relative" }}>
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
              <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:".35rem", flexWrap:"wrap" }}>
                {activeGroup && activeGroup.tags.slice(0,2).map(t=><span key={t} className="tag" style={{fontSize:".58rem"}}>{t}</span>)}
                {active.type === "dm" ? (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => call.start(active.otherId, active.name, "video")} title="Video call" disabled={call.state.status !== "idle"}>📹</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => call.start(active.otherId, active.name, "audio")} title="Voice call" disabled={call.state.status !== "idle"}>📞</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-ghost btn-sm" title="Group video call — coming soon" disabled style={{ opacity:.45 }}>📹</button>
                    <button className="btn btn-ghost btn-sm" title="Group voice call — coming soon" disabled style={{ opacity:.45 }}>📞</button>
                  </>
                )}
                {activeGroup && <button className="btn btn-ghost btn-sm" onClick={() => setShowInfo(v=>!v)} title="Group info">⋯</button>}
              </div>
            </div>

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
      {profileUser && <UserProfileModal userId={profileUser.id} onClose={() => setProfileUser(null)}/>}
    </div>
  );
}
