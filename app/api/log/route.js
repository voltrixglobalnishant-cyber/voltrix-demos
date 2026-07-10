// app/api/log/route.js
// Saves each conversation to Firestore. Completely separate from the chat —
// if anything here fails, the chat keeps working. It also tags the lead
// hot / warm / cold from buying-intent signals in the transcript.

import { getDb } from "../../lib/firebase-admin";

// Strong intent → hot. Softer interest → warm. Nothing → cold.
const HOT_WORDS = ["buy", "purchase", "order now", "checkout", "book", "booking", "sign up", "how much", "price", "cost", "pricing", "quote", "pay", "cod", "add to bag"];
const WARM_WORDS = ["interested", "demo", "recommend", "suggest", "which", "compare", "routine", "plan", "offer", "discount", "combo", "try", "consider", "looking for", "best for"];

function tagLead(text) {
  if (HOT_WORDS.some((w) => text.includes(w))) return "hot";
  if (WARM_WORDS.some((w) => text.includes(w))) return "warm";
  return "cold";
}

export async function POST(req) {
  try {
    const { brand, messages } = await req.json();
    if (!brand || !messages || messages.length === 0) {
      return Response.json({ ok: false });
    }

    // Only the customer's own words signal buying intent.
    const text = messages.filter((m) => m.role === "user").map((m) => (m.content || "").toLowerCase()).join(" ");
    const leadTag = tagLead(text);
    const isHot = leadTag === "hot"; // kept for backward-compat with existing dashboard

    const db = getDb();
    await db.collection("conversations").add({
      brand,
      messages,
      messageCount: messages.length,
      isHot,
      leadTag,
      createdAt: new Date().toISOString(),
    });

    return Response.json({ ok: true, leadTag });
  } catch (e) {
    // Never throw — logging must never break the chat.
    return Response.json({ ok: false });
  }
}
