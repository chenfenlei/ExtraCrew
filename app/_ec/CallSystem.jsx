"use client";
// ─────────────────────────────────────────────────────────────────────────────
// app/_ec/CallSystem.jsx — 1:1 voice/video calling
// ─────────────────────────────────────────────────────────────────────────────
//
// Signaling layout:
//   ring:{userId}               ephemeral broadcast, one-shot — used to alert
//                                a user to an incoming call and to deliver
//                                "decline" back to the caller.
//   call-pair:{a}:{b} (sorted)  persistent per-call broadcast — carries the
//                                SDP offer/answer, ICE candidates, and hangup.
//
// Flow:
//   caller: subscribe pair → getUserMedia → build PC → ring callee → wait for
//           "ready" on pair → send offer → receive answer → ICE trickle.
//   callee: receive ring   → show incoming UI → on accept: subscribe pair,
//           getUserMedia, build PC, emit "ready" → receive offer → answer →
//           ICE trickle.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, createContext, useContext, useCallback } from "react";
import { supabase, useAuth, useToast } from "./shared";

export const CallCtx = createContext(null);
export const useCall = () => useContext(CallCtx);

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
const CHANNEL_SUBSCRIBE_TIMEOUT_MS = 5000;
const CALL_ANSWER_TIMEOUT_MS = 30000;

export const pairName = (a, b) => "call-pair:" + [a, b].sort().join(":");

