// app/api/chat/route.js
// Secure server-side handler for Nexus AI. The API key NEVER touches the browser.
// Enterprise layer (all best-effort — Firestore hiccups can never break the chat):
//   • IP rate limit 50/day + abuse flag  (Firestore `ratelimit`)
//   • RAG: inject relevant knowledge-base facts (Firestore `kb`)  [KorinMi]
//   • Live order status read (Firestore `orders`) + order-action writes  [KorinMi]

import { getBrand } from "../../../lib/brands";
import { getDb } from "../../lib/firebase-admin";
import { sweepAbandoned } from "../../lib/bingetown-abandon";

export const runtime = "nodejs"; // firebase-admin needs Node

const DAILY_LIMIT = 50;

function clientIp(request) {
  const xff = request.headers.get("x-forwarded-for") || "";
  const ip = xff.split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
  return ip.replace(/[^a-zA-Z0-9_.:-]/g, "_") || "local";
}

// Atomic per-IP/day counter. Returns { limited, abuse }. Never throws.
async function checkRateLimit(ip) {
  try {
    const db = getDb();
    const date = new Date().toISOString().slice(0, 10);
    const ref = db.collection("ratelimit").doc(`${ip}_${date}`);
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = (snap.exists ? snap.data().count : 0) || 0;
      if (count >= DAILY_LIMIT) {
        tx.set(ref, { ip, date, count: count + 1, abuse: true, updatedAt: new Date().toISOString() }, { merge: true });
        return { limited: true, abuse: true };
      }
      tx.set(ref, { ip, date, count: count + 1, abuse: false, updatedAt: new Date().toISOString() }, { merge: true });
      return { limited: false, abuse: false };
    });
  } catch {
    return { limited: false, abuse: false }; // fail open — never block a real customer on infra error
  }
}

// RAG — pull the most relevant KB facts for the last user message (KorinMi KB only).
async function ragBlock(brand, messages) {
  if (brand !== "korinmi") return "";
  try {
    const db = getDb();
    const snap = await db.collection("kb").get();
    if (snap.empty) return "";
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content?.toLowerCase() || "";
    const words = lastUser.split(/\W+/).filter((w) => w.length > 3);
    const scored = snap.docs.map((d) => {
      const doc = d.data();
      const hay = `${doc.topic || ""} ${doc.text || ""}`.toLowerCase();
      const score = words.reduce((s, w) => (hay.includes(w) ? s + 1 : s), 0);
      return { text: doc.text || "", score };
    }).filter((x) => x.text);
    const top = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    const chosen = top.length ? top : scored.slice(0, 2); // always give a little grounding
    if (!chosen.length) return "";
    return "\n\n=== KNOWLEDGE BASE (verified facts you may use; still never invent beyond them) ===\n" +
      chosen.map((x) => "- " + x.text).join("\n");
  } catch {
    return "";
  }
}

// Live order status from Firestore — authoritative over the prompt's static list (KorinMi).
async function ordersBlock(brand) {
  if (brand !== "korinmi") return "";
  try {
    const db = getDb();
    const snap = await db.collection("orders").get();
    if (snap.empty) return "";
    const lines = snap.docs.map((d) => {
      const o = d.data();
      return `${d.id} — ${o.item || "item"}${o.price ? " ₹" + o.price : ""} — ${o.status || "?"}${o.awb ? " — " + o.awb : ""}${o.note ? " · " + o.note : ""}`;
    });
    return "\n\n=== LIVE ORDER STATUS (authoritative — use this over the static list above if they differ) ===\n" + lines.join("\n");
  } catch {
    return "";
  }
}

// Live bookings from Firestore (bingetown) — authoritative; injected so the bot can
// verify identity (booking ID + phone) and never invents booking data. Best-effort.
async function bingetownBookingsBlock(brand) {
  if (brand !== "bingetown") return "";
  try {
    const db = getDb();
    const snap = await db.collection("bookings").where("brand", "==", "bingetown").get();
    if (snap.empty) return "";
    const lines = snap.docs.map((d) => {
      const o = d.data();
      const add = Array.isArray(o.addOns) && o.addOns.length ? " · add-ons: " + o.addOns.join(", ") : "";
      return `${o.bookingId || d.id} — ${o.name || "guest"} · phone ${o.phone || "?"} · ${o.branchName || o.branch || "?"} (${o.city || "?"}) · ${o.theatre || "?"} · ${o.occasion || "?"} · ${o.date || "?"} ${o.slot || ""} · ${o.status || "?"}${o.amount ? " · ₹" + o.amount : ""}${add}${o.csat ? " · CSAT " + o.csat + "/5" : ""}`;
    });
    return "\n\n=== LIVE BOOKINGS (authoritative — verify booking ID + phone before revealing or changing any of these; never invent one beyond this list) ===\n" + lines.join("\n");
  } catch {
    return "";
  }
}

