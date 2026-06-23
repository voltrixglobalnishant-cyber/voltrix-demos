"use client";
// app/demo/[brand]/page.js
// Themed demo storefront + Nexus AI widget. Talks ONLY to /api/chat (key stays server-side).
// Logs each conversation to /api/log (fire-and-forget) for the analytics page.

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import { getBrand, listBrands } from "../../../lib/brands";

export default function DemoPage() {
  const params = useParams();
  const slug = (params?.brand || "").toString();
  const brand = getBrand(slug);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // {role, content, escalate?}
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [showChips, setShowChips] = useState(true);
  const bodyRef = useRef(null);
  const sessionIdRef = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "s_" + Date.now() + "_" + Math.random().toString(36).slice(2)
  );

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, typing]);

  // Inject styles into <head> (Next 16 disallows inline <style> in the tree)
  useEffect(() => {
    if (!brand) return;
    const id = "vx-demo-styles";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = buildCSS(brand.theme);
    document.head.appendChild(el);
    return () => { const e = document.getElementById(id); if (e) e.remove(); };
  }, [brand]);

  if (!brand) {
    return (
      <div style={{ padding: 60, fontFamily: "sans-serif", textAlign: "center" }}>
        <h1>Demo not found</h1>
        <p>No brand configured for “{slug}”.</p>
        <p style={{marginTop:20,fontSize:13,color:"#888"}}>
          slug: [{slug}] · known: {listBrands().join(", ")}
        </p>
      </div>
    );
  }

  const t = brand.theme;

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content) return;
    setShowChips(false);
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setTyping(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: slug,
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await res.json();
      setTyping(false);
      const reply = data.reply || brand.fallback;
      const escalated = !!data.escalate;
      setMessages((m) => [
        ...m,
        { role: "assistant", content: reply, escalate: escalated },
      ]);

      // fire-and-forget logging — never blocks or breaks the chat
      fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          brand: slug,
          messages: [...next, { role: "assistant", content: reply }],
          escalated,
        }),
      }).catch(() => {});
    } catch {
      setTyping(false);
      setMessages((m) => [...m, { role: "assistant", content: brand.fallback, escalate: true }]);
    }
  }

  return (
    <>
      <div className="vx-wrap">
        <div className="vx-banner">
          Live demo for <b>{brand.name}</b> · running on sample order data · built by Voltrix CX · tap the chat button →
        </div>

        <div className="vx-store">
          <div className="vx-top">
            <div className="vx-brand">{brand.name}</div>
          </div>
          <div className="vx-hero">
            <div className="vx-eyebrow">{brand.store.eyebrow}</div>
            <h1 dangerouslySetInnerHTML={{ __html: brand.store.headline }} />
            <p>{brand.store.sub}</p>
          </div>
          <div className="vx-shelf">
            {brand.store.products.map((c) => (
              <div className="vx-card" key={c.n}>
                <div className="img"><div className="vx-silho">{c.e}</div></div>
                <h3>{c.n}</h3>
                <div className="vx-price">{c.p}</div>
                <div className="vx-tagk">{c.k}</div>
              </div>
            ))}
          </div>
        </div>

        {!open && (
          <button className="vx-launcher" onClick={() => setOpen(true)} aria-label="Open chat">
            <span className="vx-pulse" />
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </button>
        )}

        {open && (
          <div className="vx-chat">
            <div className="vx-head">
              <div className="vx-mark">{brand.initial}</div>
              <div className="vx-who">
                <h4>{brand.conciergeName}</h4>
                <div className="vx-status"><span className="vx-dot" /> Always here · replies instantly</div>
              </div>
              <button className="vx-x" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="vx-body" ref={bodyRef}>
              <div className="vx-msg vx-bot" dangerouslySetInnerHTML={{ __html: brand.greeting }} />
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div className="vx-msg vx-user" key={i}>{m.content}</div>
                ) : (
                  <div key={i}>
                    <div className="vx-msg vx-bot" dangerouslySetInnerHTML={{ __html: m.content.replace(/\n/g, "<br>") }} />
                    {m.escalate && (
                      <div className="vx-esc" style={{ marginTop: 8 }}>
                        <b>↗ Handed to the {brand.name} team</b><br />
                        A team member will personally follow up — no automated dead-ends.
                      </div>
                    )}
                  </div>
                )
              )}
              {typing && (
                <div className="vx-typing"><span /><span /><span /></div>
              )}
            </div>

            {showChips && (
              <div className="vx-chips">
                {brand.chips.map((c) => (
                  <div className="vx-chip" key={c.q} onClick={() => send(c.q)}>{c.label}</div>
                ))}
              </div>
            )}

            <div className="vx-input">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Ask anything…"
              />
              <button className="vx-send" onClick={() => send()} aria-label="Send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
            <div className="vx-powered">Powered by <b>Nexus AI</b> · Voltrix CX</div>
          </div>
        )}
      </div>
    </>
  );
}

