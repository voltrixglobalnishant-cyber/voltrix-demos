// app/api/cart-recover/route.js
// Abandoned-cart recovery. Fake cart in the demo. Sends a WhatsApp nudge if the lead is known,
// logs the abandoned cart for follow-up. Node runtime. Best-effort — never crashes the chat.

import { getDb } from "../../lib/firebase-admin";

function toWa(phone) {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 12 && d.startsWith("91")) return d;
  return d;
}
async function sendWhatsApp(to, body) {
  const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  return r.ok;
}

export async function POST(req) {
  try {
    const { name, phone, cart } = await req.json(); // cart: [{name, price}]
    if (!cart || !cart.length) return Response.json({ ok: false, error: "empty cart" });

    const items = cart.map(c => `• ${c.name} ${c.price || ""}`).join("\n");
    const msg =
      `Hi ${name ? name.split(" ")[0] : "there"}! 👋 You left these in your KorinMi cart:\n\n${items}\n\n` +
      `Still want them? Reply YES and I'll help you check out. Free shipping over ₹999 ✨`;

    let waSent = false;
    if (phone) { try { waSent = await sendWhatsApp(toWa(phone), msg); } catch {} }

    try {
      const db = getDb();
      await db.collection("abandoned_carts").add({
        name: name || "", phone: phone || "", cart, waSent, createdAt: new Date().toISOString(),
      });
    } catch {}

    return Response.json({ ok: true, waSent, message: msg });
  } catch { return Response.json({ ok: false }); }
}
