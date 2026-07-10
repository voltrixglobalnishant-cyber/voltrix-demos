// app/lib/bingetown-abandon.js
// Binge Town abandoned-booking sweep. A NEW booking created in chat (status "Pending Advance",
// source "chat") that the guest never pays for is marked "Abandoned" after BOOKING_ABANDON_MINUTES.
// This is the "cleanup job / next-check" — call it lazily on any admin/chat/pay hit, or from
// the /api/abandon-sweep route (cron-friendly). Best-effort: a Firestore hiccup never throws.
//
// IMPORTANT: only chat-created bookings (source:"chat") are ever swept — the seeded demo
// "Pending Advance" fixtures (BT-2843, BT-2848) are static and must survive re-runs.

import { getDb } from "./firebase-admin";

// Minutes an unpaid chat booking waits before it's abandoned. Env-configurable (default 10).
export function abandonMinutes() {
  const n = Number(process.env.BOOKING_ABANDON_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

// Mark stale, unpaid, chat-created "Pending Advance" bookings as "Abandoned".
// Returns the number of bookings swept. Never throws.
export async function sweepAbandoned(dbArg) {
  try {
    const db = dbArg || getDb();
    const cutoff = Date.now() - abandonMinutes() * 60 * 1000;
    const now = new Date().toISOString();
    // Single-field where (no composite index needed); filter the rest in memory.
    const snap = await db.collection("bookings").where("brand", "==", "bingetown").get();
    const jobs = [];
    snap.forEach((doc) => {
      const b = doc.data();
      if (b.status !== "Pending Advance") return;   // only unpaid, un-abandoned bookings
      if (b.source !== "chat") return;              // never touch seeded demo fixtures
      if (b.paidAt || b.advancePaidAt) return;      // already paid → not abandoned
      const created = Date.parse(b.createdAt || "");
      if (!Number.isFinite(created)) return;
      if (created <= cutoff) {
        jobs.push(doc.ref.set({ status: "Abandoned", abandonedAt: now, updatedAt: now }, { merge: true }));
      }
    });
    await Promise.all(jobs);
    return jobs.length;
  } catch {
    return 0;
  }
}
