"use client";
// app/demo/[brand]/page.js
// Storefront + Nexus AI widget: photo upload + client-side downscale + REAL vision analysis card.
// Chat -> /api/chat. Vision -> /api/analyze. Email -> /api/claim. Logs -> /api/log.

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import { getBrand, listBrands } from "../../../lib/brands";

// Turn plain URLs and internal /pay links in a bot reply into clickable anchors,
// then convert newlines to <br>. Brand-neutral (used for every brand's replies).
function linkifyBot(text) {
  return (text || "")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a class="vx-link" href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(\/[A-Za-z0-9][A-Za-z0-9\/_-]*)/g, '$1<a class="vx-link" href="$2">$2</a>')
    .replace(/\n/g, "<br>");
}

export default function DemoPage() {
  const params = useParams();
  const slug = (params?.brand || "").toString();
  const brand = getBrand(slug);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // {role, content, escalate?, image?, analyzing?, analysis?, analysisId?}
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [showChips, setShowChips] = useState(true);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const skinFileRef = useRef(null);
  const skinCamRef = useRef(null);   // hidden capture input for mobile "Take photo"
  const camVideoRef = useRef(null);  // live <video> for desktop getUserMedia
  const handFileRef = useRef(null);
  const tryEditRef = useRef(null); // adjust-fit editor container
  const dragRef = useRef(null);    // pointer-drag state for the ring

  // --- Beauty-plan (blurred report + lead gate) + fake-cart state (KorinMi) ---
  const [lead, setLead] = useState({ name: "", email: "", phone: "", waOptIn: false });
  const [cart, setCart] = useState([]); // fake cart: [{name, price}]
  const [planView, setPlanView] = useState(null); // null | 'intro' | 'quiz' | 'report'
  const [report, setReport] = useState(null); // { source, score, metrics, tags, observations, recommended, unlocked, sending }
  const [quiz, setQuiz] = useState(null);      // { step, answers }
  const [stockAlert, setStockAlert] = useState(null); // { product, email, phone, waOptIn, sent }
  const [camera, setCamera] = useState(null); // { stream } while the desktop camera preview is open

  // --- Virtual try-on state (Éclat) ---
  const [tryon, setTryon] = useState(null);
  // { stage:'form'|'rendering'|'results', handPhoto, placement, form:{consent,name,email,phone},
  //   overlays:[{ringName,price,dataUrl}], saved:false, saving:false }

  const sessionIdRef = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "s_" + Date.now() + "_" + Math.random().toString(36).slice(2)
  );

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, typing]);

  // Attach the live camera stream to the <video> when the preview opens; stop tracks on close/unmount.
  useEffect(() => {
    const v = camVideoRef.current;
    if (camera?.stream && v) { v.srcObject = camera.stream; v.play?.().catch(() => {}); }
    return () => { camera?.stream?.getTracks?.().forEach((tk) => tk.stop()); };
  }, [camera]);

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
  const planEnabled = slug.toLowerCase() === "korinmi"; // beauty-plan + cart features are KorinMi-only
  const tryonEnabled = slug.toLowerCase() === "eclat";  // virtual jewellery try-on is Éclat-only
  const decorEnabled = slug.toLowerCase() === "bingetown"; // decor-match vision is Binge Town-only

  async function send(text, imageDataUrl, noteForAI, silent) {
    const content = (text ?? input).trim();
    if (!content && !imageDataUrl) return;
    setShowChips(false);

    const userMsg = { role: "user", content: content || "", image: imageDataUrl || null, silent: !!silent };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setTyping(true);

    const aiContent = [content, noteForAI].filter(Boolean).join(" ").trim() || "(no text)";
    const aiHistory = next.map((m, i) =>
      i === next.length - 1
        ? { role: "user", content: aiContent }
        : { role: m.role, content: m.content || (m.image ? "[photo]" : "") }
    ).filter((m) => m.role === "user" || m.role === "assistant");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: slug, messages: aiHistory }),
      });
      const data = await res.json();
      setTyping(false);
      const reply = data.reply || brand.fallback;
      const escalated = !!data.escalate;
      setMessages((m) => [...m, { role: "assistant", content: reply, escalate: escalated }]);

      fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current, brand: slug,
          messages: [...aiHistory, { role: "assistant", content: reply }], escalated,
        }),
      }).catch(() => {});
    } catch {
      setTyping(false);
      setMessages((m) => [...m, { role: "assistant", content: brand.fallback, escalate: true }]);
    }
  }

  // downscale to max 1024px / jpeg — keeps uploads tiny so vision is fast
  function downscale(dataUrl, maxDim = 1024, quality = 0.82) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
        else if (height >= width && height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
        const c = document.createElement("canvas");
        c.width = width; c.height = height;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height); // flatten alpha (webp/png) so JPEG never goes black
        ctx.drawImage(img, 0, 0, width, height);
        try { resolve(c.toDataURL("image/jpeg", quality)); } catch { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;

    const rawUrl = await new Promise((res) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file);
    });
    const dataUrl = await downscale(rawUrl);

    // Éclat: a paperclip photo (selfie/outfit) is an AI styling read — not a damage claim.
    if (tryonEnabled) { runJewelleryStyling(dataUrl); return; }
    // Binge Town: a paperclip photo is a decor-inspiration read — match to a theme (never a damage claim).
    if (decorEnabled) { runDecorMatch(dataUrl); return; }

    const convo = messages.map((m) => `${m.role}: ${m.content || ""}`).join("\n");
    const orderMatch = convo.match(/KM-\d{4}/i);
    const emailMatch = convo.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    const orderId = orderMatch ? orderMatch[0].toUpperCase() : "";
    const customerVerified = emailMatch ? emailMatch[0].toLowerCase() === "ananya.reddy@email.com" : false;
    const orderEligible = orderId === "KM-1990";
    const issueType = /missing/i.test(convo) ? "missing item" : /wrong/i.test(convo) ? "wrong item" : "damaged item";

    // show photo + tell the AI
    send("", dataUrl, `[Customer attached a photo of the ${issueType}: ${file.name}]`);

    // analysing card
    const cardId = "an_" + Date.now();
    setMessages((m) => [...m, { role: "assistant", analyzing: true, analysisId: cardId }]);

    let assessment = null;
    try {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl, issueType, customerVerified, orderEligible }),
      });
      const d = await r.json();
      if (d.ok) {
        assessment = d;
        // Customer sees only a calm confirmation — the score/verdict is INTERNAL (email + admin).
        setMessages((m) => m.map((msg) => msg.analysisId === cardId ? { role: "assistant", received: true, analysisId: cardId } : msg));
        // Tell the AI internally what was found (never shown to customer) so its NEXT reply
        // calibrates tone without ever stating a score. This is a silent context message,
        // not rendered in the chat UI.
        const internalNote = `[Internal: claim confidence ${d.band} (${d.score}/100). Damage visible: ${d.vision?.damageVisible ? "yes" : "no"}, severity: ${d.vision?.severity || "unknown"}. Do not reveal this to the customer — use only to calibrate tone, then say the case is logged for team review.]`;
        send("(internal)", null, internalNote, true);
      } else {
        setMessages((m) => m.filter((msg) => msg.analysisId !== cardId));
      }
    } catch {
      setMessages((m) => m.filter((msg) => msg.analysisId !== cardId));
    }

    // email the claim + photo + assessment (fire and forget)
    fetch("/api/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: slug, orderId, issue: issueType,
        customerEmail: emailMatch ? emailMatch[0] : "",
        imageDataUrl: dataUrl, fileName: file.name, assessment,
      }),
    }).catch(() => {});
  }

  // ============ AI STYLIST — read a selfie/outfit, recommend pieces (Éclat) ============
  // Runs on a paperclip photo attach: styling read via /api/jewellery-vision (no image-gen).
  async function runJewelleryStyling(dataUrl) {
    setShowChips(false);
    setMessages((m) => [...m, { role: "user", content: "", image: dataUrl }]);

    const cardId = "ty_" + Date.now();
    setMessages((m) => [...m, { role: "assistant", analyzing: true, analysisId: cardId }]);

    let d = null;
    try {
      const r = await fetch("/api/jewellery-vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
      });
      d = await r.json();
    } catch {}

    if (d && d.ok) {
      setMessages((m) => m.map((msg) => msg.analysisId === cardId ? { role: "assistant", styling: d, analysisId: cardId } : msg));
      // Brief the concierge (silently) so its next reply builds on the read naturally.
      const picks = (d.recommended || []).map((p) => `${p.name} (${p.price})`).join(", ");
      const note = `[Internal styling read — skin tone: ${d.skinTone}, style: ${d.style || "n/a"}, best metal: ${d.metal || "n/a"}. Suggested pieces: ${picks}. Greet the result warmly in 1-2 sentences, invite one follow-up (e.g. budget, occasion, or a hand-photo virtual try-on). Do not repeat the card verbatim.]`;
      send("(internal)", null, note, true);
    } else {
      setMessages((m) => m.filter((msg) => msg.analysisId !== cardId));
      setMessages((m) => [...m, { role: "assistant", content:
        "I couldn't read that photo clearly 💎 — try a brighter, closer shot of your face, hand, or outfit and I'll style you right away." }]);
    }
  }

  // ============ DECOR MATCH — read an inspiration photo, match a Binge Town theme (Binge Town) ============
  // Vision reasoning + confidence stay INTERNAL (persisted for the admin panel); the guest only
  // sees a friendly card + a warm concierge line calibrated by a silent internal note.
  async function runDecorMatch(dataUrl) {
    setShowChips(false);
    setMessages((m) => [...m, { role: "user", content: "", image: dataUrl }]);

    const cardId = "dc_" + Date.now();
    setMessages((m) => [...m, { role: "assistant", analyzing: true, analysisId: cardId }]);

    // Give the read a little occasion context from the conversation, if any.
    const convo = messages.map((m) => `${m.content || ""}`).join(" ");
    const occMatch = convo.match(/proposal|anniversary|birthday|baby shower|bride-to-be|farewell|reunion|romantic|date/i);
    const occasion = occMatch ? occMatch[0] : "";

    let d = null;
    try {
      const r = await fetch("/api/decor-match", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl, occasion }),
      });
      d = await r.json();
    } catch {}

    if (d && d.ok) {
      setMessages((m) => m.map((msg) => msg.analysisId === cardId ? { role: "assistant", decor: d, analysisId: cardId } : msg));
      // Brief the concierge silently so its next line builds on the match (never reads out internals).
      send("(internal)", null, d.internalNote, true);
    } else {
      setMessages((m) => m.filter((msg) => msg.analysisId !== cardId));
      setMessages((m) => [...m, { role: "assistant", content:
        "I couldn't quite read that photo 🎉 — try a brighter, closer shot of the decor or vibe you love and I'll match it to one of our themes." }]);
    }
  }

  // ============ VIRTUAL TRY-ON — real ring PNG composited onto the hand (Éclat) ============
  // CTA → invite a hand photo, then open the hand-photo picker.
  function startTryon() {
    setShowChips(false);
    setMessages((m) => [...m, { role: "assistant", content:
      "Let's try one on 💎 Upload a clear photo of your hand (fingers spread, good light) and I'll place real Éclat rings right on your finger." }]);
    handFileRef.current?.click();
  }

  // Hand photo picked → downscale → detect the ring finger → reveal the consent/lead form.
  async function onPickHandPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;

    const rawUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    const dataUrl = await downscale(rawUrl, 1024, 0.9);
    setMessages((m) => [...m, { role: "user", content: "", image: dataUrl }]);

    const cardId = "hd_" + Date.now();
    setMessages((m) => [...m, { role: "assistant", analyzing: true, analysisId: cardId }]);

    let placement = null;
    try {
      const { detectRingFinger } = await import("../../../lib/tryon");
      const r = await detectRingFinger(dataUrl);
      if (r.ok) placement = r.placement;
    } catch {}
    setMessages((m) => m.filter((msg) => msg.analysisId !== cardId));

    if (!placement) {
      setMessages((m) => [...m, { role: "assistant", content:
        "I couldn't spot a hand there 💎 — try a straight-on shot of the back of your hand with fingers slightly spread and good lighting." }]);
      return;
    }
    setTryon({ stage: "form", handPhoto: dataUrl, placement,
      form: { consent: false, name: "", email: "", phone: "" }, overlays: [], saved: false, saving: false });
    setMessages((m) => [...m, { role: "assistant", content:
      "Perfect, I found your finger ✨ A couple of quick details below and I'll show three Éclat rings on your hand." }]);
  }

  // Composite every try-on ring onto the hand at a given placement + size multiplier.
  async function composeOverlays(placement, scaleMul) {
    const rings = brand.tryonRings || [];
    const overlays = [];
    try {
      const { compositeRing } = await import("../../../lib/tryon");
      for (const ring of rings) {
        try {
          const dataUrl = await compositeRing(tryon.handPhoto, ring.img, placement, (ring.scale || 1.25) * scaleMul);
          overlays.push({ ringName: ring.name, price: ring.price, dataUrl });
        } catch {}
      }
    } catch {}
    return overlays;
  }

  // Detected placement + manual nudges → the placement used for compositing.
  function adjustedPlacement(adj) {
    return { ...tryon.placement, cx: adj.cx, cy: adj.cy, angle: tryon.placement.angle + (adj.angleDeg * Math.PI) / 180 };
  }

  // Render the 3 previews from the auto-detected placement, then move to results.
  async function renderTryons() {
    if (!tryon) return;
    const f = tryon.form;
    if (!EMAIL_RE.test(f.email || "")) return alert("Please enter a valid email");
    if (!validPhone(f.phone || "")) return alert("Please enter a valid 10-digit mobile");

    setTryon((s) => ({ ...s, stage: "rendering" }));
    const overlays = await composeOverlays(tryon.placement, 1);
    if (!overlays.length) {
      setTryon((s) => ({ ...s, stage: "form" }));
      setMessages((m) => [...m, { role: "assistant", content:
        "Hmm, the ring previews didn't render — the ring images may still be uploading. Please try again shortly. 💎" }]);
      return;
    }
    setTryon((s) => ({ ...s, stage: "results", overlays }));
  }

  // ---- Adjust-fit editor (fallback when auto-placement is slightly off) ----
  function openAdjust() {
    setTryon((s) => ({ ...s, editing: true,
      adjust: s.adjust || { cx: s.placement.cx, cy: s.placement.cy, angleDeg: 0, scaleMul: 1 } }));
  }
  function cancelAdjust() { setTryon((s) => ({ ...s, editing: false })); }

  function onRingDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }
  function onRingMove(e) {
    if (!dragRef.current) return;
    const cont = tryEditRef.current;
    if (!cont || !tryon) return;
    const sf = cont.offsetWidth / tryon.placement.imgW; // display px per natural px
    const dxN = (e.clientX - dragRef.current.x) / sf;
    const dyN = (e.clientY - dragRef.current.y) / sf;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setTryon((s) => ({ ...s, adjust: { ...s.adjust, cx: s.adjust.cx + dxN, cy: s.adjust.cy + dyN } }));
  }
  function onRingUp(e) { dragRef.current = null; try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {} }

  // Apply the nudges → re-composite all 3, back to results (unsaved so they can re-save).
  async function applyAdjust() {
    if (!tryon?.adjust) return;
    const adj = tryon.adjust;
    setTryon((s) => ({ ...s, stage: "rendering", editing: false }));
    const overlays = await composeOverlays(adjustedPlacement(adj), adj.scaleMul);
    setTryon((s) => overlays.length
      ? { ...s, stage: "results", overlays, saved: false }
      : { ...s, stage: "results" });
  }

  // Save to profile → upload to Storage + log to Firestore via /api/tryon.
  async function saveTryon() {
    if (!tryon || !tryon.overlays.length) return;
    const f = tryon.form;
    if (!f.consent) return alert("Please tick consent to save this try-on to your profile");
    setTryon((s) => ({ ...s, saving: true }));
    let d = null;
    try {
      const r = await fetch("/api/tryon", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tryOnName: f.name, email: f.email, phone: f.phone, consent: f.consent,
          handPhoto: tryon.handPhoto,
          overlays: tryon.overlays.map((o) => ({ ringName: o.ringName, dataUrl: o.dataUrl })),
        }),
      });
      d = await r.json();
    } catch {}
    setTryon((s) => ({ ...s, saving: false, saved: !!(d && d.ok) }));
    setMessages((m) => [...m, { role: "assistant", content: (d && d.ok)
      ? `Saved to your profile 💎 “${f.name || "My Éclat try-on"}” — we'll keep it and follow up on WhatsApp (${f.phone}). Want to book a free preview to see them in person?`
      : "I couldn't save that just now — but your try-on is right here. Our team will follow up, or try Save again in a moment." }]);
  }

  // ============ BEAUTY PLAN + LEAD GATE + FAKE CART (KorinMi) ============
  const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  function validPhone(p) { const d = (p || "").replace(/\D/g, ""); return d.length === 10 && /^[6-9]/.test(d); }

  // SKIN/HAIR ANALYSIS — REAL vision call → cosmetic concerns + product matches
  async function analyzeSkinHair(dataUrl, type) {
    const r = await fetch("/api/skin-analysis", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: dataUrl, type }),
    });
    return await r.json();
  }

  // Show a report (from a photo read or the quiz) BLURRED behind the lead gate.
  function showReport(rep) {
    setReport({ ...rep, unlocked: false, sending: false });
    setPlanView("report");
    setMessages((m) => [...m, { role: "assistant", reportCard: true }]);
  }

  // UNLOCK — validate the lead gate, unblur, email the plan + kit, save the lead to Firestore.
  async function unlockReport() {
    if (!report) return;
    if (!lead.name.trim()) return alert("Please add your name");
    if (!EMAIL_RE.test(lead.email)) return alert("Please enter a valid email");
    if (!validPhone(lead.phone)) return alert("Please enter a valid 10-digit mobile");
    setReport((r) => ({ ...r, sending: true }));
    let d = null;
    try {
      const res = await fetch("/api/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: lead.name, email: lead.email, phone: lead.phone, waOptIn: lead.waOptIn,
          tags: report.tags, recommended: report.recommended, concerns: report.observations,
          score: report.score, source: report.source === "quiz" ? "quiz_report" : "photo_report",
        }),
      });
      d = await res.json();
    } catch {}
    if (d && d.ok) {
      setReport((r) => ({ ...r, unlocked: true, sending: false }));
      setMessages((m) => [...m, { role: "assistant", content:
        `All done, ${lead.name.split(" ")[0]}! ✨ Your full plan + kit is on its way to your email (${lead.email})${lead.waOptIn ? ", and we'll send offers on WhatsApp too" : ""}. Your report above is now unlocked.` }]);
    } else {
      setReport((r) => ({ ...r, sending: false }));
      setMessages((m) => [...m, { role: "assistant", content:
        "I couldn't unlock it just now — please double-check your details and try again, or our team will follow up." }]);
    }
    return d;
  }

  // ABANDONED CART — nudge when the user leaves with items in the (fake) cart
  async function recoverCart() {
    if (!cart.length) return;
    await fetch("/api/cart-recover", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: lead.name, phone: lead.phone, cart }),
    });
  }

  // Kick off the plan flow: offer a photo (best result) or the no-photo quiz.
  function startPlan() {
    setShowChips(false);
    setPlanView("intro");
    setMessages((m) => [...m, { role: "assistant", content:
      "Love that! ✨ For the most accurate report, add a skin or hair photo — or take the quick 30-second quiz. Either way I'll build your custom report and matched kit." }]);
  }

  // Optional skin/hair photo (upload OR mobile capture) → normalise to JPEG → real cosmetic read.
  async function onPickSkinPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;

    const rawUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    const dataUrl = await downscale(rawUrl); // canvas → JPEG @≤1024px (handles webp/heic/png uniformly)
    await runSkinAnalysis(dataUrl);
  }

  // Shared: run a prepared JPEG data URL through the cosmetic vision read → blurred report → lead gate.
  async function runSkinAnalysis(dataUrl) {
    setMessages((m) => [...m, { role: "user", content: "", image: dataUrl }]);
    setPlanView(null);

    const cardId = "sk_" + Date.now();
    setMessages((m) => [...m, { role: "assistant", analyzing: true, analysisId: cardId }]);

    let d = null;
    try { d = await analyzeSkinHair(dataUrl, "skin"); } catch {}
    setMessages((m) => m.filter((msg) => msg.analysisId !== cardId));

    if (d && d.ok) {
      showReport({ source: "photo", score: d.score, metrics: d.metrics || null,
        tags: d.tags || ["general"], observations: d.observations || [], recommended: d.recommended || [] });
    } else {
      setMessages((m) => [...m, { role: "assistant", content:
        "I couldn't read that photo clearly — no worries, take the quick quiz and I'll still build your report. ✨" }]);
      setPlanView("intro");
    }
  }

  // "Take photo": mobile uses the native capture input; desktop opens a live getUserMedia preview.
  async function openSkinCamera() {
    const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
    if (isMobile || !navigator.mediaDevices?.getUserMedia) { skinCamRef.current?.click(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      setCamera({ stream });
    } catch {
      skinCamRef.current?.click(); // permission denied / no webcam → fall back to the file picker
    }
  }

  function closeSkinCamera() { setCamera(null); }

  // Grab the current webcam frame → JPEG (downscaled) → same analysis flow as an upload.
  async function captureSkinPhoto() {
    const v = camVideoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    let raw = null;
    try { raw = c.toDataURL("image/jpeg", 0.9); } catch {}
    closeSkinCamera();
    if (!raw) return;
    const dataUrl = await downscale(raw);
    await runSkinAnalysis(dataUrl);
  }

  // ============ QUIZ (no-photo path) → same blurred report + lead gate ============
  function startQuiz() {
    setQuiz({ step: 0, answers: {} });
    setPlanView("quiz");
  }
  function answerQuiz(opt) {
    const steps = brand.plan?.quiz || [];
    const cur = steps[quiz.step];
    if (!cur) return;
    const answers = { ...quiz.answers, [cur.key]: { value: opt.value, tag: opt.tag, label: opt.label } };
    if (quiz.step + 1 < steps.length) {
      setQuiz({ step: quiz.step + 1, answers });
    } else {
      setQuiz(null);
      buildQuizReport(answers);
    }
  }
  // Map quiz answers → concern tags → matched kit + a fun cosmetic score (never medical).
  function buildQuizReport(answers) {
    const catalog = brand.plan?.catalog || {};
    const picked = Object.values(answers).map((a) => a.tag).filter(Boolean);
    let tags = [...new Set(picked)].filter((t) => t !== "general");
    if (!tags.length) tags = ["general"];
    const tagsForKit = [...new Set([...tags, "sun_protection"])]; // everyone gets sun care in the kit
    const recommended = [...new Set(tagsForKit.flatMap((t) => catalog[t] || catalog.general || []))].slice(0, 4);
    const concernCount = tags.filter((t) => t !== "sun_protection").length;
    const score = Math.max(58, 88 - concernCount * 7);
    const observations = Object.values(answers).map((a) => ({ concern: a.label, note: "from your quiz" }));
    setMessages((m) => [...m, { role: "user", content: "Took the 30-second quiz ✅" }]);
    setPlanView(null);
    showReport({ source: "quiz", score, metrics: null, tags, observations, recommended });
  }

  // ============ BACK-IN-STOCK — capture email/phone for an out-of-stock product ============
  function openStockAlert(productName) {
    setOpen(true);
    setShowChips(false);
    setStockAlert({ product: productName, email: "", phone: "", waOptIn: false, sent: false });
    setMessages((m) => [...m, { role: "assistant", content:
      `“${productName}” is out of stock right now — pop your email or mobile below and I'll ping you the moment it's back. ✨` }]);
  }
  async function submitStockAlert() {
    const s = stockAlert;
    if (!s) return;
    if (!EMAIL_RE.test(s.email) && !validPhone(s.phone)) return alert("Add a valid email or 10-digit mobile so we can reach you");
    let d = null;
    try {
      const r = await fetch("/api/stock-alert", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: slug, product: s.product, email: s.email, phone: s.phone, waOptIn: s.waOptIn }),
      });
      d = await r.json();
    } catch {}
    setStockAlert((x) => ({ ...x, sent: !!(d && d.ok) }));
  }

  // Close the chat — fire abandoned-cart recovery if items were left behind
  function closeChat() {
    setOpen(false);
    if (planEnabled) recoverCart();
  }

  return (
    <>
      <div className="vx-wrap">
        <div className="vx-banner">
          Live demo for <b>{brand.name}</b> · running on sample order data · built by Voltrix CX · tap the chat button →
        </div>

        {planEnabled && cart.length > 0 && (
          <div className="vx-cartpill">🛍️ {cart.length} in bag</div>
        )}

        <div className="vx-store">
          <div className="vx-top"><div className="vx-brand">{brand.name}</div></div>
          <div className="vx-hero">
            <div className="vx-eyebrow">{brand.store.eyebrow}</div>
            <h1 dangerouslySetInnerHTML={{ __html: brand.store.headline }} />
            <p>{brand.store.sub}</p>
          </div>
          <div className="vx-shelf">
            {brand.store.products.map((c) => (
              <div className="vx-card" key={c.n}>
                <div className="img">
                  {planEnabled && c.inStock === false && <div className="vx-oos">Out of stock</div>}
                  {c.img ? (
                    // Real product photo; if the file is missing, fall back to the emoji silhouette.
                    <img
                      src={c.img}
                      alt={c.n}
                      className="vx-prod"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.nextSibling.style.display = "flex";
                      }}
                    />
                  ) : null}
                  <div className="vx-silho" style={c.img ? { display: "none" } : undefined}>{c.e}</div>
                </div>
                <h3>{c.n}</h3>
                <div className="vx-price">{c.p}</div>
                <div className="vx-tagk">{c.k}</div>
                {planEnabled && (c.inStock === false ? (
                  <button className="vx-add vx-notify" onClick={() => openStockAlert(c.n)}>
                    🔔 Notify me
                  </button>
                ) : (
                  <button className="vx-add" onClick={() => setCart((prev) => [...prev, { name: c.n, price: c.p }])}>
                    Add to bag
                  </button>
                ))}
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
              <button className="vx-x" onClick={closeChat}>×</button>
            </div>

            <div className="vx-body" ref={bodyRef}>
              <div className="vx-msg vx-bot" dangerouslySetInnerHTML={{ __html: brand.greeting }} />
              {messages.map((m, i) => {
                if (m.role === "user") {
                  if (m.silent) return null;
                  return (
                    <div className="vx-msg vx-user" key={i}>
                      {m.image && <img src={m.image} alt="attachment" className="vx-att" />}
                      {m.content && <div>{m.content}</div>}
                    </div>
                  );
                }
                if (m.analyzing) {
                  return (
                    <div className="vx-analysis vx-analyzing" key={i}>
                      <span className="vx-spin" /> Nexus AI is analysing the photo…
                    </div>
                  );
                }
                if (m.received) {
                  // Calm, customer-safe confirmation. The AI's internal score/verdict is never shown here —
                  // it goes only to the CS email + the admin dashboard.
                  return (
                    <div className="vx-analysis" key={i}>
                      <div className="vx-an-head">✅ Photo received</div>
                      <div className="vx-an-desc" style={{ marginBottom: 0 }}>
                        Thanks — I've logged your photo with your case and passed it to our team to review. You'll hear back shortly.
                      </div>
                    </div>
                  );
                }
                if (m.styling) {
                  const ty = m.styling;
                  return (
                    <div className="vx-tryon" key={i}>
                      <div className="vx-ty-head">💎 Your Éclat Style Read</div>
                      <div className="vx-ty-chips">
                        {ty.skinTone && ty.skinTone !== "unknown" && <span className="vx-ty-chip">{ty.skinTone} tone</span>}
                        {ty.style && <span className="vx-ty-chip">{ty.style}</span>}
                        {ty.metal && <span className="vx-ty-chip vx-ty-metal">{ty.metal}</span>}
                      </div>
                      {ty.metalWhy && <div className="vx-ty-why">{ty.metalWhy}</div>}
                      <div className="vx-ty-list">
                        {(ty.recommended || []).map((p, k) => (
                          <div className="vx-ty-item" key={k}>
                            <div className="vx-ty-name">{p.name} <span className="vx-ty-price">{p.price}</span></div>
                            {p.howItLooks && <div className="vx-ty-look">{p.howItLooks}</div>}
                            {p.why && <div className="vx-ty-reason">{p.why}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                if (m.decor) {
                  const dc = m.decor;
                  return (
                    <div className="vx-tryon" key={i}>
                      <div className="vx-ty-head">🎨 Your Decor Match</div>
                      <div className="vx-ty-chips">
                        <span className="vx-ty-chip vx-ty-metal">{dc.matchedTheme}</span>
                        {dc.suggestedTheatre && <span className="vx-ty-chip">{dc.suggestedTheatre}</span>}
                      </div>
                      <div className="vx-ty-look">{dc.customerMessage}</div>
                    </div>
                  );
                }
                if (m.reportCard && report) {
                  const rep = report;
                  const band = rep.score >= 75 ? "Glowing" : rep.score >= 55 ? "Good base" : "Needs some love";
                  const scoreColor = rep.score >= 75 ? "#4a8a52" : rep.score >= 55 ? t.leather : "#b5723a";
                  return (
                    <div className="vx-report-wrap" key={i}>
                      <div className={"vx-report" + (rep.unlocked ? "" : " vx-locked")}>
                        <div className="vx-rep-head">✨ Your KorinMi Skin Report</div>
                        <div className="vx-rep-score">
                          <div className="vx-rep-ring" style={{ ["--sc"]: rep.score, color: scoreColor }}>
                            <span>{rep.score}<small>/100</small></span>
                          </div>
                          <div className="vx-rep-scoretext">
                            <b style={{ color: scoreColor }}>{band}</b>
                            <span>{rep.source === "quiz" ? "Based on your quiz" : "Read from your photo"}</span>
                          </div>
                        </div>
                        {rep.metrics && (
                          <div className="vx-rep-metrics">
                            {[["Hydration", rep.metrics.hydration], ["Evenness", rep.metrics.evenness], ["Clarity", rep.metrics.clarity]].map(([lab, val]) => (
                              <div className="vx-rep-metric" key={lab}>
                                <div className="vx-rep-mlabel">{lab}<span>{val}</span></div>
                                <div className="vx-rep-mbar"><div style={{ width: val + "%" }} /></div>
                              </div>
                            ))}
                          </div>
                        )}
                        {(rep.observations || []).length > 0 && (
                          <>
                            <div className="vx-rep-sec">What we noticed</div>
                            <div className="vx-rep-list">
                              {rep.observations.slice(0, 4).map((o, k) => (
                                <div className="vx-rep-item" key={k}>• {o.concern}{o.note ? ` — ${o.note}` : ""}</div>
                              ))}
                            </div>
                          </>
                        )}
                        <div className="vx-rep-sec">Your matched kit</div>
                        <div className="vx-rep-list">
                          {(rep.recommended || []).map((p, k) => (
                            <div className="vx-rep-item vx-rep-kit" key={k}>{p}</div>
                          ))}
                        </div>
                      </div>

                      {!rep.unlocked && (
                        <div className="vx-report-gate">
                          <div className="vx-gate-lock">🔒</div>
                          <div className="vx-gate-title">Enter your details to unlock your full plan + kit</div>
                          <input placeholder="Name" value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} />
                          <input placeholder="Email" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} />
                          <input placeholder="Mobile (10-digit)" value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} />
                          <label className="vx-gate-wa">
                            <input type="checkbox" checked={lead.waOptIn} onChange={(e) => setLead({ ...lead, waOptIn: e.target.checked })} />
                            <span>Send me offers on WhatsApp</span>
                          </label>
                          <button onClick={unlockReport} disabled={rep.sending}>
                            {rep.sending ? "Unlocking…" : "Unlock my full plan + kit ✨"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={i}>
                    <div className="vx-msg vx-bot" dangerouslySetInnerHTML={{ __html: linkifyBot(m.content) }} />
                    {m.escalate && (
                      <div className="vx-esc" style={{ marginTop: 8 }}>
                        <b>↗ Handed to the {brand.name} team</b><br />
                        A team member will personally follow up — no automated dead-ends.
                      </div>
                    )}
                  </div>
                );
              })}
              {typing && (<div className="vx-typing"><span /><span /><span /></div>)}
            </div>

            {showChips && (
              <div className="vx-chips">
                {brand.chips.map((c) => (
                  <div className="vx-chip" key={c.q} onClick={() => send(c.q)}>{c.label}</div>
                ))}
              </div>
            )}

            {planEnabled && <input type="file" accept="image/*" ref={skinFileRef} onChange={onPickSkinPhoto} style={{ display: "none" }} />}
            {planEnabled && <input type="file" accept="image/*" capture="environment" ref={skinCamRef} onChange={onPickSkinPhoto} style={{ display: "none" }} />}

            {planEnabled && !planView && !stockAlert && (
              <button className="vx-plan-cta" onClick={startPlan}>✨ Get my free KorinMi Skin Report</button>
            )}

            {planEnabled && planView === "intro" && (
              <div className="vx-lead">
                <div className="vx-lead-hint">📷 Add a skin / hair photo — best result</div>
                <div className="vx-photo-opts">
                  <button className="vx-lead-photo" onClick={openSkinCamera}>📷 Take photo</button>
                  <button className="vx-lead-photo" onClick={() => skinFileRef.current?.click()}>🖼️ Upload</button>
                </div>
                <button onClick={startQuiz}>📝 No photo? Take the 30-second quiz</button>
                <button className="vx-lead-photo" onClick={() => setPlanView(null)}>Maybe later</button>
              </div>
            )}

            {planEnabled && planView === "quiz" && quiz && (() => {
              const steps = brand.plan?.quiz || [];
              const cur = steps[quiz.step];
              if (!cur) return null;
              return (
                <div className="vx-lead vx-quiz">
                  <div className="vx-quiz-prog">Question {quiz.step + 1} of {steps.length}</div>
                  <div className="vx-quiz-q">{cur.q}</div>
                  <div className="vx-quiz-opts">
                    {cur.options.map((o) => (
                      <button key={o.value} className="vx-quiz-opt" onClick={() => answerQuiz(o)}>{o.label}</button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {planEnabled && stockAlert && (
              <div className="vx-lead">
                {stockAlert.sent ? (
                  <>
                    <div className="vx-ty-soft">Done ✓ We'll email/message you the moment “{stockAlert.product}” is back.</div>
                    <button onClick={() => setStockAlert(null)}>Close</button>
                  </>
                ) : (
                  <>
                    <div className="vx-quiz-q" style={{ fontSize: 14 }}>🔔 Notify me — {stockAlert.product}</div>
                    <input placeholder="Email" value={stockAlert.email} onChange={(e) => setStockAlert({ ...stockAlert, email: e.target.value })} />
                    <input placeholder="Mobile (10-digit)" value={stockAlert.phone} onChange={(e) => setStockAlert({ ...stockAlert, phone: e.target.value })} />
                    <label className="vx-gate-wa">
                      <input type="checkbox" checked={stockAlert.waOptIn} onChange={(e) => setStockAlert({ ...stockAlert, waOptIn: e.target.checked })} />
                      <span>Send me offers on WhatsApp</span>
                    </label>
                    <button onClick={submitStockAlert}>Notify me when it's back</button>
                    <button className="vx-lead-photo" onClick={() => setStockAlert(null)}>Cancel</button>
                  </>
                )}
              </div>
            )}

            {tryonEnabled && <input type="file" accept="image/*" ref={handFileRef} onChange={onPickHandPhoto} style={{ display: "none" }} />}

            {tryonEnabled && !tryon && (
              <button className="vx-plan-cta" onClick={startTryon}>💎 Virtual Try-On — see a ring on your hand</button>
            )}

            {tryonEnabled && tryon && tryon.stage === "form" && (
              <div className="vx-lead">
                <label className="vx-ty-consent">
                  <input type="checkbox" checked={tryon.form.consent}
                    onChange={(e) => setTryon((s) => ({ ...s, form: { ...s.form, consent: e.target.checked } }))} />
                  <span>Store this try-on &amp; name it? (helps us remember)</span>
                </label>
                {tryon.form.consent && (
                  <input placeholder='Name your try-on (e.g. "My engagement ring idea")' value={tryon.form.name}
                    onChange={(e) => setTryon((s) => ({ ...s, form: { ...s.form, name: e.target.value } }))} />
                )}
                <div className="vx-ty-soft">So we can save this for you 💎</div>
                <input placeholder="Email" value={tryon.form.email}
                  onChange={(e) => setTryon((s) => ({ ...s, form: { ...s.form, email: e.target.value } }))} />
                <input placeholder="Mobile (10-digit)" value={tryon.form.phone}
                  onChange={(e) => setTryon((s) => ({ ...s, form: { ...s.form, phone: e.target.value } }))} />
                <button onClick={renderTryons}>See my try-on ✨</button>
                <button className="vx-lead-photo" onClick={() => setTryon(null)}>Cancel</button>
              </div>
            )}

            {tryonEnabled && tryon && tryon.stage === "rendering" && (
              <div className="vx-lead"><div className="vx-ty-soft">Placing your rings… 💎</div></div>
            )}

            {tryonEnabled && tryon && tryon.stage === "results" && !tryon.editing && (
              <div className="vx-lead">
                <div className="vx-ty-previews">
                  {tryon.overlays.map((o, k) => (
                    <div className="vx-ty-preview" key={k}>
                      <img src={o.dataUrl} alt={o.ringName} />
                      <div className="vx-ty-pname">{o.ringName}</div>
                      <div className="vx-ty-pprice">{o.price}</div>
                    </div>
                  ))}
                </div>
                <button className="vx-lead-photo" onClick={openAdjust}>✥ Adjust fit</button>
                {tryon.saved ? (
                  <div className="vx-ty-soft">Saved to your profile ✓</div>
                ) : (
                  <button onClick={saveTryon} disabled={tryon.saving}>
                    {tryon.saving ? "Saving…" : "💾 Save to my profile"}
                  </button>
                )}
                <button className="vx-lead-photo" onClick={() => setTryon(null)}>Done</button>
              </div>
            )}

            {tryonEnabled && tryon && tryon.editing && tryon.adjust && (brand.tryonRings || []).length > 0 && (
              (() => {
                const ring = brand.tryonRings[0];
                const p = tryon.placement, a = tryon.adjust;
                const baseDeg = (p.angle * 180) / Math.PI;
                const ringStyle = {
                  position: "absolute",
                  left: (a.cx / p.imgW) * 100 + "%",
                  top: (a.cy / p.imgH) * 100 + "%",
                  width: ((p.fingerWidth * (ring.scale || 1.25) * a.scaleMul) / p.imgW) * 100 + "%",
                  transform: `translate(-50%,-50%) rotate(${baseDeg + a.angleDeg}deg)`,
                };
                return (
                  <div className="vx-lead">
                    <div className="vx-ty-soft">Drag the ring to reposition · sliders to size &amp; rotate ({ring.name})</div>
                    <div className="vx-ty-stage" ref={tryEditRef}>
                      <img src={tryon.handPhoto} className="vx-ty-hand" alt="your hand" draggable={false} />
                      <img src={ring.img} className="vx-ty-ring" style={ringStyle} alt={ring.name} draggable={false}
                        onPointerDown={onRingDown} onPointerMove={onRingMove} onPointerUp={onRingUp} onPointerCancel={onRingUp} />
                    </div>
                    <label className="vx-ty-slider">Size
                      <input type="range" min="0.6" max="1.8" step="0.02" value={a.scaleMul}
                        onChange={(e) => setTryon((s) => ({ ...s, adjust: { ...s.adjust, scaleMul: parseFloat(e.target.value) } }))} />
                    </label>
                    <label className="vx-ty-slider">Rotate
                      <input type="range" min="-45" max="45" step="1" value={a.angleDeg}
                        onChange={(e) => setTryon((s) => ({ ...s, adjust: { ...s.adjust, angleDeg: parseFloat(e.target.value) } }))} />
                    </label>
                    <button onClick={applyAdjust}>Apply to all 3 ✨</button>
                    <button className="vx-lead-photo" onClick={cancelAdjust}>Cancel</button>
                  </div>
                );
              })()
            )}

            {planEnabled && camera && (
              <div className="vx-cam">
                <div className="vx-cam-inner">
                  <video ref={camVideoRef} autoPlay playsInline muted className="vx-cam-video" />
                  <div className="vx-cam-actions">
                    <button className="vx-cam-shot" onClick={captureSkinPhoto}>📷 Capture</button>
                    <button className="vx-lead-photo" onClick={closeSkinCamera}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            <div className="vx-input">
              <input type="file" accept="image/*" ref={fileRef} onChange={onPickPhoto} style={{ display: "none" }} />
              <button className="vx-clip" onClick={() => fileRef.current?.click()} aria-label="Attach photo" title="Attach a photo">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
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
  if (typeof document !== "undefined" && !document.getElementById("vx-fonts")) {
    const link = document.createElement("link");
    link.id = "vx-fonts"; link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500&display=swap";
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
    .vx-card .img { aspect-ratio:3/4; background:linear-gradient(150deg,${t.tile1},${t.tile2}); border-radius:2px; display:flex; align-items:flex-end; justify-content:center; overflow:hidden; }
    .vx-prod { width:100%; height:100%; object-fit:cover; display:block; }
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
    .vx-link { color:${t.leather}; font-weight:600; text-decoration:underline; text-underline-offset:2px; word-break:break-word; }
    .vx-bot .vx-link:hover { color:${t.leatherDark}; }
    .vx-att { display:block; max-width:180px; border-radius:10px; margin-bottom:6px; border:2px solid rgba(255,255,255,.4); }
    .vx-esc { align-self:stretch; background:rgba(122,125,90,.1); border:1px dashed ${t.sage}; border-radius:8px; padding:10px 13px; font-size:12.5px; color:#5a5d3e; }
    .vx-esc b { color:${t.sage}; }
    .vx-analysis { align-self:flex-start; max-width:90%; background:#fff; border:1px solid ${t.line}; border-left:3px solid ${t.leather}; border-radius:10px; padding:12px 14px; font-size:13px; color:#3a322b; box-shadow:0 4px 14px rgba(43,36,32,.06); }
    .vx-analyzing { display:flex; align-items:center; gap:9px; color:#8a7d6e; font-style:italic; }
    .vx-spin { width:14px; height:14px; border:2px solid ${t.line}; border-top-color:${t.leather}; border-radius:50%; animation:vxspin .7s linear infinite; }
    @keyframes vxspin { to { transform:rotate(360deg); } }
    .vx-an-head { font-weight:600; font-size:12px; letter-spacing:.04em; color:${t.leatherDark}; margin-bottom:9px; }
    .vx-an-row { display:flex; align-items:center; gap:8px; margin-bottom:7px; flex-wrap:wrap; }
    .vx-an-badge { font-size:11px; font-weight:600; padding:3px 9px; border-radius:20px; }
    .vx-an-sev { font-size:11.5px; color:#8a7d6e; text-transform:capitalize; }
    .vx-an-desc { font-size:12.5px; color:#5a5048; margin-bottom:11px; line-height:1.4; }
    .vx-an-score { display:flex; align-items:center; gap:10px; }
    .vx-an-bar { flex:1; height:8px; background:#f0e9da; border-radius:6px; overflow:hidden; }
    .vx-an-fill { height:100%; border-radius:6px; transition:width .6s cubic-bezier(.2,.8,.2,1); }
    .vx-an-num { font-weight:700; font-size:16px; }
    .vx-an-num small { font-size:10px; font-weight:500; opacity:.6; }
    .vx-an-band { margin-top:8px; font-size:11.5px; font-weight:600; }
    .vx-chips { display:flex; flex-wrap:wrap; gap:7px; padding:0 18px 12px; }
    .vx-chip { background:#fff; border:1px solid ${t.line}; border-radius:18px; padding:7px 13px; font-size:12px; color:${t.leather}; cursor:pointer; font-family:'Jost',sans-serif; transition:all .18s; }
    .vx-chip:hover { background:${t.leather}; color:${t.cream}; }
    .vx-typing { align-self:flex-start; display:flex; gap:4px; padding:12px 14px; background:#fff; border:1px solid ${t.line}; border-radius:4px 14px 14px 14px; }
    .vx-typing span { width:7px; height:7px; border-radius:50%; background:${t.tan}; animation:vxblink 1.3s infinite; }
    .vx-typing span:nth-child(2){animation-delay:.2s;} .vx-typing span:nth-child(3){animation-delay:.4s;}
    @keyframes vxblink { 0%,60%,100%{opacity:.3;} 30%{opacity:1;} }
    .vx-input { border-top:1px solid ${t.line}; padding:12px 14px; display:flex; gap:9px; align-items:center; background:#fff; }
    .vx-input input[type=text], .vx-input input:not([type]) { flex:1; border:none; outline:none; font-family:'Jost',sans-serif; font-size:14px; color:${t.ink}; background:transparent; }
    .vx-clip { background:transparent; border:none; color:${t.tan}; width:34px; height:34px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .18s; }
    .vx-clip:hover { background:${t.tile1}; color:${t.leather}; }
    .vx-send { background:${t.leather}; border:none; color:${t.cream}; width:38px; height:38px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; }
    .vx-powered { text-align:center; font-size:10px; letter-spacing:.12em; color:#b3a695; padding:7px; background:#fff; text-transform:uppercase; }
    .vx-powered b { color:${t.leather}; font-weight:500; }
    .vx-add { margin-top:10px; width:100%; background:transparent; border:1px solid ${t.leather}; color:${t.leather}; border-radius:6px; padding:7px; font-size:12px; font-family:'Jost',sans-serif; cursor:pointer; transition:all .18s; }
    .vx-add:hover { background:${t.leather}; color:${t.cream}; }
    .vx-cartpill { position:fixed; top:14px; right:24px; background:${t.leather}; color:${t.cream}; border-radius:20px; padding:7px 14px; font-size:12.5px; font-family:'Jost',sans-serif; z-index:55; box-shadow:0 6px 18px rgba(43,36,32,.25); }
    .vx-plan-cta { margin:0 14px 10px; background:linear-gradient(135deg,${t.leather},${t.leatherDark}); color:${t.cream}; border:none; border-radius:10px; padding:11px; font-weight:600; font-size:13px; font-family:'Jost',sans-serif; cursor:pointer; }
    .vx-lead { display:flex; flex-direction:column; gap:6px; padding:10px 14px; background:#fff; border-top:1px solid ${t.line}; }
    .vx-lead input { border:1px solid ${t.line}; border-radius:8px; padding:8px 10px; font-size:13px; font-family:'Jost',sans-serif; outline:none; }
    .vx-lead button { background:${t.leather}; color:#fff; border:none; border-radius:8px; padding:9px; font-weight:600; cursor:pointer; font-family:'Jost',sans-serif; }
    .vx-lead .vx-lead-photo { background:${t.tile1}; color:${t.leatherDark}; }
    .vx-lead-hint { font-size:12px; color:#6f655b; text-align:center; padding:2px 0; }
    .vx-photo-opts { display:flex; gap:6px; }
    .vx-photo-opts button { flex:1; }
    .vx-cam { position:absolute; inset:0; z-index:70; background:rgba(20,17,14,.94); display:flex; align-items:center; justify-content:center; padding:16px; }
    .vx-cam-inner { width:100%; display:flex; flex-direction:column; gap:10px; }
    .vx-cam-video { width:100%; max-height:440px; border-radius:12px; background:#000; object-fit:cover; transform:scaleX(-1); }
    .vx-cam-actions { display:flex; gap:8px; }
    .vx-cam-actions button { flex:1; border:none; border-radius:8px; padding:11px; font-weight:600; cursor:pointer; font-family:'Jost',sans-serif; }
    .vx-cam-shot { background:${t.leather}; color:#fff; }
    .vx-tryon { align-self:flex-start; max-width:92%; background:#fff; border:1px solid ${t.line}; border-left:3px solid ${t.leather}; border-radius:10px; padding:13px 15px; font-size:13px; color:#3a322b; box-shadow:0 4px 14px rgba(43,36,32,.06); }
    .vx-ty-head { font-family:'Cormorant Garamond',serif; font-weight:600; font-size:16px; color:${t.leatherDark}; margin-bottom:10px; }
    .vx-ty-chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:9px; }
    .vx-ty-chip { font-size:11px; padding:3px 9px; border-radius:20px; background:${t.tile1}; color:${t.leatherDark}; text-transform:capitalize; }
    .vx-ty-chip.vx-ty-metal { background:${t.leather}; color:${t.cream}; }
    .vx-ty-why { font-size:12px; color:#6f655b; font-style:italic; margin-bottom:11px; line-height:1.4; }
    .vx-ty-list { display:flex; flex-direction:column; gap:10px; }
    .vx-ty-item { border-top:1px solid ${t.line}; padding-top:9px; }
    .vx-ty-item:first-child { border-top:none; padding-top:0; }
    .vx-ty-name { font-weight:600; font-size:13.5px; color:${t.ink}; }
    .vx-ty-price { color:${t.leather}; font-weight:500; font-size:12.5px; margin-left:4px; }
    .vx-ty-look { font-size:12.5px; color:#5a5048; margin-top:3px; line-height:1.4; }
    .vx-ty-reason { font-size:12px; color:#8a7d6e; margin-top:2px; line-height:1.4; }
    .vx-ty-consent { display:flex; align-items:flex-start; gap:8px; font-size:12.5px; color:#5a5048; cursor:pointer; line-height:1.35; }
    .vx-ty-consent input { width:16px; height:16px; margin-top:1px; accent-color:${t.leather}; flex:0 0 auto; }
    .vx-ty-soft { font-size:11.5px; color:#8a7d6e; font-style:italic; }
    .vx-lead button:disabled { opacity:.6; cursor:default; }
    .vx-ty-previews { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
    .vx-ty-preview { text-align:center; }
    .vx-ty-preview img { width:100%; aspect-ratio:1/1; object-fit:cover; border-radius:8px; border:1px solid ${t.line}; display:block; }
    .vx-ty-pname { font-size:10.5px; color:${t.ink}; margin-top:4px; line-height:1.2; }
    .vx-ty-pprice { font-size:10.5px; color:${t.leather}; }
    .vx-ty-stage { position:relative; width:100%; border-radius:10px; overflow:hidden; border:1px solid ${t.line}; background:#000; touch-action:none; user-select:none; }
    .vx-ty-hand { display:block; width:100%; height:auto; pointer-events:none; }
    .vx-ty-ring { cursor:grab; touch-action:none; }
    .vx-ty-ring:active { cursor:grabbing; }
    .vx-ty-slider { display:flex; align-items:center; gap:10px; font-size:12px; color:#5a5048; }
    .vx-ty-slider input[type=range] { flex:1; accent-color:${t.leather}; }
    /* --- Back-in-stock (storefront) --- */
    .vx-card .img { position:relative; }
    .vx-oos { position:absolute; top:8px; left:8px; z-index:2; background:rgba(35,32,26,.82); color:${t.cream}; font-size:10px; letter-spacing:.1em; text-transform:uppercase; padding:4px 8px; border-radius:20px; }
    .vx-notify { border-color:${t.tan}; color:${t.tan}; }
    .vx-notify:hover { background:${t.tan}; color:${t.cream}; }
    /* --- Blurred Skin Report + lead gate --- */
    .vx-report-wrap { position:relative; align-self:stretch; margin:2px 0; }
    .vx-report { background:#fff; border:1px solid ${t.line}; border-radius:12px; padding:15px 16px; box-shadow:0 4px 16px rgba(43,36,32,.07); }
    .vx-report.vx-locked { filter:blur(6px); pointer-events:none; user-select:none; }
    .vx-rep-head { font-family:'Cormorant Garamond',serif; font-weight:600; font-size:17px; color:${t.leatherDark}; margin-bottom:12px; }
    .vx-rep-score { display:flex; align-items:center; gap:14px; margin-bottom:12px; }
    .vx-rep-ring { position:relative; width:64px; height:64px; border-radius:50%; flex:0 0 auto; background:conic-gradient(currentColor calc(var(--sc)*1%), #efe7d6 0); display:flex; align-items:center; justify-content:center; }
    .vx-rep-ring::after { content:""; position:absolute; inset:6px; background:#fff; border-radius:50%; }
    .vx-rep-ring span { position:relative; z-index:1; font-weight:700; font-size:19px; color:${t.ink}; }
    .vx-rep-ring span small { font-size:9px; font-weight:500; opacity:.55; }
    .vx-rep-scoretext { display:flex; flex-direction:column; gap:2px; }
    .vx-rep-scoretext b { font-size:15px; }
    .vx-rep-scoretext span { font-size:11.5px; color:#8a7d6e; }
    .vx-rep-metrics { display:flex; flex-direction:column; gap:8px; margin-bottom:12px; }
    .vx-rep-mlabel { display:flex; justify-content:space-between; font-size:11.5px; color:#5a5048; margin-bottom:3px; }
    .vx-rep-mbar { height:7px; background:#f0e9da; border-radius:6px; overflow:hidden; }
    .vx-rep-mbar div { height:100%; background:linear-gradient(90deg,${t.leather},${t.tan}); border-radius:6px; }
    .vx-rep-sec { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:${t.sage}; margin:10px 0 6px; }
    .vx-rep-list { display:flex; flex-direction:column; gap:5px; }
    .vx-rep-item { font-size:12.5px; color:#5a5048; line-height:1.4; }
    .vx-rep-kit { background:${t.tile1}; border-radius:6px; padding:6px 9px; color:${t.leatherDark}; font-weight:500; }
    .vx-report-gate { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; gap:7px; padding:18px 16px; background:rgba(255,253,248,.78); border:1px solid ${t.line}; border-radius:12px; }
    .vx-gate-lock { text-align:center; font-size:22px; }
    .vx-gate-title { text-align:center; font-weight:600; font-size:13.5px; color:${t.leatherDark}; line-height:1.35; margin-bottom:2px; }
    .vx-report-gate input[type=text], .vx-report-gate input:not([type]) { border:1px solid ${t.line}; border-radius:8px; padding:8px 10px; font-size:13px; font-family:'Jost',sans-serif; outline:none; background:#fff; }
    .vx-report-gate > button { background:${t.leather}; color:#fff; border:none; border-radius:8px; padding:10px; font-weight:600; cursor:pointer; font-family:'Jost',sans-serif; }
    .vx-report-gate > button:disabled { opacity:.6; cursor:default; }
    .vx-gate-wa { display:flex; align-items:center; gap:8px; font-size:12px; color:#5a5048; cursor:pointer; }
    .vx-gate-wa input { width:16px; height:16px; accent-color:${t.leather}; flex:0 0 auto; }
    /* --- Quiz --- */
    .vx-quiz-prog { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:${t.sage}; }
    .vx-quiz-q { font-size:14px; font-weight:500; color:${t.ink}; margin:2px 0 4px; }
    .vx-quiz-opts { display:flex; flex-direction:column; gap:6px; }
    .vx-quiz-opt { background:#fff !important; color:${t.leather} !important; border:1px solid ${t.line} !important; border-radius:8px; padding:9px 12px; font-size:13px; font-family:'Jost',sans-serif; cursor:pointer; text-align:left; font-weight:400 !important; transition:all .16s; }
    .vx-quiz-opt:hover { background:${t.leather} !important; color:${t.cream} !important; border-color:${t.leather} !important; }
  `;
}