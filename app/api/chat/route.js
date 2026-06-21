// app/api/chat/route.js
// Secure server-side handler for Nexus AI. The API key NEVER touches the browser.

import { getBrand } from "../../../lib/brands";

export const runtime = "edge"; // fast cold starts on Vercel

export async function POST(request) {
  try {
    const { messages, brand } = await request.json();

    const brandConfig = getBrand(brand);
    if (!brandConfig) {
      return Response.json({ error: "Unknown brand" }, { status: 400 });
    }

    // ---- Timeout guard: if Claude is slow, we fail gracefully (never a dead chat) ----
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s ceiling

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
          // Haiku = fast + cheap, handles 90%+ of queries. Swap to sonnet for complex brands.
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1000,
          system: brandConfig.systemPrompt,
          messages,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      // API error -> graceful fallback so the customer is never stranded
      return Response.json({
        reply: brandConfig.fallback,
        escalate: true,
      });
    }

    const data = await res.json();
    let reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const escalate = reply.includes("[ESCALATE]");
    reply = reply.replace("[ESCALATE]", "").trim();

    return Response.json({ reply, escalate });
  } catch (err) {
    // Network/timeout/abort -> same graceful fallback
    return Response.json({
      reply:
        "I'm having a brief moment — but I won't leave you waiting. Share your email and a team member will follow up personally.",
      escalate: true,
    });
  }
}
