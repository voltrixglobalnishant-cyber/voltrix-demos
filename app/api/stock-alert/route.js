// app/api/stock-alert/route.js
// Back-in-stock alert capture. A shopper hits "Notify me" on an out-of-stock product;
// we save their email/phone (+ WhatsApp opt-in) to Firestore `stock_alerts` so the team
// can ping them when it's back. Node runtime (firebase-admin). Best-effort — never crashes.

import { getDb } from "../../lib/firebase-admin";

// normalise Indian mobile to E.164 (no +) for a future WhatsApp ping
function toWa(phone) {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 11 && d.startsWith("0")) return "91" + d.slice(1);
  return d;
}

export async function POST(req) {
  try {
    const { brand, product, email, phone, waOptIn } = await req.json();
    // Need a product and at least one way to reach them.
    if (!product || (!email && !phone)) return Response.json({ ok: false, error: "missing details" });

    try {
      const db = getDb();
      await db.collection("stock_alerts").add({
        brand: brand || "korinmi", product,
        email: email || "", phone: phone || "", wa: phone ? toWa(phone) : "",
        waOptIn: !!waOptIn, notified: false,
        createdAt: new Date().toISOString(),
      });
    } catch {}

    return Response.json({ ok: true });
  } catch { return Response.json({ ok: false }); }
}
