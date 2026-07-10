// app/api/decor-match/route.js
// Binge Town decor-match vision: a guest uploads an inspiration photo → Claude vision
// reads the vibe → we match it to the closest Binge Town decor theme + a fitting theatre/branch.
// The full vision reasoning + confidence is INTERNAL (persisted to Firestore for the admin panel);
// the customer only ever sees a warm, friendly recommendation.
// Node runtime so it can persist to Firestore (firebase-admin can't run on edge).

import { getDb } from "../../lib/firebase-admin";

export const runtime = "nodejs";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// The only decor themes / theatres the match may return (strict catalogue — mirrors the brand config).
const THEMES = ["Balloon Setup", "Floral", "Neon", "Romantic Candlelight", "Birthday Bash"];

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

export async function POST(req) {
  try {
    const { imageDataUrl, occasion, city } = await req.json();
    if (!imageDataUrl || !imageDataUrl.includes(",")) {
      return Response.json({ ok: false, error: "no image" });
    }
    const img = parseImage(imageDataUrl);

    const v = await callVision(
      img,
      "You are The Binge Town's decor stylist. A guest shares an inspiration photo for a private-theatre celebration. " +
        "Read the vibe (colours, mood, motifs) and match it to the SINGLE closest Binge Town decor theme from this exact list: " +
        THEMES.join(", ") + ". Do not invent a theme outside this list. " +
        'Respond with ONLY a JSON object — no markdown: {"matchedTheme": one of the list, "vibe": string (2-4 words), "palette": string (colours you see), "motifs": string (short), "suggestedTheatre": string (e.g. Duet for couples, Bloom/Luna/Lavish for standard, Grand for large), "customerMessage": string (one warm friendly sentence recommending the theme + a fitting add-on, no scores), "confidence": number 0-100}.',
      `Match this inspiration photo to a Binge Town decor theme.${occasion ? " Occasion: " + occasion + "." : ""}${city ? " City: " + city + "." : ""}`
    );

    if (!v || !v.matchedTheme) {
      return Response.json({ ok: false, error: "could not read photo" });
    }

    // Keep the theme strictly inside the catalogue.
    const matchedTheme = THEMES.find((t) => t.toLowerCase() === String(v.matchedTheme).toLowerCase()) || THEMES[0];
    const confidence = Math.max(0, Math.min(100, Number(v.confidence) || 0));

    // Persist the FULL internal read for the admin panel (never returned as chat text).
    try {
      const db = getDb();
      await db.collection("decor").add({
        brand: "bingetown",
        matchedTheme,
        vibe: v.vibe || "",
        palette: v.palette || "",
        motifs: v.motifs || "",
        suggestedTheatre: v.suggestedTheatre || "",
        confidence,
        occasion: occasion || "",
        city: city || "",
        createdAt: new Date().toISOString(),
      });
    } catch {}

    // Customer-safe payload only.
    return Response.json({
      ok: true,
      matchedTheme,
      suggestedTheatre: v.suggestedTheatre || "",
      customerMessage: v.customerMessage || `Love this vibe — our ${matchedTheme} decor would bring it to life beautifully.`,
      // internal note the chat route reuses to calibrate the next reply (not rendered verbatim)
      internalNote: `[Internal decor-match: theme ${matchedTheme}, vibe "${v.vibe || "?"}", palette "${v.palette || "?"}", suggested ${v.suggestedTheatre || "?"}, confidence ${confidence}/100. Do not reveal scores — just warmly recommend the ${matchedTheme} setup and invite them to pick a branch/date.]`,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
