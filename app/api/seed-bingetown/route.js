// app/api/seed-bingetown/route.js
// Idempotent seeder for The Binge Town demo. Visit /api/seed-bingetown?key=YOUR_KEY once
// (safe to re-run — fixed doc IDs upsert, never duplicate). Everything is namespaced
// brand:"bingetown" so it never mixes with other demos in the shared Firestore project.

import { getDb } from "../../lib/firebase-admin";

// Timestamps span the last 7 days (relative to run time) so analytics shows a trend.
const iso = (daysAgo, hour = 12) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

// ~12 bookings — 6 Confirmed, 2 Pending Advance, 2 Rescheduled, 1 Cancelled, 1 Completed(CSAT).
const BOOKINGS = [
  { bookingId: "BT-2841", name: "Riya Sharma",   phone: "9880000001", branch: "hyd-jubilee",     branchName: "Jubilee Hills",  city: "Hyderabad", theatre: "Luna",             occasion: "Birthday",     date: "2026-07-12", slot: "7:00 PM",  status: "Confirmed",       addOns: ["cake", "decor", "fog", "fog"],        amount: 2895, createdAt: iso(7, 19) },
  { bookingId: "BT-2842", name: "Arjun Mehta",   phone: "9880000002", branch: "mum-andheri",     branchName: "Andheri",        city: "Mumbai",    theatre: "Duet",             occasion: "Proposal",     date: "2026-07-11", slot: "9:00 PM",  status: "Confirmed",       addOns: ["decor", "bouquet", "photoshoot"],     amount: 3196, createdAt: iso(6, 21) },
  { bookingId: "BT-2843", name: "Neha Gupta",    phone: "9880000003", branch: "del-janakpuri",   branchName: "Janakpuri",      city: "Delhi NCR", theatre: "Regal",            occasion: "Anniversary",  date: "2026-07-13", slot: "6:00 PM",  status: "Pending Advance", addOns: ["cake"],                               amount: 1498, createdAt: iso(2, 18) },
  { bookingId: "BT-2844", name: "Karan Rao",     phone: "9880000004", branch: "blr-koramangala", branchName: "Koramangala",    city: "Bangalore", theatre: "Bloom",            occasion: "Bride-to-be",  date: "2026-07-15", slot: "4:00 PM",  status: "Confirmed",       addOns: ["decor", "cake", "photoshoot"],        amount: 3296, createdAt: iso(5, 16) },
  { bookingId: "BT-2845", name: "Divya S",       phone: "9880000005", branch: "che-omr",         branchName: "OMR Perungudi",  city: "Chennai",   theatre: "Lavish",           occasion: "Baby Shower",  date: "2026-07-14", slot: "12:00 PM", status: "Rescheduled",     addOns: ["decor"],                              amount: 1798, createdAt: iso(6, 12) },
  { bookingId: "BT-2846", name: "Aditya Nair",   phone: "9880000006", branch: "blr-whitefield",  branchName: "Whitefield",     city: "Bangalore", theatre: "Aurora",           occasion: "Birthday",     date: "2026-07-16", slot: "8:00 PM",  status: "Confirmed",       addOns: ["cake", "decor", "fog"],               amount: 2596, createdAt: iso(4, 20) },
  { bookingId: "BT-2847", name: "Sneha Iyer",    phone: "9880000007", branch: "hyd-himayat",     branchName: "Himayat Nagar",  city: "Hyderabad", theatre: "Luna (Moon)",      occasion: "Romantic date",date: "2026-07-12", slot: "9:00 PM",  status: "Rescheduled",     addOns: ["decor", "bouquet"],                   amount: 2197, createdAt: iso(3, 21) },
  { bookingId: "BT-2848", name: "Rohit Verma",   phone: "9880000008", branch: "del-noida",       branchName: "Noida",          city: "Delhi NCR", theatre: "Celeste",          occasion: "Reunion",      date: "2026-07-18", slot: "5:00 PM",  status: "Pending Advance", addOns: [],                                     amount: 1999, createdAt: iso(1, 17) },
  { bookingId: "BT-2849", name: "Meera Joshi",   phone: "9880000009", branch: "mum-andheri",     branchName: "Andheri",        city: "Mumbai",    theatre: "Grand (20-seater)",occasion: "Baby Shower",  date: "2026-07-19", slot: "1:00 PM",  status: "Confirmed",       addOns: ["decor", "cake"],                      amount: 3796, createdAt: iso(2, 13) },
  { bookingId: "BT-2850", name: "Vikram Shetty", phone: "9880000010", branch: "blr-nagavara",    branchName: "Nagavara",       city: "Bangalore", theatre: "Royale",           occasion: "Anniversary",  date: "2026-07-05", slot: "7:00 PM",  status: "Completed",       addOns: ["decor", "cake", "photoshoot"],        amount: 3296, csat: 5, createdAt: iso(5, 19) },
  { bookingId: "BT-2851", name: "Pooja Reddy",   phone: "9880000011", branch: "hyd-jubilee",     branchName: "Jubilee Hills",  city: "Hyderabad", theatre: "Bloom",            occasion: "Birthday",     date: "2026-07-06", slot: "6:00 PM",  status: "Cancelled",       addOns: ["cake"],                               amount: 1498, createdAt: iso(6, 18) },
  { bookingId: "BT-2852", name: "Sanjay Kumar",  phone: "9880000012", branch: "che-omr",         branchName: "OMR Perungudi",  city: "Chennai",   theatre: "Bloom",            occasion: "Farewell",     date: "2026-07-17", slot: "3:00 PM",  status: "Confirmed",       addOns: ["decor", "fnb"],                       amount: 1798, createdAt: iso(1, 15) },
];