export function CallProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();

  const [state, _setState] = useState({
    status: "idle", // idle | calling | ringing | connecting | in_call
    type: null,
    isCaller: false,
    peerId: null,
    peerName: null,
    muted: false,
    cameraOff: false,
  });
  const stateRef = useRef(state);
  const setState = useCallback((u) => {
    _setState(p => {
      const next = typeof u === "function" ? u(p) : { ...p, ...u };
      stateRef.current = next;
      return next;
    });
  }, []);

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const pcRef         = useRef(null);
  const pairChRef     = useRef(null);
  const pendingIceRef = useRef([]);
  const offerSentRef  = useRef(false);
  const callTimeoutRef = useRef(null);

  function clearCallTimeout() {
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }

  function waitForSubscribed(ch, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} subscribe timed out`)), CHANNEL_SUBSCRIBE_TIMEOUT_MS);
      ch.subscribe(status => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          clearTimeout(timer);
          reject(new Error(`${label} subscribe failed: ${status}`));
        }
      });
    });
  }

  async function sendToRing(toUserId, event, payload = {}) {
    const ch = supabase.channel(`ring:${toUserId}`);
    try {
      await waitForSubscribed(ch, "ring");
      await ch.send({ type: "broadcast", event, payload: { ...payload, from: user.id, fromName: user.name } });
    } finally {
      supabase.removeChannel(ch);
    }
  }

  async function sendOnPair(event, payload = {}) {
    const ch = pairChRef.current;
    if (!ch) return;
    await ch.send({ type: "broadcast", event, payload: { ...payload, from: user.id } });
  }

  function cleanup() {
    clearCallTimeout();
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    if (pairChRef.current) { try { supabase.removeChannel(pairChRef.current); } catch {} pairChRef.current = null; }
    setLocalStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; });
    setRemoteStream(null);
    pendingIceRef.current = [];
    offerSentRef.current = false;
    setState({ status:"idle", type:null, isCaller:false, peerId:null, peerName:null, muted:false, cameraOff:false });
  }

  async function initPeer(type) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("MEDIA_UNSUPPORTED");
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    const constraints = type === "video" ? { audio: true, video: true } : { audio: true, video: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    setLocalStream(stream);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    pc.ontrack = (e) => setRemoteStream(e.streams[0]);
    pc.onicecandidate = (e) => { if (e.candidate) sendOnPair("ice", { candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") setState({ status: "in_call" });
      if ((s === "failed" || s === "disconnected" || s === "closed") && stateRef.current.status !== "idle") cleanup();
    };
    return pc;
  }

  async function openPair(peerId) {
    const ch = supabase.channel(pairName(user.id, peerId), { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "ready" }, async () => {
      if (!stateRef.current.isCaller || offerSentRef.current) return;
      const pc = pcRef.current; if (!pc) return;
      offerSentRef.current = true;
      clearCallTimeout();
      setState({ status: "connecting" });
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendOnPair("offer", { offer });
      } catch (e) { toast("Call setup failed.", "error"); cleanup(); }
    });
    ch.on("broadcast", { event: "offer" }, async ({ payload }) => {
      const pc = pcRef.current; if (!pc) return;
      try {
        await pc.setRemoteDescription(payload.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendOnPair("answer", { answer });
        for (const c of pendingIceRef.current) await pc.addIceCandidate(c).catch(() => {});
        pendingIceRef.current = [];
      } catch (e) { toast("Couldn't answer call.", "error"); cleanup(); }
    });
    ch.on("broadcast", { event: "answer" }, async ({ payload }) => {
      const pc = pcRef.current; if (!pc) return;
      try {
        await pc.setRemoteDescription(payload.answer);
        for (const c of pendingIceRef.current) await pc.addIceCandidate(c).catch(() => {});
        pendingIceRef.current = [];
      } catch {}
    });
    ch.on("broadcast", { event: "ice" }, async ({ payload }) => {
      const pc = pcRef.current; if (!pc) return;
      const candidate = new RTCIceCandidate(payload.candidate);
      if (pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(candidate).catch(() => {});
      else pendingIceRef.current.push(candidate);
    });
    ch.on("broadcast", { event: "hangup" }, () => { if (stateRef.current.status !== "idle") { toast("Call ended.", "info"); cleanup(); } });

    await waitForSubscribed(ch, "call");
    pairChRef.current = ch;
  }

  async function start(peerId, peerName, type) {
    if (stateRef.current.status !== "idle") return;
    if (!peerId || peerId === user.id) { toast("Can't call yourself.", "warning"); return; }
    if (peerId.startsWith("u") && peerId.length < 6) { toast("Demo contact — calls only work between real accounts.", "warning"); return; }
    setState({ status: "calling", type, isCaller: true, peerId, peerName, muted: false, cameraOff: false });
    try {
      await openPair(peerId);
      await initPeer(type);
      await sendToRing(peerId, "ring", { type });
      callTimeoutRef.current = setTimeout(() => {
        if (stateRef.current.status === "calling") {
          toast("No answer. They may be offline.", "warning");
          cleanup();
        }
      }, CALL_ANSWER_TIMEOUT_MS);
    } catch (e) {
      toast(e.name === "NotAllowedError" ? "Microphone/camera permission denied." : e.message === "MEDIA_UNSUPPORTED" ? "Calls are not supported in this browser." : "Couldn't start call.", "error");
      cleanup();
    }
  }

  async function accept() {
    const { peerId, type } = stateRef.current;
    if (!peerId) return;
    setState({ status: "connecting" });
    try {
      await openPair(peerId);
      await initPeer(type);
      await sendOnPair("ready", {});
    } catch (e) {
      toast(e.name === "NotAllowedError" ? "Microphone/camera permission denied." : e.message === "MEDIA_UNSUPPORTED" ? "Calls are not supported in this browser." : "Couldn't accept call.", "error");
      try { await sendToRing(peerId, "decline", {}); } catch {}
      cleanup();
    }
  }

  async function decline() {
    const { peerId } = stateRef.current;
    if (peerId) { try { await sendToRing(peerId, "decline", {}); } catch {} }
    cleanup();
  }

  async function end() {
    if (pairChRef.current) { try { await sendOnPair("hangup", {}); } catch {} }
    cleanup();
  }

  function toggleMute() {
    const s = localStream; if (!s) return;
    const t = s.getAudioTracks()[0]; if (!t) return;
    t.enabled = !t.enabled;
    setState({ muted: !t.enabled });
  }

  function toggleCamera() {
    const s = localStream; if (!s) return;
    const t = s.getVideoTracks()[0]; if (!t) return;
    t.enabled = !t.enabled;
    setState({ cameraOff: !t.enabled });
  }

  useEffect(() => {
    if (!user) return;
    const ringCh = supabase.channel(`ring:${user.id}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "ring" }, async ({ payload }) => {
        if (stateRef.current.status !== "idle") {
          try { await sendToRing(payload.from, "decline", { reason: "busy" }); } catch {}
          return;
        }
        setState({
          status: "ringing", type: payload.type, isCaller: false,
          peerId: payload.from, peerName: payload.fromName || "Someone",
          muted: false, cameraOff: false,
        });
      })
      .on("broadcast", { event: "decline" }, () => {
        const s = stateRef.current.status;
        if (s === "calling" || s === "connecting") { toast("Call declined.", "warning"); cleanup(); }
      })
      .subscribe();
    return () => { try { supabase.removeChannel(ringCh); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value = { state, localStream, remoteStream, start, accept, decline, end, toggleMute, toggleCamera };
  return <CallCtx.Provider value={value}>{children}<CallOverlay/></CallCtx.Provider>;
}

function CallOverlay() {
  const call = useCall();
  if (!call) return null;
  const { state, accept, decline, end, toggleMute, toggleCamera, localStream, remoteStream } = call;
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  useEffect(() => { if (localRef.current)  localRef.current.srcObject  = localStream;  }, [localStream]);
  useEffect(() => { if (remoteRef.current) remoteRef.current.srcObject = remoteStream; }, [remoteStream]);

  if (state.status === "idle") return null;

  const isRinging = state.status === "ringing";
  const statusLine = {
    calling:    "Ringing…",
    ringing:    `Incoming ${state.type === "video" ? "video" : "voice"} call`,
    connecting: "Connecting…",
    in_call:    "Connected",
  }[state.status];

  return (
    <div className="modal-overlay" style={{ zIndex: 100 }}>
      <div className="modal" style={{ maxWidth:"min(720px,95vw)", padding:0, overflow:"hidden" }}>
        <div style={{ padding:".8rem 1.1rem", borderBottom:"2px solid var(--ink)", background:"var(--paper2)", display:"flex", justifyContent:"space-between", alignItems:"center", gap:".8rem" }}>
          <div style={{ fontFamily:"var(--font-display)", fontSize:"1.05rem", letterSpacing:".04em" }}>
            {state.type === "video" ? "📹" : "📞"} {state.peerName || "Call"}
          </div>
          <div style={{ fontSize:".7rem", fontStyle:"italic", color:"var(--muted)" }}>{statusLine}</div>
        </div>

        {state.type === "video" && !isRinging && (
          <div style={{ position:"relative", background:"#000", aspectRatio:"16/9", maxHeight:"60vh" }}>
            <video ref={remoteRef} autoPlay playsInline style={{ width:"100%", height:"100%", objectFit:"cover", display:remoteStream?"block":"none" }} />
            {!remoteStream && (
              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", color:"#aaa", fontFamily:"var(--font-display)", letterSpacing:".05em" }}>
                {state.status === "in_call" ? "WAITING FOR VIDEO…" : statusLine.toUpperCase()}
              </div>
            )}
            <video ref={localRef} autoPlay playsInline muted style={{ position:"absolute", bottom:12, right:12, width:160, height:120, objectFit:"cover", border:"2px solid var(--paper)", borderRadius:8, background:"#111" }} />
          </div>
        )}

        {state.type === "audio" && !isRinging && (
          <div style={{ padding:"2.2rem 1rem", textAlign:"center", background:"var(--chalk)" }}>
            <div style={{ fontSize:"3rem", marginBottom:".5rem" }}>📞</div>
            <div style={{ fontFamily:"var(--font-display)", fontSize:"1.5rem", letterSpacing:".03em" }}>{state.peerName}</div>
            <audio ref={remoteRef} autoPlay />
          </div>
        )}

        {isRinging && (
          <div style={{ padding:"2.2rem 1rem", textAlign:"center", background:"var(--chalk)" }}>
            <div style={{ fontSize:"3rem", marginBottom:".5rem" }}>{state.type === "video" ? "📹" : "📞"}</div>
            <div style={{ fontFamily:"var(--font-display)", fontSize:"1.5rem", letterSpacing:".03em" }}>{state.peerName}</div>
            <div style={{ fontSize:".78rem", color:"var(--muted)", marginTop:".3rem", fontStyle:"italic" }}>is calling…</div>
          </div>
        )}

        <div style={{ padding:"1rem", display:"flex", gap:".5rem", justifyContent:"center", background:"var(--paper2)", borderTop:"2px solid var(--ink)", flexWrap:"wrap" }}>
          {isRinging ? (
            <>
              <button className="btn btn-orange" onClick={accept}>✓ Accept</button>
              <button className="btn btn-ghost" onClick={decline}>✕ Decline</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={toggleMute}>{state.muted ? "🔇 Unmute" : "🎤 Mute"}</button>
              {state.type === "video" && <button className="btn btn-ghost btn-sm" onClick={toggleCamera}>{state.cameraOff ? "📷 Camera On" : "📷 Camera Off"}</button>}
              <button className="btn btn-orange" onClick={end}>✕ End Call</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
