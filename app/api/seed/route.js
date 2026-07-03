// app/api/seed/route.js
// One-time seeder: creates live orders in Firestore. Visit /api/seed?key=YOUR_KEY once.

import { getDb } from "../../lib/firebase-admin";

const ORDERS = {
  "KM-2048": { item: "AA Hydro Essence", price: 1699, status: "SHIPPED", awb: "Delhivery AWB 7712009988", note: "ETA ~2 days" },
  "KM-1990": { item: "IO.MI Deep Cleanser", price: 1499, status: "DELIVERED", note: "Delivered 5 days ago · returnable" },
  "KM-2103": { item: "KorinMi Skincare Routine combo", price: 2995, status: "PROCESSING", note: "Editable · cancellable" },
};

const KB = [
  { id: "shipping", topic: "shipping delivery time free", text: "Shipping: Free shipping on orders above ₹999. Standard delivery 3-6 business days across India via Delhivery. COD available. Metro cities usually 2-4 days." },
  { id: "returns", topic: "return refund policy exchange", text: "Returns: 14-day return window on unused, unopened products. Refunds go to the original payment method in 5-7 business days after pickup. Damaged/wrong items are replaced free with photo proof." },
  { id: "ingredients", topic: "ingredients safe pregnancy sensitive skin paraben", text: "Ingredients: All KorinMi products are dermatologist-tested, paraben-free, sulphate-free and cruelty-free. Formulated for Indian skin. For pregnancy or medical conditions, we recommend checking with your doctor first." },
  { id: "goldampoule", topic: "gold ampoule serum usage how to use brightening", text: "SA.AG Gold Ampoule Serum (₹699): brightening ampoule. Use 2-3 drops on cleansed face morning and night before moisturiser. Visible glow in 2-3 weeks with daily use. Pairs well with AA Hydro Essence." },
  { id: "sunscreen", topic: "sunscreen spf sun protection reapply", text: "UV Sun Protection (₹1,399): daily SPF essence. Apply as the last skincare step every morning; reapply every 3-4 hours under direct sun. Mini travel size available at ₹499." },
  { id: "clinics", topic: "clinic location address timing appointment", text: "Clinics: Gurugram (Worldmark Sector 65; Golf Course Rd DLF Phase 1) and New Delhi (Vasant Vihar). Open daily 10:30 AM - 7:30 PM. Bookable: Glass Skin Treatments, Korean Hair Spa, Laser Hair Reduction." },
  { id: "membership", topic: "member loyalty points offers discount", text: "KorinMi Members get early access to launches, member-only offers and skincare tips by email/WhatsApp. Joining is free — just share email + phone with the concierge." },
];

export async function GET(req) {
  const key = new URL(req.url).searchParams.get("key");
  if (key !== process.env.ANALYTICS_KEY) {
    return Response.json({ ok: false, error: "bad key" }, { status: 401 });
  }
  try {
    const db = getDb();
    const batch = db.batch();
    for (const [id, o] of Object.entries(ORDERS)) {
      batch.set(db.collection("orders").doc(id), o);
    }
    for (const doc of KB) {
      batch.set(db.collection("kb").doc(doc.id), { topic: doc.topic, text: doc.text });
    }
    await batch.commit();
    return Response.json({ ok: true, orders: Object.keys(ORDERS), kb: KB.length });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}