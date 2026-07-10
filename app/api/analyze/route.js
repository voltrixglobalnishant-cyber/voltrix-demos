// app/api/analyze/route.js
// ENTERPRISE-GRADE claim-photo assessment (like Amazon/Zomato).
// Pass 1: vision read — damage visible? type? severity? + AUTHENTICITY (real/suspicious/likely_fake, AI-generated?).
// Pass 2: skeptical DOUBLE-CHECK on damage claims — a second model verifies the first before the score is finalised.
// Score blends photo evidence + verified customer + eligible order + consistency, x authenticity multiplier.
// The score is INTERNAL only (returned for email + admin) — the customer never sees it.
// Edge runtime = fast cold starts. Only calls Anthropic (no attachments).

export const runtime = "edge";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function parseImage(imageDataUrl) {
  const header = imageDataUrl.split(",")[0];
  const base64 = imageDataUrl.split(",")[1];
  const mm = header.match(/data:(image\/[a-zA-Z0-9.+-]+);base64/);
  return { base64, mediaType: mm ? mm[1] : "image/jpeg" };
}

async function callVision({ base64, mediaType }, system, userText, maxTokens = 400) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: userText },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    let raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    raw = raw.replace(/```json|```/g, "").trim();
    try { return JSON.parse(raw); } catch { return null; }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const AUTH_MULT = { real: 1.0, suspicious: 0.6, likely_fake: 0.2 };

export async function POST(req) {
  try {
    const { imageDataUrl, issueType, customerVerified, orderEligible } = await req.json();
    if (!imageDataUrl || !imageDataUrl.includes(",")) {
      return Response.json({ ok: false, error: "no image" });
    }
    const img = parseImage(imageDataUrl);

    // ---- PASS 1: primary assessment + authenticity ----
    const v1 = await callVision(
      img,
      "You are a product-returns assessor for an e-commerce brand, and also a photo-forensics checker. " +
        "Look at the customer's photo and judge (a) whether it genuinely supports their claim — visible damage/defect, or for a 'missing item' claim what actually arrived — and (b) whether the photo itself looks authentic or manipulated. " +
        "For authenticity, look for signs the image is AI-generated, edited/photoshopped, a screenshot of another photo, a stock/product-listing image, or reused. Be fair but careful. " +
        'Respond with ONLY a JSON object — no markdown, no prose: {"damageVisible": boolean, "damageType": string, "severity": "none"|"minor"|"moderate"|"severe", "description": string (one short sentence), "photoConfidence": number 0-100, "authenticity": "real"|"suspicious"|"likely_fake", "aiGenerated": boolean, "authenticityReason": string (one short sentence)}.',
      `Claim type: ${issueType || "damaged item"}. Assess the photo and its authenticity.`
    );

    const v = v1 || {
      damageVisible: false, damageType: "unknown", severity: "none", photoConfidence: 0,
      description: "Could not read the photo clearly.", authenticity: "suspicious", aiGenerated: false,
      authenticityReason: "Photo could not be assessed.",
    };

    // ---- PASS 2: skeptical double-check (only when the first pass claims damage) ----
    // A second, independent verification reduces false positives before we finalise the score.
    let doubleCheck = null;
    if (v.damageVisible) {
      doubleCheck = await callVision(
        img,
        "You are a STRICT second-opinion fraud reviewer double-checking another assessor's finding that this photo shows genuine product damage. " +
          "Be skeptical: could the 'damage' be a shadow, reflection, packaging, dirt, normal wear, or staged/edited? Only confirm damage you can clearly see. " +
          'Respond with ONLY JSON: {"confirmsDamage": boolean, "severity": "none"|"minor"|"moderate"|"severe", "authenticity": "real"|"suspicious"|"likely_fake", "note": string (one short sentence)}.',
        `A first assessor reported: ${v.damageType || "damage"} (${v.severity || "unknown"}) — "${v.description || ""}". Independently verify.`,
        250
      );
      if (doubleCheck) {
        // Both passes must agree the damage is real; disagreement pulls confidence down.
        if (!doubleCheck.confirmsDamage) v.damageVisible = false;
        // Take the more cautious authenticity read between the two passes.
        const order = { real: 3, suspicious: 2, likely_fake: 1 };
        if (order[doubleCheck.authenticity] < order[v.authenticity ?? "suspicious"]) {
          v.authenticity = doubleCheck.authenticity;
        }
        v.doubleCheckNote = doubleCheck.note || "";
        v.doubleChecked = true;
      }
    }

    // ---- SCORE (internal only) ----
    const sev = { none: 0, minor: 0.5, moderate: 0.8, severe: 1 }[v.severity] ?? 0;
    const photoPts = Math.round((Number(v.photoConfidence) || 0) * 0.5 * (v.damageVisible ? (sev || 0.6) : 0.2));
    const verifiedPts = customerVerified ? 20 : 0;
    const eligiblePts = orderEligible ? 20 : 0;
    const consistencyPts = v.damageVisible ? 10 : 0;
    const agreementPts = v.doubleChecked && v.damageVisible ? 10 : 0; // both passes agreed
    const authMult = AUTH_MULT[v.authenticity] ?? 0.6;

    const rawScore = photoPts + verifiedPts + eligiblePts + consistencyPts + agreementPts;
    const score = Math.max(0, Math.min(100, Math.round(rawScore * authMult)));

    const band = score >= 75 ? "High" : score >= 45 ? "Medium" : "Low";
    const recommendation =
      v.authenticity === "likely_fake" ? "Hold — photo authenticity suspect, manual review" :
      band === "High" ? "Auto-approve replacement / refund" :
      band === "Medium" ? "Route to agent for quick review" :
      "Manual review — request more info";

    return Response.json({
      ok: true, vision: v, score, band, recommendation,
      authenticity: v.authenticity, authenticityMultiplier: authMult, doubleChecked: !!v.doubleChecked,
      factors: {
        photo: photoPts, verifiedCustomer: verifiedPts, eligibleOrder: eligiblePts,
        claimConsistency: consistencyPts, doubleCheckAgreement: agreementPts, authenticityMultiplier: authMult,
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
