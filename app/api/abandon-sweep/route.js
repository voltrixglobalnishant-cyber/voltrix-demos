// app/api/abandon-sweep/route.js
// Cron-friendly trigger for the Binge Town abandoned-booking sweep. Marks unpaid, chat-created
// "Pending Advance" bookings "Abandoned" after BOOKING_ABANDON_MINUTES. Key-gated so it can be
// hit from a scheduler. The admin panel also runs this lazily on load, so a cron is optional.
//   GET /api/abandon-sweep?key=YOUR_ANALYTICS_KEY
// Node runtime: firebase-admin can't run on edge.

import { sweepAbandoned, abandonMinutes } from "../../lib/bingetown-abandon";

export const runtime = "nodejs";

export async function GET(req) {
  const key = new URL(req.url).searchParams.get("key");
  if (key !== process.env.ANALYTICS_KEY) {
    return Response.json({ ok: false, error: "bad key" }, { status: 401 });
  }
  const swept = await sweepAbandoned();
  return Response.json({ ok: true, swept, timeoutMinutes: abandonMinutes() });
}
