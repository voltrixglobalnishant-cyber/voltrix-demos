// app/api/claim/route.js
// Receives a claim + photo + AI assessment, emails it (photo attached) to the CS team,
// and logs the full case (incl. internal score + authenticity) to Firestore `claims` for the admin.
// Node runtime so attachments + firebase-admin work. Every side-effect is best-effort.

import { Resend } from "resend";
import { getDb } from "../../lib/firebase-admin";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req) {
  try {
    const { brand, orderId, issue, customerEmail, imageDataUrl, fileName, assessment } = await req.json();

    let attachments = [];
    if (imageDataUrl && imageDataUrl.includes(",")) {
      attachments.push({ filename: fileName || "claim-photo.jpg", content: imageDataUrl.split(",")[1] });
    }

    let aiBlock = "AI assessment: not available";
    const v = assessment?.vision || {};
    if (assessment && assessment.ok) {
      aiBlock =
        `AI PHOTO ASSESSMENT (internal)\n` +
        `  Damage visible: ${v.damageVisible ? "Yes" : "No"}\n` +
        `  Type: ${v.damageType || "—"} (${v.severity || "—"})\n` +
        `  Note: ${v.description || "—"}\n` +
        `  Authenticity: ${assessment.authenticity || v.authenticity || "—"}${v.aiGenerated ? " · AI-generated suspected" : ""}${v.authenticityReason ? " — " + v.authenticityReason : ""}\n` +
        `  Double-checked: ${assessment.doubleChecked ? "Yes" + (v.doubleCheckNote ? " — " + v.doubleCheckNote : "") : "No"}\n` +
        `  Claim Confidence Score: ${assessment.score}/100 (${assessment.band})\n` +
        `  Recommendation: ${assessment.recommendation}`;
    }

    // ---- Email the CS team (best-effort) ----
    let emailed = false;
    try {
      await resend.emails.send({
        from: "Nexus AI <onboarding@resend.dev>",
        to: "ravantasolutions@gmail.com",
        subject: `🚨 New claim — ${brand || "demo"} ${orderId ? "· " + orderId : ""} ${assessment?.band ? "[" + assessment.band + " confidence]" : ""}`,
        text:
          `A customer raised a claim via the AI chat.\n\n` +
          `Brand: ${brand || "—"}\n` +
          `Order: ${orderId || "—"}\n` +
          `Issue: ${issue || "—"}\n` +
          `Customer: ${customerEmail || "—"}\n` +
          `Photo: ${attachments.length ? "attached" : "none"}\n\n` +
          `${aiBlock}\n`,
        attachments,
      });
      emailed = true;
    } catch {}

    // ---- Log the case to Firestore `claims` for the admin dashboard (best-effort) ----
    try {
      const db = getDb();
      await db.collection("claims").add({
        brand: brand || "",
        orderId: orderId || "",
        issue: issue || "",
        customerEmail: customerEmail || "",
        hasPhoto: !!attachments.length,
        // internal assessment — admin/CS only, never shown to the customer
        score: assessment?.score ?? null,
        band: assessment?.band ?? null,
        authenticity: assessment?.authenticity ?? v.authenticity ?? null,
        aiGenerated: !!v.aiGenerated,
        doubleChecked: !!assessment?.doubleChecked,
        damageVisible: !!v.damageVisible,
        severity: v.severity ?? null,
        recommendation: assessment?.recommendation ?? null,
        vision: v || null,
        emailed,
        status: "open",
        createdAt: new Date().toISOString(),
      });
    } catch {}

    return Response.json({ ok: true, emailed });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
