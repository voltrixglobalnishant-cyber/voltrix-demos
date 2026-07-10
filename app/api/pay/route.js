// app/api/pay/route.js
// Mock advance-payment endpoint for The Binge Town demo.
//   GET  ?bookingId=BT-XXXX  -> booking summary for the /pay page (fail-open)
//   POST { bookingId }       -> marks the booking status "Advance Paid" (best-effort)
// Node runtime: firebase-admin cannot run on the edge. Namespaced brand:"bingetown".

import { getDb } from "../../lib/firebase-admin";

export const runtime = "nodejs";

const ADVANCE = 750;
const ID_RE = /^BT-\d{3,}$/;

const cleanId = (v) => String(v || "").trim().toUpperCase();

export async function GET(req) {
  const bookingId = cleanId(new URL(req.url).searchParams.get("bookingId"));
  if (!ID_RE.test(bookingId)) {
    return Response.json({ ok: false, error: "invalid booking id", advance: ADVANCE, bookingId });
  }
  try {
    const db = getDb();
    const snap = await db.collection("bookings").doc(bookingId).get();
    if (!snap.exists || snap.data().brand !== "bingetown") {
      return Response.json({ ok: false, error: "not found", advance: ADVANCE, bookingId });
    }
    const b = snap.data();
    return Response.json({
      ok: true,
      advance: ADVANCE,
      booking: {
        bookingId,
        name: b.name || null,
        branch: b.branchName || b.branch || null,
        city: b.city || null,
        theatre: b.theatre || null,
        occasion: b.occasion || null,
        date: b.date || null,
        slot: b.slot || null,
        amount: b.amount || null,
        status: b.status || null,
      },
    });
  } catch (e) {
    // Fail-open: Firestore may be unprovisioned locally — the page still renders.
    return Response.json({ ok: false, error: String(e), advance: ADVANCE, bookingId });
  }
}

export async function POST(req) {
  let bookingId = "";
  try { bookingId = cleanId((await req.json()).bookingId); } catch {}
  if (!ID_RE.test(bookingId)) {
    return Response.json({ ok: false, error: "invalid booking id" }, { status: 400 });
  }
  const now = new Date().toISOString();
  try {
    const db = getDb();
    const ref = db.collection("bookings").doc(bookingId);
    const snap = await ref.get();
    if (snap.exists && snap.data().brand === "bingetown") {
      // Advance paid → the slot is locked. Status flips to Confirmed and shows so in admin.
      await ref.set(
        { status: "Confirmed", advanceAmount: ADVANCE, advancePaidAt: now, paidAt: now },
        { merge: true }
      );
    }
    // Record the payment regardless (demo ledger).
    await db.collection("payments").add({
      brand: "bingetown", bookingId, amount: ADVANCE, status: "success", createdAt: now,
    });
    return Response.json({ ok: true, persisted: snap.exists, bookingId });
  } catch (e) {
    // Best-effort: a Firestore hiccup must never block the success screen.
    return Response.json({ ok: true, persisted: false, bookingId, note: String(e) });
  }
}
