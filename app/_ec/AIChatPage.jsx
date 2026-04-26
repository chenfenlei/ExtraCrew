"use client";

import { useState, useEffect, useRef } from "react";
import { sanitize, passesContentPolicy, ClientRateLimit } from "@/lib/security";
import { callClaude } from "@/lib/api";
import { useToast, Spinner } from "./shared";

export default function AIChatPage() {
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