// Generate a fresh BT-#### booking id that doesn't collide with an existing booking.
// Kept clear of the seeded 28xx range. Best-effort — falls back to a time-based id.
async function newBingetownBookingId(db) {
  for (let i = 0; i < 6; i++) {
    const id = "BT-" + Math.floor(3000 + Math.random() * 6999); // 3000-9998
    try {
      const snap = await db.collection("bookings").doc(id).get();
      if (!snap.exists) return id;
    } catch {
      return id; // existence check failed → just use it
    }
  }
  return "BT-" + Date.now().toString().slice(-4);
}

// Parse the model's silent tokens, persist to Firestore (namespaced brand:"bingetown"),
// then strip every token from the reply so the guest never sees them. Best-effort — a
// Firestore hiccup can never break the chat.
async function applyBingetownTokens(brand, reply) {
  if (brand !== "bingetown") return reply;
  const now = new Date().toISOString();
  const jsonAfter = (tok) => [...reply.matchAll(new RegExp("\\[" + tok + "\\]\\s*(\\{[^{}]*\\})", "gi"))];
  let newBookingId = null; // the id of a booking we create this turn → drives the inline /pay link
  try {
    const db = getDb();
    // RESCHEDULE — update an existing seeded booking
    for (const m of jsonAfter("RESCHEDULE")) {
      try {
        const d = JSON.parse(m[1]);
        if (d.bookingId) {
          const ref = db.collection("bookings").doc(String(d.bookingId).toUpperCase());
          const snap = await ref.get();
          if (snap.exists && snap.data().brand === "bingetown") {
            await ref.set({ date: d.date || snap.data().date, slot: d.slot || snap.data().slot, status: "Rescheduled", updatedAt: now }, { merge: true });
          }
        }
      } catch {}
    }
    // BOOKING — a new booking confirmed in chat. Create it IMMEDIATELY with a real BT-#### id
    // and status "Pending Advance" so the guest can pay right away via the inline /pay link, and
    // so the admin panel + abandon sweep can track it. First created id drives the inline link.
    for (const m of jsonAfter("BOOKING")) {
      try {
        const d = JSON.parse(m[1]);
        const id = await newBingetownBookingId(db);
        await db.collection("bookings").doc(id).set({
          brand: "bingetown", bookingId: id, status: "Pending Advance", source: "chat", ...d, createdAt: now,
        });
        if (!newBookingId) newBookingId = id;
      } catch {}
    }
    // LEAD — interested, not yet booked
    for (const m of jsonAfter("LEAD")) {
      try { const d = JSON.parse(m[1]); await db.collection("leads").add({ brand: "bingetown", tag: "warm", source: "whatsapp", ...d, createdAt: now }); } catch {}
    }
    // UPSELL — add-ons accepted
    for (const m of jsonAfter("UPSELL")) {
      try { const d = JSON.parse(m[1]); await db.collection("upsells").add({ brand: "bingetown", ...d, createdAt: now }); } catch {}
    }
    // CSAT — post-event rating (also stamped onto the booking)
    for (const m of jsonAfter("CSAT")) {
      try {
        const d = JSON.parse(m[1]);
        await db.collection("csat").add({ brand: "bingetown", ...d, createdAt: now });
        if (d.bookingId) {
          const ref = db.collection("bookings").doc(String(d.bookingId).toUpperCase());
          const snap = await ref.get();
          if (snap.exists) await ref.set({ csat: Number(d.score) || null, updatedAt: now }, { merge: true });
        }
      } catch {}
    }
    // REMINDER — day-before WhatsApp reminder intent
    for (const m of jsonAfter("REMINDER")) {
      try { const d = JSON.parse(m[1]); await db.collection("reminders").add({ brand: "bingetown", ...d, createdAt: now }); } catch {}
    }
    // ESCALATE — human handoff (reason optional JSON)
    for (const m of [...reply.matchAll(/\[ESCALATE\]\s*(\{[^{}]*\})?/gi)]) {
      try { const d = m[1] ? JSON.parse(m[1]) : {}; await db.collection("escalations").add({ brand: "bingetown", reason: d.reason || "", createdAt: now }); } catch {}
    }
  } catch {}
  // Turn the model's /pay/NEW placeholder into a working inline link for the booking we just
  // created (fallback: append one if the model forgot). If no booking was created this turn,
  // never leave a dangling placeholder behind.
  let out = reply;
  if (newBookingId) {
    if (/\/pay\/NEW\b/i.test(out)) {
      out = out.replace(/\/pay\/NEW\b/gi, "/pay/" + newBookingId);
    } else if (!/\/pay\//i.test(out)) {
      out += `\n\nHere's your secure link to pay the ₹750 advance and lock your slot: /pay/${newBookingId}`;
    }
  } else {
    out = out.replace(/\/pay\/NEW\b/gi, "");
  }
  // Strip every token (with or without JSON) so the customer never sees one.
  return out
    .replace(/\[(RESCHEDULE|BOOKING|LEAD|UPSELL|CSAT|REMINDER)\]\s*\{[^{}]*\}/gi, "")
    .replace(/\[ESCALATE\]\s*(\{[^{}]*\})?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Parse + apply order-action tokens the model emits, then strip them from the reply. Best-effort.
async function applyOrderActions(brand, reply) {
  if (brand !== "korinmi") return reply;
  let out = reply;
  const cancels = [...reply.matchAll(/\[ORDER_CANCEL:\s*(KM-\d{4})\s*\]/gi)];
  const edits = [...reply.matchAll(/\[ORDER_EDIT:\s*(KM-\d{4})\s*\|([^|\]]+)\|([^\]]*)\]/gi)];
  if (cancels.length || edits.length) {
    try {
      const db = getDb();
      for (const m of cancels) {
        const id = m[1].toUpperCase();
        const ref = db.collection("orders").doc(id);
        const snap = await ref.get();
        if (snap.exists && (snap.data().status || "").toUpperCase() === "PROCESSING") {
          await ref.set({ status: "CANCELLED", note: "Cancelled by customer via concierge", cancelledAt: new Date().toISOString() }, { merge: true });
        }
      }
      for (const m of edits) {
        const id = m[1].toUpperCase();
        const field = m[2].trim().toLowerCase();
        const value = m[3].trim();
        if (["address", "item", "qty", "quantity"].includes(field) && value) {
          const ref = db.collection("orders").doc(id);
          const snap = await ref.get();
          if (snap.exists && (snap.data().status || "").toUpperCase() === "PROCESSING") {
            await ref.set({ [field]: value, note: `Edited ${field} via concierge`, updatedAt: new Date().toISOString() }, { merge: true });
          }
        }
      }
    } catch {}
  }
  // Strip every token so the customer never sees it.
  out = out.replace(/\[ORDER_CANCEL:[^\]]*\]/gi, "").replace(/\[ORDER_EDIT:[^\]]*\]/gi, "").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

