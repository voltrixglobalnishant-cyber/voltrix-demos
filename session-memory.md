# Session Memory — voltrix-demos

## Last task completed (2026-07-10, NEWEST) — Binge Town chat/prompt upgrade (6 features)
Reworked the Binge Town concierge + system prompt and the booking→pay→abandon lifecycle. All built, saved, built clean, and tested end-to-end against live Firestore + the running dev server.

**What changed:**
1. **Indian phone validation** — new PHONE section in `lib/brands/bingetown.js`: accept any format silently, strip non-digits, take last 10, valid = 10 digits AND first digit 6-9; ask once only if it fails, never re-nag formatting.
2. **Inline payment link** — bot now ALWAYS sends the pay link in chat (removed all "team will send the link" language). New booking → bot writes `/pay/NEW`, the chat route swaps in the real id.
3. **Payment → DB reflection (core):**
   - `applyBingetownTokens` in `app/api/chat/route.js`: on `[BOOKING]` it now GENERATES a real `BT-####` id (new `newBingetownBookingId()`, range 3000-9998, collision-checked), creates the booking doc immediately with `status:"Pending Advance", source:"chat"`, then replaces `/pay/NEW` in the reply with `/pay/<id>` (fallback appends a link if the model forgot).
   - `app/api/pay/route.js` POST now sets status → **"Confirmed"** (+ `paidAt`) on mock payment (was "Advance Paid").
   - **Abandon sweep** — NEW `app/lib/bingetown-abandon.js` (`sweepAbandoned()` + `abandonMinutes()`): marks unpaid, **source:"chat"** "Pending Advance" bookings older than `BOOKING_ABANDON_MINUTES` (default 10) as "Abandoned". Only chat bookings are swept — seeded Pending Advance fixtures (BT-2843/2848) are protected. Runs lazily on `/analytics` load, fire-and-forget in the chat route, and via NEW key-gated route `app/api/abandon-sweep/route.js` (cron-friendly).
   - `.env.local`: added `BOOKING_ABANDON_MINUTES=10` (set to 2 for live demos — needs dev restart).
   - `app/analytics/page.js`: runs the sweep on load; merges status="Abandoned" bookings into the Abandoned recovery list + KPI; added status-badge colours for Abandoned + Pending Advance.
4. **Over-escalation fix** — rewrote the ESCALATION section: AI now HANDLES custom decor, colour schemes, and dual/combined occasions (birthday+proposal) itself (confirm decor → match theme → add to package → itemised total → payment link). Escalates ONLY for multi-day events, out-of-catalogue, disputes, or stuck 2+ times. Token now bound to the **identification turn** (must emit `[ESCALATE]` the first reply it recognises the case, even while asking for contact) — Haiku wouldn't emit it on a closing turn otherwise.
5. **Image upload for decor** — already built last session (decor-match vision, internal-only). Re-verified the decor card shows only theme + friendly message, no scores.
6. **Hinglish** — strengthened LANGUAGE section: auto-detect Roman-Hindi+English and reply in natural WhatsApp Hinglish.

**Files:** MODIFIED `lib/brands/bingetown.js`, `app/api/chat/route.js`, `app/api/pay/route.js`, `app/analytics/page.js`, `.env.local`. CREATED `app/lib/bingetown-abandon.js`, `app/api/abandon-sweep/route.js`. (Build: 18 routes, PASS clean.)

**Tested end-to-end (live server + Firestore), all PASS:**
- Book (chat) → got inline `/pay/BT-6674`; Firestore booking created Pending Advance/source chat/amount ₹2197.
- Pay via `/api/pay` → status flipped to **Confirmed** + paidAt.
- Backdated unpaid chat booking + `/api/abandon-sweep` (10-min env) → status **Abandoned**; seeded BT-2843 stayed Pending Advance (not swept).
- Phone: `5123456789` questioned; `+91 98765 43210` accepted with no reformat nag.
- Over-escalation: dual occasion + red/gold colour → `escalate:false`, handled inline. Multi-day (single-turn, contact given) → `escalate:true` + escalation doc written.
- Hinglish message → Hinglish reply.
- All test bookings/escalations/ratelimit docs cleaned up afterward; DB pristine (12 seeded bookings, 0 stray). Re-seeded at start of session.
- **NOTE:** Haiku still occasionally emits `**bold**`/`- bullets` in booking confirmations despite the no-markdown rule (pre-existing cosmetic tendency; the `/pay/BT-XXXX` link still renders clickable via `linkifyBot`). Not a regression.
- Dev server left running (background) on http://localhost:3000.

