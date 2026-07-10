# KorinMi — Nexus AI Feature Build (for Claude Code)

Add 4 features to the existing KorinMi demo. Stack: Next.js App Router, Firestore, Claude API, WhatsApp Cloud API. Do NOT break existing chat/order/claim flows.

Features:
1. Skin + hair photo analysis → product recommendations
2. Customized beauty plan → auto-sent to WhatsApp (+ email fallback)
3. Lead gate: name + email + phone required & validated before plan
4. Fake cart → abandoned-cart recovery

---

## ENV NEEDED
```
ANTHROPIC_API_KEY=
RESEND_API_KEY=
WHATSAPP_TOKEN=            # WhatsApp Cloud API permanent token
WHATSAPP_PHONE_ID=         # sender phone number ID
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

---

## FILE 1 — app/api/skin-analysis/route.js  (NEW)
Vision analysis for skin/hair → structured concerns → product matches. Edge runtime.

```javascript
export const runtime = "edge";

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

export async function POST(req) {
  try {
    const { imageDataUrl, type } = await req.json(); // type: "skin" | "hair"
    if (!imageDataUrl || !imageDataUrl.includes(",")) return Response.json({ ok: false });

    const base64 = imageDataUrl.split(",")[1];
    const mt = (imageDataUrl.split(",")[0].match(/data:(image\/[a-z0-9.+-]+);base64/) || [])[1] || "image/jpeg";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          system: `You are a cosmetic skin & hair consultant for a K-beauty brand (NOT a doctor — never diagnose medical conditions, never mention disease). Look at the ${type || "skin"} photo and give a friendly cosmetic read. Respond ONLY as JSON: {"observations":[{"concern":string,"note":string}],"tags":string[],"suitableFor":string} where tags are chosen ONLY from: ["oily_acne","dry_dehydrated","pigmentation_dull","sun_protection","aging_fine_lines","hair_scalp","general"]. Keep notes cosmetic and non-medical.`,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mt, data: base64 } },
            { type: "text", text: `Analyse this ${type || "skin"} photo cosmetically.` },
          ]}],
        }),
      });
    } finally { clearTimeout(timeout); }

    if (!res.ok) return Response.json({ ok: false });
    const data = await res.json();
    let raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").replace(/```json|```/g, "").trim();
    let v; try { v = JSON.parse(raw); } catch { return Response.json({ ok: false }); }

    const tags = Array.isArray(v.tags) && v.tags.length ? v.tags : ["general"];
    const recommended = [...new Set(tags.flatMap(t => CATALOG[t] || CATALOG.general))].slice(0, 4);

    return Response.json({ ok: true, observations: v.observations || [], tags, recommended });
  } catch { return Response.json({ ok: false }); }
}
```

---

## FILE 2 — app/api/plan/route.js  (NEW)
Builds a customized plan from analysis + captured lead, sends it to WhatsApp (Cloud API) and email. Node runtime.

```javascript
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
    const { name, email, phone, tags, recommended, concerns } = await req.json();
    if (!name || !email || !phone) return Response.json({ ok: false, error: "missing lead" });

    const products = (recommended && recommended.length ? recommended : ["The KorinMi Skincare Routine combo ₹2,995"]);
    const planText =
      `Hi ${name.split(" ")[0]}! ✨ Here's your KorinMi beauty plan:\n\n` +
      `Your focus: ${(tags || ["general"]).join(", ")}\n\n` +
      `Morning:\n1. Cleanse\n2. ${products[0] || "Serum"}\n3. UV Sun Protection\n\n` +
      `Night:\n1. Cleanse\n2. ${products[1] || products[0] || "Treatment"}\n3. Moisturise\n\n` +
      `Recommended for you:\n${products.map(p => "• " + p).join("\n")}\n\n` +
      `Reply here to order or ask anything. — Team KorinMi`;

    const wa = toWa(phone);
    let waSent = false;
    try { waSent = await sendWhatsApp(wa, planText); } catch {}

    try {
      await resend.emails.send({
        from: "KorinMi <onboarding@resend.dev>",
        to: email,
        subject: "✨ Your KorinMi Beauty Plan",
        text: planText,
      });
    } catch {}

    // save lead + plan for CRM/admin
    try {
      const db = getDb();
      await db.collection("leads").add({
        name, email, phone, wa, tags: tags || [], concerns: concerns || [],
        products, waSent, createdAt: new Date().toISOString(), source: "beauty_plan",
      });
    } catch {}

    return Response.json({ ok: true, waSent });
  } catch { return Response.json({ ok: false }); }
}
```

---

## FILE 3 — app/api/cart-recover/route.js  (NEW)
Abandoned-cart recovery. Fake cart in demo. Sends a nudge to WhatsApp if lead known. Node runtime.

```javascript
import { getDb } from "../../lib/firebase-admin";

function toWa(phone) {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 12 && d.startsWith("91")) return d;
  return d;
}
async function sendWhatsApp(to, body) {
  const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  return r.ok;
}