// ~6 leads (captured, not booked).
const LEADS = [
  { id: "LEAD-bt-1", name: "Ishita",  phone: "9812300001", occasion: "Proposal",    city: "Bangalore", groupSize: "2",  preferredDate: "2026-07-20", source: "instagram", tag: "hot",  createdAt: iso(1, 11) },
  { id: "LEAD-bt-2", name: "Rahul",   phone: "9812300002", occasion: "Birthday",    city: "Hyderabad", groupSize: "6",  preferredDate: "2026-07-22", source: "whatsapp",  tag: "warm", createdAt: iso(3, 14) },
  { id: "LEAD-bt-3", name: "Fatima",  phone: "9812300003", occasion: "Baby Shower", city: "Mumbai",    groupSize: "12", preferredDate: "2026-07-25", source: "whatsapp",  tag: "hot",  createdAt: iso(2, 10) },
  { id: "LEAD-bt-4", name: "Deepak",  phone: "9812300004", occasion: "Anniversary", city: "Delhi NCR", groupSize: "4",  preferredDate: "2026-07-19", source: "instagram", tag: "warm", createdAt: iso(4, 16) },
  { id: "LEAD-bt-5", name: "Ananya",  phone: "9812300005", occasion: "Bride-to-be", city: "Chennai",   groupSize: "8",  preferredDate: "2026-07-28", source: "whatsapp",  tag: "warm", createdAt: iso(5, 12) },
  { id: "LEAD-bt-6", name: "Manoj",   phone: "9812300006", occasion: "Movie night", city: "Bangalore", groupSize: "5",  preferredDate: "2026-07-15", source: "whatsapp",  tag: "warm", createdAt: iso(6, 20) },
];

// ~4 abandoned bookings (started the flow, dropped before advance) — for recovery.
const ABANDONED = [
  { id: "AB-bt-1", name: "Kiran",  phone: "9822200001", branch: "blr-koramangala", branchName: "Koramangala",   city: "Bangalore", theatre: "Luna",   occasion: "Birthday",    date: "2026-07-21", slot: "7:00 PM", stage: "left before paying advance",      createdAt: iso(1, 13) },
  { id: "AB-bt-2", name: "Priya",  phone: "9822200002", branch: "mum-andheri",     branchName: "Andheri",       city: "Mumbai",    theatre: "Duet",   occasion: "Proposal",    date: "2026-07-23", slot: "9:00 PM", stage: "left before paying advance",      createdAt: iso(2, 21) },
  { id: "AB-bt-3", name: "Suresh", phone: "9822200003", branch: "hyd-jubilee",     branchName: "Jubilee Hills", city: "Hyderabad", theatre: "Lavish", occasion: "Anniversary", date: "2026-07-24", slot: "6:00 PM", stage: "selected add-ons, no payment",    createdAt: iso(3, 18) },
  { id: "AB-bt-4", name: "Neeraj", phone: "9822200004", branch: "del-noida",       branchName: "Noida",         city: "Delhi NCR", theatre: "Mirage", occasion: "Reunion",     date: "2026-07-26", slot: "5:00 PM", stage: "picked theatre, then dropped",    createdAt: iso(4, 17) },
];

export async function GET(req) {
  const key = new URL(req.url).searchParams.get("key");
  if (key !== process.env.ANALYTICS_KEY) {
    return Response.json({ ok: false, error: "bad key" }, { status: 401 });
  }
  try {
    const db = getDb();
    const batch = db.batch();
    for (const b of BOOKINGS) {
      batch.set(db.collection("bookings").doc(b.bookingId), { brand: "bingetown", ...b });
    }
    for (const l of LEADS) {
      const { id, ...data } = l;
      batch.set(db.collection("leads").doc(id), { brand: "bingetown", ...data });
    }
    for (const a of ABANDONED) {
      const { id, ...data } = a;
      batch.set(db.collection("abandoned").doc(id), { brand: "bingetown", ...data });
    }
    await batch.commit();
    return Response.json({
      ok: true,
      seeded: { bookings: BOOKINGS.length, leads: LEADS.length, abandoned: ABANDONED.length },
      note: "Idempotent — safe to re-run.",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