## Prior task (2026-07-10)
Wired a NAMED Firestore database through the app + scripts via `FIRESTORE_DATABASE_ID` (falls back to "(default)").
- **MODIFIED** `app/lib/firebase-admin.js` — `getDb()` now `getFirestore(getApp(), DATABASE_ID)`, `DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)"`. Imported `getApp`.
- **MODIFIED** `scripts/seed-bingetown.js` + `scripts/check-firestore.js` — same FIRESTORE_DATABASE_ID wiring; seed captures the app and passes db id.
- **MODIFIED** `.env.local` — added `FIRESTORE_DATABASE_ID=voltrix-demos`. NOTE: my first `Add-Content` append had no leading newline and concatenated onto `FLUX_API_KEY` (corrupted it 32→67 chars); repaired by stripping the suffix and re-adding on its own line. FLUX_API_KEY back to 32 chars, private key intact (1734). Lesson: `.env.local` lacked trailing newline — future appends must add a leading "`n" or rewrite via Set-Content.
- `npm run build` — PASS clean.
- **RESOLVED:** real DB id is `default` (a NAMED database — NOT the SDK's built-in `(default)` with parens). Set `FIRESTORE_DATABASE_ID=default` in .env.local. Seed SUCCEEDED: 12 bookings, 6 leads, 4 abandoned. check-firestore confirms `projects/voltrix-demos/databases/default/...` reachable + BT-2841 exists=true. Firestore blocker is now CLEARED.
- Reminder: restart `npm run dev` after the env change so app routes use the named database.
- Diagnostic: `node scripts/check-firestore.js` (prints project/db id/full path + reachability). Seed: `node scripts/seed-bingetown.js`.
- **Dev server restarted** after the env change; `/analytics?key=<ANALYTICS_KEY>` verified HTTP 200 and POPULATED — all 12 seeded BT-#### bookings render, plus Escalations + Avg CSAT tiles. Firestore end-to-end confirmed working. FOFO view: add `&branch=Andheri`.
- **Reschedule flow TESTED end-to-end (live /api/chat + Firestore):** wrong phone (9999999999) → refused, no write. Correct phone (9880000003) → verified Neha Gupta, offered new slot with "subject to confirmation", confirmed → Firestore BT-2843 went {2026-07-13, 6:00 PM, Pending Advance} → {2026-07-18, 8:00 PM, Rescheduled}. No token leaked in any turn. NOTE: BT-2843 is now Rescheduled in the DB — re-run seed to reset for a pristine demo. Minor cosmetic: bot said "₹750 advance already locked" though booking was Pending Advance (not paid) — could tighten prompt if desired.

## Task before (2026-07-10, latest)
Created standalone **`scripts/seed-bingetown.js`** (CommonJS) so `node scripts/seed-bingetown.js` works — self-loads `.env.local` (no dotenv dep), authenticates with FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY (repo does NOT use GOOGLE_APPLICATION_CREDENTIALS), mirrors the route's seed data (12 bookings/6 leads/4 abandoned), idempotent.
- **Ran it:** auth SUCCEEDED (creds in .env.local are valid) but seed failed with `5 NOT_FOUND` — the Firestore **database does not exist** for project `voltrix-demos`. This is the known blocker, NOT an auth/credentials issue.
- **FIX (user must do in console):** Firebase console → project voltrix-demos → Firestore Database → Create database (pick region e.g. asia-south1) → then re-run `node scripts/seed-bingetown.js`. Until then all Firestore-backed features (admin populate, live booking lookup, reschedule write, /pay "Advance Paid" write) can't persist, though everything is fail-open so chat + pay UI still work.

## Task before that (2026-07-10, later)
Added **mock advance-payment page** at `/pay/[bookingId]` for Binge Town.
- **CREATED** `app/pay/[bookingId]/page.js` — dark brand-themed client page (bingetown theme tokens + logo placeholder). Loads booking summary via GET `/api/pay`, shows branch/theatre/occasion/date·slot/guest, single "Pay ₹750 Advance" button → 2s "Securing your slot…" spinner → "Payment Successful" screen with booking ID + confirmation. Fail-open if summary can't load (still lets them pay).
- **CREATED** `app/api/pay/route.js` (Node) — GET returns booking summary (namespaced brand:"bingetown"); POST sets booking status → "Advance Paid" (+ `advancePaidAt`/`advanceAmount`) and logs a `payments` doc. Best-effort; never blocks the success screen.
- **MODIFIED** `lib/brands/bingetown.js` — ADVANCE PAYMENT FLOW prompt now emits the working link exactly as `/pay/<bookingId>` (e.g. `/pay/BT-2843`) for bookings that have an ID; brand-new bookings → team sends link on WhatsApp.
- **MODIFIED** `app/demo/[brand]/page.js` — added brand-neutral `linkifyBot()` (URLs + internal `/…` paths → clickable `.vx-link` anchors) used for all bot replies (line ~831 render), plus `.vx-link` theme CSS in `buildCSS`. So the bot's `/pay/BT-XXXX` link is clickable in the widget. Generic (not brand-specific) per Rule #4.
- `npm run build` — **PASS** clean; `/pay/[bookingId]` and `/api/pay` both compile (now 17 routes). Files verified on disk (page 10,431 B, route 2,758 B).
- Live Firestore write ("Advance Paid") can only be fully confirmed against a provisioned Firestore (same known env blocker); page + POST are fail-open so the demo flow works regardless.

## Previous task completed
Built **The Binge Town** demo (`/demo/bingetown`) end-to-end per `bingetown_build_spec.md` —
private-theatre celebration chain: Nexus AI concierge (booking flow, reschedule, advance,
occasion-aware upsell, transparent package builder, group-size optimizer, multilingual,
CSAT, escalation), Firestore-backed live bookings + admin ops, and a decor-match vision feature.

## Files created / modified
- **CREATED** `lib/brands/bingetown.js` — full brand config + system prompt (catalogue, tokens, anti-hallucination). Modeled on `lakemiraya.js`.
- **MODIFIED** `lib/brands/index.js` — imported + registered `bingetown` in the BRANDS registry.
- **MODIFIED** `app/api/chat/route.js` — added `bingetownBookingsBlock()` (injects live bookings) and `applyBingetownTokens()` (parses/persists/strips `[BOOKING] [RESCHEDULE] [LEAD] [UPSELL] [CSAT] [REMINDER] [ESCALATE]`). KorinMi paths untouched.
- **CREATED** `app/api/seed-bingetown/route.js` — idempotent seeder (key-gated by `ANALYTICS_KEY`): 12 bookings, 6 leads, 4 abandoned, all `brand:"bingetown"`, timestamps span last 7 days.
- **CREATED** `app/api/decor-match/route.js` — Node route, Claude vision → matches inspiration photo to a Binge Town decor theme; full read persisted to `decor` collection (admin-only), customer sees only a friendly line.
- **MODIFIED** `app/demo/[brand]/page.js` — added `decorEnabled` gate + `runDecorMatch()` + decor render card (reuses `.vx-tryon` styles; no CSS added). Paperclip photo on bingetown → decor-match.
- **MODIFIED** `app/analytics/page.js` — added Binge Town live-ops admin section: KPI cards (bookings/revenue/CSAT/leads/abandoned/escalations), bookings table, per-branch (FOFO) filter via `?branch=`, leads/abandoned/escalations/decor panels.

## Verification status (re-verified 2026-07-10)
- `npm run build` — **PASS** clean, Next 16.2.9, all 15 routes compile incl. `/api/decor-match`, `/api/seed-bingetown`, `/demo/[brand]`. Only an informational "edge runtime disables static generation" notice (from edge vision routes) — not an error.
- Disk audit — **PASS**: `bingetown.js` (full config + system prompt), `index.js` (registered), `chat/route.js` (bingetownBookingsBlock + applyBingetownTokens handling all 7 tokens BOOKING/RESCHEDULE/LEAD/UPSELL/CSAT/REMINDER/ESCALATE + strip), `seed-bingetown/route.js` (12 bookings/6 leads/4 abandoned, idempotent fixed-doc upsert), `decor-match/route.js`, `page.js` (decorEnabled gate + runDecorMatch), `analytics/page.js` (full Binge Town live-ops section + FOFO per-branch filter) — all non-empty on disk.
- `/demo/bingetown` — **PASS** loads 200, no "Demo not found" (registry confirmed on disk).
- Chat smoke tests (real Anthropic call) — **PASS**: Chromecast/no-OTT answer, proposal→Duet@Andheri concierge, Hindi reply, reschedule identity-gate (asks phone, no token leak).

## Blockers / issues found
- **Firestore `5 NOT_FOUND` in local env** — affects `/api/seed-bingetown` AND the pre-existing `/api/seed` (korinmi) identically. This is an environment/DB-provisioning issue (the Firestore database isn't reachable/created for the configured project locally), **NOT a code bug**. Chat is fail-open so it still works. To fully verify seed + admin populate + live-booking lookup + reschedule write, run against an env where Firestore is provisioned, then `GET /api/seed-bingetown?key=<ANALYTICS_KEY>`.
- Haiku occasionally emits `**bold**` despite the "no markdown" prompt rule (brand-wide tendency, also in korinmi). Cosmetic only.

## Pending (next steps in order)
1. Provision/point to a live Firestore, then `GET /api/seed-bingetown?key=<ANALYTICS_KEY>` (idempotent).
2. Re-verify: reschedule BT-2843 (writes status→Rescheduled), admin table populated, per-branch filter, decor-match persists.
3. Optional: `FIREBASE_STORAGE_BUCKET` not needed for decor-match (no image hosting used).

## Registry status (brands confirmed on disk)
`lib/brands/index.js` BRANDS: chiaroscuro, moxie, korinmi, eclat, lakemiraya, **bingetown** ✓ (aura, maison, brew).

## Dev server
Left running in background on http://localhost:3000 (via `npm run dev`).
