// app/api/jewellery-vision/route.js
// REAL vision analysis for the Éclat "Virtual Try-On" feature.
// Reads a customer photo (selfie / hand / outfit / a jewellery piece) and returns a
// structured jewellery-consultation read + Éclat catalogue recommendations.
// Edge runtime = fast cold starts. Only calls Anthropic (no external attachments).

export const runtime = "edge";

// The ONLY pieces Nexus is allowed to recommend (must mirror the Éclat catalogue in lib/brands/eclat.js)
const CATALOG = [
  { name: "Oval Solitaire Ring", price: "₹89,999" },
  { name: "Hidden Halo Ring", price: "₹1,24,999" },
  { name: "Classic Round Solitaire", price: "₹74,999" },
  { name: "Cushion Cut Ring", price: "₹94,999" },
  { name: "Solitaire Studs", price: "₹49,999" },
  { name: "Tennis Bracelet", price: "₹1,49,999" },
  { name: "Solitaire Pendant", price: "₹39,999" },
  { name: "Eternity Band", price: "₹64,999" },
];

const PRICE_BY_NAME = Object.fromEntries(CATALOG.map((c) => [c.name.toLowerCase(), c.price]));

export async function POST(req) {
  try {
    const { imageDataUrl } = await req.json();
    if (!imageDataUrl || !imageDataUrl.includes(",")) {
      return Response.json({ ok: false, error: "no image" });
    }

    const header = imageDataUrl.split(",")[0];
    const base64 = imageDataUrl.split(",")[1];
    const mm = header.match(/data:(image\/[a-zA-Z0-9.+-]+);base64/);
    const mediaType = mm ? mm[1] : "image/jpeg";

    const catalogueList = CATALOG.map((c) => `${c.name} — ${c.price}`).join("; ");

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
          max_tokens: 600,
          system:
            "You are Éclat's AI diamond stylist running a VIRTUAL TRY-ON. Look at the customer's photo and give a warm, tasteful styling read for lab-grown diamond jewellery. " +
            "Decide what the photo shows: a portrait/selfie, a hand, an outfit, or a photo of an existing jewellery piece. " +
            "Infer skin undertone (warm/cool/neutral) and overall style vibe ONLY from what is visible; if you can't tell, say 'unknown'. " +
            "Recommend the flattering metal (yellow gold / rose gold / platinum-white gold) with a one-line reason. " +
            `You may ONLY recommend pieces from this exact Éclat catalogue (never invent products or prices): ${catalogueList}. ` +
            "Pick 1-3 pieces that genuinely suit the person/photo, each with a short human 'why it suits you' line and a 'howItLooks' line describing how it would sit/look on them. " +
            "This is cosmetic styling only — never comment on medical/skin conditions. Never claim to see a photo detail that isn't there. " +
            'Respond with ONLY a JSON object, no markdown, no prose: {"photoType":"portrait"|"hand"|"outfit"|"jewellery"|"other","skinTone":"warm"|"cool"|"neutral"|"unknown","style":string,"metal":string,"metalWhy":string,"observation":string,"recommended":[{"name":string,"why":string,"howItLooks":string}]}',
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                { type: "text", text: "Give the customer their Éclat virtual try-on styling read for this photo." },
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
    catch { return Response.json({ ok: false, error: "unreadable" }); }

    // Constrain recommendations to the real catalogue and attach canonical prices.
    const recommended = (Array.isArray(v.recommended) ? v.recommended : [])
      .map((r) => {
        const price = PRICE_BY_NAME[(r.name || "").toLowerCase()];
        return price ? { name: r.name, price, why: r.why || "", howItLooks: r.howItLooks || "" } : null;
      })
      .filter(Boolean)
      .slice(0, 3);

    if (!recommended.length) {
      // graceful fallback so the try-on card always has something to show
      recommended.push({
        name: "Oval Solitaire Ring",
        price: "₹89,999",
        why: "A versatile classic that flatters almost everyone.",
        howItLooks: "Elongates the finger and faces up larger than its carat.",
      });
    }

    return Response.json({
      ok: true,
      photoType: v.photoType || "other",
      skinTone: v.skinTone || "unknown",
      style: v.style || "",
      metal: v.metal || "",
      metalWhy: v.metalWhy || "",
      observation: v.observation || "",
      recommended,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
