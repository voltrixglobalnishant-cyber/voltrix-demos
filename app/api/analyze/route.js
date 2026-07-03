// app/api/analyze/route.js
// REAL vision analysis of a claim photo + a Claim Confidence Score.
// Edge runtime = fast cold starts. Only calls Anthropic (no attachments).

export const runtime = "edge";

export async function POST(req) {
  try {
    const { imageDataUrl, issueType, customerVerified, orderEligible } = await req.json();
    if (!imageDataUrl || !imageDataUrl.includes(",")) {
      return Response.json({ ok: false, error: "no image" });
    }

    const header = imageDataUrl.split(",")[0];
    const base64 = imageDataUrl.split(",")[1];
    const mm = header.match(/data:(image\/[a-zA-Z0-9.+-]+);base64/);
    const mediaType = mm ? mm[1] : "image/jpeg";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

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
          max_tokens: 400,
          system:
            "You are a product returns assessor for an e-commerce brand. Look at the customer's photo and judge whether it genuinely supports their claim (visible damage/defect, or for a 'missing item' claim, what actually arrived). Be fair but careful. Respond with ONLY a JSON object — no markdown, no prose: {\"damageVisible\": boolean, \"damageType\": string, \"severity\": \"none\"|\"minor\"|\"moderate\"|\"severe\", \"description\": string (one short sentence), \"photoConfidence\": number 0-100}.",
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                { type: "text", text: `Claim type: ${issueType || "damaged item"}. Assess the photo.` },
              ],
            },
          ],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) return Response.json({ ok: false, error: "vision failed" });

    const data = await res.json();
    let raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    raw = raw.replace(/```json|```/g, "").trim();

    let v;
    try { v = JSON.parse(raw); }
    catch { v = { damageVisible: false, damageType: "unknown", severity: "none", photoConfidence: 0, description: "Could not read the photo clearly." }; }

    const sev = { none: 0, minor: 0.5, moderate: 0.8, severe: 1 }[v.severity] ?? 0;
    const photoPts = Math.round((Number(v.photoConfidence) || 0) * 0.5 * (v.damageVisible ? (sev || 0.6) : 0.2));
    const verifiedPts = customerVerified ? 20 : 0;
    const eligiblePts = orderEligible ? 20 : 0;
    const consistencyPts = v.damageVisible ? 10 : 0;
    const score = Math.min(100, photoPts + verifiedPts + eligiblePts + consistencyPts);

    const band = score >= 75 ? "High" : score >= 45 ? "Medium" : "Low";
    const recommendation =
      band === "High" ? "Auto-approve replacement / refund" :
      band === "Medium" ? "Route to agent for quick review" :
      "Manual review — request more info";

    return Response.json({
      ok: true, vision: v, score, band, recommendation,
      factors: { photo: photoPts, verifiedCustomer: verifiedPts, eligibleOrder: eligiblePts, claimConsistency: consistencyPts },
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}