export async function POST(req) {
  try {
    const { name, phone, cart } = await req.json(); // cart: [{name, price}]
    if (!cart || !cart.length) return Response.json({ ok: false, error: "empty cart" });

    const items = cart.map(c => `• ${c.name} ${c.price || ""}`).join("\n");
    const msg =
      `Hi ${name ? name.split(" ")[0] : "there"}! 👋 You left these in your KorinMi cart:\n\n${items}\n\n` +
      `Still want them? Reply YES and I'll help you check out. Free shipping over ₹999 ✨`;

    let waSent = false;
    if (phone) { try { waSent = await sendWhatsApp(toWa(phone), msg); } catch {} }

    try {
      const db = getDb();
      await db.collection("abandoned_carts").add({
        name: name || "", phone: phone || "", cart, waSent, createdAt: new Date().toISOString(),
      });
    } catch {}

    return Response.json({ ok: true, waSent, message: msg });
  } catch { return Response.json({ ok: false }); }
}
```

---

## FILE 4 — WIDGET ADDITIONS (app/demo/[brand]/page.js)
Add to the EXISTING page (keep all current code). Three additions:

### 4a. State (add near other useState)
```javascript
const [lead, setLead] = useState({ name: "", email: "", phone: "" });
const [cart, setCart] = useState([]); // fake cart: [{name, price}]
```

### 4b. Helpers (add inside component)
```javascript
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
function validPhone(p){ const d=(p||"").replace(/\D/g,""); return d.length===10 && /^[6-9]/.test(d); }

// SKIN/HAIR ANALYSIS — call from a "Get my plan" button or after photo pick
async function analyzeSkinHair(dataUrl, type){
  const r = await fetch("/api/skin-analysis",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({imageDataUrl:dataUrl,type})});
  return await r.json();
}

// SEND PLAN — validate lead first, then WhatsApp + email
async function sendPlan(analysis){
  if(!lead.name.trim()) return alert("Please add your name");
  if(!EMAIL_RE.test(lead.email)) return alert("Please enter a valid email");
  if(!validPhone(lead.phone)) return alert("Please enter a valid 10-digit mobile");
  const r = await fetch("/api/plan",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({...lead,tags:analysis?.tags,recommended:analysis?.recommended,concerns:analysis?.observations})});
  const d = await r.json();
  // signpost the customer clearly
  setMessages(m=>[...m,{role:"assistant",content: d.ok
    ? `All done, ${lead.name.split(" ")[0]}! ✨ Your personalised plan is on its way to your WhatsApp (${lead.phone}) and email (${lead.email}). Check WhatsApp in a few seconds.`
    : `I couldn't send it just now — please double-check your details and try again, or our team will follow up.`}]);
  return d;
}

// ABANDONED CART — call when user closes chat with items in cart, or on a button
async function recoverCart(){
  if(!cart.length) return;
  await fetch("/api/cart-recover",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name:lead.name,phone:lead.phone,cart})});
}
```

### 4c. Lead-capture UI (render inside chat, e.g. above the input when collecting)
```jsx
{/* show this block when the bot is collecting details for the plan */}
<div className="vx-lead">
  <input placeholder="Name" value={lead.name} onChange={e=>setLead({...lead,name:e.target.value})}/>
  <input placeholder="Email" value={lead.email} onChange={e=>setLead({...lead,email:e.target.value})}/>
  <input placeholder="Mobile (10-digit)" value={lead.phone} onChange={e=>setLead({...lead,phone:e.target.value})}/>
  <button onClick={()=>sendPlan(lastAnalysis)}>Get my plan on WhatsApp</button>
</div>
```
CSS:
```css
.vx-lead{display:flex;flex-direction:column;gap:6px;padding:10px 14px;background:#fff;border-top:1px solid #ece2cf;}
.vx-lead input{border:1px solid #ece2cf;border-radius:8px;padding:8px 10px;font-size:13px;}
.vx-lead button{background:#a8842f;color:#fff;border:none;border-radius:8px;padding:9px;font-weight:600;cursor:pointer;}
```

---

## FILE 5 — PROMPT ADDITIONS (lib/brands/korinmi.js, inside systemPrompt)
Add these sections. Keep everything else.

```
=== BEAUTY PLAN (photo → personalised plan, LEAD-GATED) ===
- If a customer wants product advice or a personalised routine, offer a free customised KorinMi Beauty Plan.
- A photo of their skin and/or hair gives the best result, but it is OPTIONAL — offer it, never force it.
- The plan is delivered to WhatsApp + email. To send it you MUST collect name, email AND phone. Ask for these naturally; the app validates them. Do NOT generate the final plan in chat — tell them it will arrive on their WhatsApp.
- You are a COSMETIC consultant, NOT a doctor. Never diagnose, never name any disease/medical condition. For anything medical, suggest a dermatologist / the KorinMi clinic.
- Only ever recommend products from the KorinMi catalogue.

=== ABANDONED CART (sales recovery) ===
- If a customer has items in their cart and hesitates or tries to leave, gently remind them what's in the cart and offer to help them check out. Mention free shipping over ₹999 if relevant. Never pushy.

=== SIGNPOSTING ===
- Always tell the customer what happens next: e.g. "Your plan is on its way to your WhatsApp", "Our team will review your claim and reach out". Never leave them guessing.
```

---

## BUILD ORDER (for Claude Code)
1. Create FILE 1, 2, 3 (routes). Confirm each returns valid JSON.
2. Add FILE 5 prompt sections.
3. Add FILE 4 widget pieces; wire the "Get my plan" button to sendPlan().
4. Test locally:
   - Skin photo → analysis → recommendations
   - Enter name/email/phone → plan lands on WhatsApp + email
   - Bad email/phone → blocked with message
   - Fake cart → recoverCart() → WhatsApp nudge
5. Verify no regressions in existing chat/order/claim flows.

## GUARDRAILS
- Non-medical only. No diagnosis.
- Lead validation is mandatory before plan send.
- All WhatsApp/email sends are best-effort (try/catch) — never crash the chat.
- Recommend only catalogue products.