export async function POST(request) {
  try {
    const { messages, brand } = await request.json();

    const brandConfig = getBrand(brand);
    if (!brandConfig) {
      return Response.json({ error: "Unknown brand" }, { status: 400 });
    }
    const slug = (brand || "").toLowerCase();

    // Nudge the abandoned-booking cleanup on activity (best-effort, non-blocking). The admin
    // panel also sweeps on load, so this just keeps things fresh between admin visits.
    if (slug === "bingetown") sweepAbandoned().catch(() => {});

    // ---- Rate limit (best-effort, fail-open) ----
    const ip = clientIp(request);
    const { limited } = await checkRateLimit(ip);
    if (limited) {
      return Response.json({
        reply: "You've reached today's message limit for this demo. ✨ Please drop your email and our team will pick this up with you personally — or come back tomorrow.",
        escalate: true,
        rateLimited: true,
      });
    }

    // ---- Augment the system prompt with live data (RAG + orders + bookings), best-effort ----
    const [kb, orders, bookings] = await Promise.all([
      ragBlock(slug, messages || []),
      ordersBlock(slug),
      bingetownBookingsBlock(slug),
    ]);
    const system = brandConfig.systemPrompt + kb + orders + bookings;

    // ---- Timeout guard: if Claude is slow, we fail gracefully (never a dead chat) ----
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1000,
          system,
          messages,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      return Response.json({ reply: brandConfig.fallback, escalate: true });
    }

    const data = await res.json();
    let reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const escalate = reply.includes("[ESCALATE]");

    // Apply + strip any order-action tokens (real Firestore writes for cancel/edit — KorinMi).
    reply = await applyOrderActions(slug, reply);
    // Apply + strip Binge Town tokens (booking/reschedule/lead/csat/reminder/upsell/escalate writes).
    reply = await applyBingetownTokens(slug, reply);
    // Strip any remaining [ESCALATE] marker (other brands) so it never reaches the customer.
    reply = reply.replace(/\[ESCALATE\]\s*(\{[^{}]*\})?/gi, "").replace(/\n{3,}/g, "\n\n").trim();

    return Response.json({ reply, escalate });
  } catch (err) {
    return Response.json({
      reply:
        "I'm having a brief moment — but I won't leave you waiting. Share your email and a team member will follow up personally.",
      escalate: true,
    });
  }
}
