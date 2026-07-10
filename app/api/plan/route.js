// app/api/plan/route.js
// Builds a customised KorinMi Beauty Plan from analysis + captured lead,
// sends it to WhatsApp (Cloud API) + email (Resend fallback), saves the lead for CRM.
// Node runtime (firebase-admin + resend). Every send is best-effort — never crashes the chat.

import { Resend } from "resend";
import { getDb } from "../../lib/firebase-admin";

const resend = new Resend(process.env.RESEND_API_KEY);

// normalise Indian mobile to E.164 (WhatsApp needs country code, no +)
function toWa(phone) {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 11 && d.startsWith("0")) return "91" + d.slice(1);
  return d;
}

async function sendWhatsApp(waNumber, body) {
  const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: waNumber, type: "text", text: { body } }),
  });
  return r.ok;
}

export async function POST(req) {
  try {
    const { name, email, phone, tags, recommended, concerns, score, source, waOptIn } = await req.json();
    if (!name || !email || !phone) return Response.json({ ok: false, error: "missing lead" });

    const products = (recommended && recommended.length ? recommended : ["The KorinMi Skincare Routine combo ₹2,995"]);
    const scoreLine = Number.isFinite(Number(score)) ? `Your skin/hair quality score: ${Math.round(Number(score))}/100\n` : "";
    const planText =
      `Hi ${name.split(" ")[0]}! ✨ Here's your KorinMi Skin Report + plan:\n\n` +
      scoreLine +
      `Your focus: ${(tags || ["general"]).join(", ")}\n\n` +
      `Morning:\n1. Cleanse\n2. ${products[0] || "Serum"}\n3. UV Sun Protection\n\n` +
      `Night:\n1. Cleanse\n2. ${products[1] || products[0] || "Treatment"}\n3. Moisturise\n\n` +
      `Your matched kit:\n${products.map(p => "• " + p).join("\n")}\n\n` +
      `Reply here to order or ask anything. — Team KorinMi`;

    // Email is our main delivery channel. WhatsApp only if the lead opted in (best-effort).
    let emailSent = false;
    try {
      await resend.emails.send({
        from: "KorinMi <onboarding@resend.dev>",
        to: email,
        subject: "✨ Your KorinMi Skin Report & Plan",
        text: planText,
      });
      emailSent = true;
    } catch {}

    const wa = toWa(phone);
    let waSent = false;
    if (waOptIn) { try { waSent = await sendWhatsApp(wa, planText); } catch {} }

    // save lead + plan for CRM/admin
    try {
      const db = getDb();
      await db.collection("leads").add({
        name, email, phone, wa, tags: tags || [], concerns: concerns || [],
        products, score: Number.isFinite(Number(score)) ? Math.round(Number(score)) : null,
        waOptIn: !!waOptIn, emailSent, waSent,
        createdAt: new Date().toISOString(), source: source || "skin_report",
      });
    } catch {}

    return Response.json({ ok: true, emailSent, waSent });
  } catch { return Response.json({ ok: false }); }
}
