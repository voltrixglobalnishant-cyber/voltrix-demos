// app/api/claim/route.js
// Receives a claim + photo + AI assessment, emails it (photo attached) to the team.
// Node runtime so attachments work.

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req) {
  try {
    const { brand, orderId, issue, customerEmail, imageDataUrl, fileName, assessment } = await req.json();

    let attachments = [];
    if (imageDataUrl && imageDataUrl.includes(",")) {
      attachments.push({ filename: fileName || "claim-photo.jpg", content: imageDataUrl.split(",")[1] });
    }

    let aiBlock = "AI assessment: not available";
    if (assessment && assessment.ok) {
      const v = assessment.vision || {};
      aiBlock =
        `AI PHOTO ASSESSMENT\n` +
        `  Damage visible: ${v.damageVisible ? "Yes" : "No"}\n` +
        `  Type: ${v.damageType || "—"} (${v.severity || "—"})\n` +
        `  Note: ${v.description || "—"}\n` +
        `  Claim Confidence Score: ${assessment.score}/100 (${assessment.band})\n` +
        `  Recommendation: ${assessment.recommendation}`;
    }

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

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
