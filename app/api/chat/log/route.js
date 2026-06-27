// app/api/log/route.js
// Saves each conversation to Firestore. Completely separate from your chat —
// if anything here fails, your chat keeps working. It also flags "hot leads"
// (anyone who asked about pricing, buying, or booking).

import { getDb } from "../lib/firebase-admin";

const HOT_WORDS = ["price", "cost", "how much", "buy", "purchase", "book", "booking", "demo", "interested", "sign up", "pricing", "quote"];

export async function POST(req) {
  try {
    const { brand, messages } = await req.json();
    if (!brand || !messages || messages.length === 0) {
      return Response.json({ ok: false });
    }

    // Is this a hot lead? (did the customer ask about price/buying/booking?)
    const text = messages.map(m => (m.content || "").toLowerCase()).join(" ");
    const isHot = HOT_WORDS.some(w => text.includes(w));

    const db = getDb();
    await db.collection("conversations").add({
      brand,
      messages,
      messageCount: messages.length,
      isHot,
      createdAt: new Date().toISOString(),
    });

    return Response.json({ ok: true });
  } catch (e) {
    // Never throw — logging must never break the chat.
    return Response.json({ ok: false });
  }
}