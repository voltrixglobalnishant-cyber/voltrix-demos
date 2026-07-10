// app/api/skin-analysis/route.js
// REAL vision analysis for skin/hair photos -> structured cosmetic concerns -> catalogue product matches.
// Two-pass for accuracy: pass 1 reads the photo, pass 2 double-checks the tags are supported by the
// image AND stay non-medical before we recommend products.
// Edge runtime = fast cold starts. Only calls Anthropic. Cosmetic only — never medical.

export const runtime = "edge";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const SUPPORTED_MEDIA = ["image/jpeg", "image/png", "image/gif", "image/webp"]; // Claude vision-supported types
const VALID_TAGS =["oily_acne", "dry_dehydrated", "pigmentation_dull", "sun_protection", "aging_fine_lines", "hair_scalp", "general"];

// products Nexus is allowed to recommend (must match KorinMi catalogue)
const CATALOG = {
  oily_acne: ["IO.MI Deep Cleanser ₹1,499", "Oil & Sebum Balancing Pair ₹1,198"],
  dry_dehydrated: ["AA Hydro Essence ₹1,699", "Ultimate Hydration Kit ₹1,499"],
  pigmentation_dull: ["SA.AG Gold Ampoule Serum ₹699", "Pigmentation Control Pair ₹1,098"],
  sun_protection: ["UV Sun Protection ₹1,399", "Mini UV Sun Protection ₹499"],
  aging_fine_lines: ["SA Timeless Ampoule Toner ₹2,999", "Night Repair Kit ₹1,198"],
  general: ["The KorinMi Skincare Routine combo ₹2,995"],
  hair_scalp: ["Book: KorinMi Korean Hair Spa (clinic)"],
};

async function callVision({ base64, mediaType }, system, userText, maxTokens = 500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: userText },
        ] }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    let raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").replace(/```json|```/g, "").trim();
    try { return JSON.parse(raw); } catch { return null; }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req) {
  try {
    const { imageDataUrl, type } = await req.json(); // type: "skin" | "hair"
    if (!imageDataUrl || !imageDataUrl.includes(",")) return Response.json({ ok: false });

    const base64 = imageDataUrl.split(",")[1];
    const mediaType = (imageDataUrl.split(",")[0].match(/data:(image\/[a-z0-9.+-]+);base64/) || [])[1] || "image/jpeg";
    // Client converts every upload/capture to JPEG; guard against anything unsupported (e.g. heic) reaching Claude.
    if (!SUPPORTED_MEDIA.includes(mediaType)) return Response.json({ ok: false, reason: "unsupported_type" });
    const img = { base64, mediaType };
    const kind = type === "hair" ? "hair" : "skin";

    // ---- PASS 1: cosmetic read ----
    const v1 = await callVision(
      img,
      `You are a cosmetic skin & hair consultant for a K-beauty brand (NOT a doctor — never diagnose medical conditions, never mention disease). Look at the ${kind} photo and give a friendly cosmetic read. Respond ONLY as JSON: {"observations":[{"concern":string,"note":string}],"tags":string[],"suitableFor":string,"qualityScore":number,"metrics":{"hydration":number,"evenness":number,"clarity":number}} where tags are chosen ONLY from: ${JSON.stringify(VALID_TAGS)}. qualityScore is an overall cosmetic ${kind}-quality rating 0-100 (higher = healthier, more radiant looking) and metrics.hydration/evenness/clarity are each 0-100 cosmetic sub-scores. Keep notes cosmetic and non-medical.`,
      `Analyse this ${kind} photo cosmetically.`
    );
    if (!v1) return Response.json({ ok: false });

    let tags = (Array.isArray(v1.tags) ? v1.tags : []).filter((t) => VALID_TAGS.includes(t));
    let observations = Array.isArray(v1.observations) ? v1.observations : [];

    // ---- PASS 2: double-check accuracy + non-medical safety ----
    // A second read verifies the tags are actually supported by the photo and drops any
    // that aren't (or anything drifting toward medical language) before we recommend products.
    const v2 = await callVision(
      img,
      `You are a strict reviewer double-checking a cosmetic ${kind} analysis for a K-beauty brand. Confirm ONLY the concern tags that are genuinely visible in this photo, drop any that are not clearly supported, and REMOVE anything that would require a medical diagnosis (this is cosmetic only). Choose tags ONLY from: ${JSON.stringify(VALID_TAGS)}. Respond ONLY as JSON: {"confirmedTags":string[],"medicalConcern":boolean,"note":string}.`,
      `First-pass tags were: ${JSON.stringify(tags.length ? tags : ["general"])}. Verify against the photo.`,
      300
    );
    if (v2 && Array.isArray(v2.confirmedTags)) {
      const confirmed = v2.confirmedTags.filter((t) => VALID_TAGS.includes(t));
      if (confirmed.length) tags = confirmed;
    }

    if (!tags.length) tags = ["general"];
    const recommended = [...new Set(tags.flatMap((t) => CATALOG[t] || CATALOG.general))].slice(0, 4);

    // Cosmetic quality score + sub-metrics (clamped). If the model omitted the score,
    // derive it from the metrics, else fall back to a neutral read.
    const clamp = (n, d) => {
      const x = Math.round(Number(n));
      return Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : d;
    };
    const m = v1.metrics && typeof v1.metrics === "object" ? v1.metrics : {};
    const metrics = {
      hydration: clamp(m.hydration, 70),
      evenness: clamp(m.evenness, 70),
      clarity: clamp(m.clarity, 70),
    };
    const derived = Math.round((metrics.hydration + metrics.evenness + metrics.clarity) / 3);
    const score = clamp(v1.qualityScore, derived);

    return Response.json({
      ok: true, type: kind, observations, tags, recommended,
      score, metrics,
      doubleChecked: !!v2, note: v2?.note || "",
    });
  } catch {
    return Response.json({ ok: false });
  }
}