function buildCSS(t) {
  // Load fonts once
  if (typeof document !== "undefined" && !document.getElementById("vx-fonts")) {
    const link = document.createElement("link");
    link.id = "vx-fonts";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500&display=swap";
    document.head.appendChild(link);
  }
  return `
    .vx-wrap *, .vx-launcher, .vx-chat, .vx-chat * { margin:0; padding:0; box-sizing:border-box; }
    .vx-wrap { font-family:'Jost',sans-serif; color:${t.ink}; background:${t.paper}; min-height:100vh; }
    .vx-banner { background:${t.ink}; color:${t.cream}; text-align:center; padding:10px 16px; font-size:12.5px; font-weight:300; }
    .vx-banner b { color:#d9b48f; font-weight:500; }
    .vx-store { max-width:1100px; margin:0 auto; padding:0 24px; }
    .vx-top { display:flex; align-items:center; justify-content:space-between; padding:26px 0 22px; border-bottom:1px solid ${t.line}; }
    .vx-brand { font-family:'Cormorant Garamond',serif; font-size:30px; letter-spacing:.22em; font-weight:500; text-transform:uppercase; }
    .vx-hero { text-align:center; padding:70px 0 50px; }
    .vx-eyebrow { font-size:12px; letter-spacing:.3em; text-transform:uppercase; color:${t.tan}; margin-bottom:20px; }
    .vx-hero h1 { font-family:'Cormorant Garamond',serif; font-weight:500; font-size:clamp(38px,6vw,64px); line-height:1.05; }
    .vx-hero em { font-style:italic; color:${t.leather}; }
    .vx-hero p { margin-top:22px; color:#6f655b; font-weight:300; }
    .vx-shelf { display:grid; grid-template-columns:repeat(4,1fr); gap:22px; padding:20px 0 90px; }
    .vx-card .img { aspect-ratio:3/4; background:linear-gradient(150deg,${t.tile1},${t.tile2}); border-radius:2px; display:flex; align-items:flex-end; justify-content:center; }
    .vx-silho { font-size:70px; padding-bottom:18px; opacity:.55; }
    .vx-card h3 { font-family:'Cormorant Garamond',serif; font-size:19px; font-weight:500; margin-top:14px; }
    .vx-price { color:#8a7d6e; font-size:13px; margin-top:2px; }
    .vx-tagk { font-size:10.5px; letter-spacing:.18em; text-transform:uppercase; color:${t.sage}; margin-top:8px; }
    @media(max-width:820px){ .vx-shelf{grid-template-columns:repeat(2,1fr);} }
    .vx-launcher { position:fixed; bottom:26px; right:26px; width:64px; height:64px; border-radius:50%; background:${t.leather}; color:${t.cream}; border:none; cursor:pointer; box-shadow:0 10px 30px rgba(43,36,32,.32); display:flex; align-items:center; justify-content:center; z-index:50; transition:transform .25s; }
    .vx-launcher:hover { transform:scale(1.06); }
    .vx-pulse { position:absolute; top:-3px; right:-3px; width:16px; height:16px; border-radius:50%; background:${t.sage}; border:2px solid ${t.paper}; }
    .vx-chat { position:fixed; bottom:26px; right:26px; width:384px; max-width:calc(100vw - 32px); height:600px; max-height:calc(100vh - 52px); background:${t.paper}; border-radius:14px; box-shadow:0 24px 70px rgba(43,36,32,.34); display:flex; flex-direction:column; overflow:hidden; z-index:60; border:1px solid ${t.line}; animation:vxrise .32s cubic-bezier(.2,.8,.2,1); }
    @keyframes vxrise { from{opacity:0;transform:translateY(18px);} to{opacity:1;transform:translateY(0);} }
    .vx-head { background:linear-gradient(135deg,${t.leather},${t.leatherDark}); color:${t.cream}; padding:18px 20px; display:flex; align-items:center; gap:13px; }
    .vx-mark { width:42px; height:42px; border-radius:50%; background:rgba(245,240,232,.12); border:1px solid rgba(245,240,232,.25); display:flex; align-items:center; justify-content:center; font-family:'Cormorant Garamond',serif; font-size:22px; font-weight:600; }
    .vx-who { flex:1; }
    .vx-who h4 { font-family:'Cormorant Garamond',serif; font-size:19px; font-weight:500; letter-spacing:.04em; }
    .vx-status { font-size:11px; opacity:.8; display:flex; align-items:center; gap:6px; margin-top:1px; font-weight:300; }
    .vx-dot { width:7px; height:7px; border-radius:50%; background:#9cc47a; }
    .vx-x { background:none; border:none; color:${t.cream}; opacity:.7; cursor:pointer; font-size:22px; }
    .vx-x:hover { opacity:1; }
    .vx-body { flex:1; overflow-y:auto; padding:20px 18px; background:${t.paper}; display:flex; flex-direction:column; gap:14px; }
    .vx-msg { max-width:85%; font-size:14px; }
    .vx-bot { align-self:flex-start; background:#fff; border:1px solid ${t.line}; padding:11px 14px; border-radius:4px 14px 14px 14px; color:#3a322b; }
    .vx-user { align-self:flex-end; background:${t.leather}; color:${t.cream}; padding:11px 14px; border-radius:14px 4px 14px 14px; }
    .vx-esc { align-self:stretch; background:rgba(122,125,90,.1); border:1px dashed ${t.sage}; border-radius:8px; padding:10px 13px; font-size:12.5px; color:#5a5d3e; }
    .vx-esc b { color:${t.sage}; }
    .vx-chips { display:flex; flex-wrap:wrap; gap:7px; padding:0 18px 12px; }
    .vx-chip { background:#fff; border:1px solid ${t.line}; border-radius:18px; padding:7px 13px; font-size:12px; color:${t.leather}; cursor:pointer; font-family:'Jost',sans-serif; transition:all .18s; }
    .vx-chip:hover { background:${t.leather}; color:${t.cream}; }
    .vx-typing { align-self:flex-start; display:flex; gap:4px; padding:12px 14px; background:#fff; border:1px solid ${t.line}; border-radius:4px 14px 14px 14px; }
    .vx-typing span { width:7px; height:7px; border-radius:50%; background:${t.tan}; animation:vxblink 1.3s infinite; }
    .vx-typing span:nth-child(2){animation-delay:.2s;} .vx-typing span:nth-child(3){animation-delay:.4s;}
    @keyframes vxblink { 0%,60%,100%{opacity:.3;} 30%{opacity:1;} }
    .vx-input { border-top:1px solid ${t.line}; padding:12px 14px; display:flex; gap:9px; align-items:center; background:#fff; }
    .vx-input input { flex:1; border:none; outline:none; font-family:'Jost',sans-serif; font-size:14px; color:${t.ink}; background:transparent; }
    .vx-send { background:${t.leather}; border:none; color:${t.cream}; width:38px; height:38px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; }
    .vx-powered { text-align:center; font-size:10px; letter-spacing:.12em; color:#b3a695; padding:7px; background:#fff; text-transform:uppercase; }
    .vx-powered b { color:${t.leather}; font-weight:500; }
  `;
}