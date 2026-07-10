# Voltrix Demos — Project Blueprint

## Stack
Next.js 16.2.9 (Turbopack), App Router. Node runtime for DB routes, edge for pure-Claude routes. Firestore (firebase-admin). Claude API (claude-haiku-4-5-20251001 for chat/vision). Resend (email). No TypeScript strict mode — use .js not .tsx.

## Structure
```
app/
  demo/[brand]/page.js       # storefront + chat widget (ALL brands share this file)
  api/chat/route.js          # main chat, Node runtime, reads Firestore orders+kb
  api/analyze/route.js       # damage photo vision analysis (edge)
  api/skin-analysis/route.js # skin/hair vision analysis (edge)
  api/claim/route.js         # emails claim + logs to Firestore (Node)
  api/plan/route.js          # beauty plan → email/whatsapp (Node)
  api/log/route.js           # analytics logging (Node)
  api/seed/route.js          # one-time DB seeder, key-gated
  admin/page.js              # Shopify-style live admin (Node)
lib/
  brands/*.js                # one file per brand, export const <brandname> = {...}
  brands/index.js            # registry — MUST import + register every brand
  firebase-admin.js          # Firestore connector
```

## Critical Rules
1. **Cursor sometimes fails to save files silently.** After any edit, verify with `type <path>` before testing. Empty file = the #1 recurring bug in this repo.
2. **Path depth matters**: `app/analyze/` → `../lib`; `app/api/log/` → `../../lib`; `app/demo/[brand]/` → `../../../lib`. Wrong depth = build fails silently or 404s.
3. **Brand files**: every brand needs (a) file in `lib/brands/`, (b) import in `index.js`, (c) entry in the BRANDS registry object. Missing any = "Demo not found."
4. **page.js is shared across ALL brands** — never brand-specific logic in it, only `brand.theme`/`brand.store` driven.
5. **Never confirm an action (photo received, refund approved) unless the actual system signal exists** — no hallucinated confirmations.
6. **Photo scores are internal-only** — never surfaced to the customer in chat, only in email/admin.

## Test Commands
```
npm run dev              # local dev
npm run build             # catches build errors before push — ALWAYS run before pushing
type <path>                # verify file saved (Windows) — run after every Cursor edit
```

## Verification (run after any feature change)
1. `npm run build` — must pass clean.
2. Visit `/demo/korinmi` — chat loads, no console errors.
3. Test order lookup with wrong email → must refuse (identity gate).
4. Test photo upload → analysis card appears, no duplicate messages.
5. Check `/admin?key=...` — reflects any DB changes made via chat.

## Known Gotchas
- WebP images fail vision analysis — always downscale/convert to JPEG client-side first.
- Edge runtime cannot use firebase-admin — routes touching Firestore must be Node runtime (no `export const runtime = "edge"`).
- Env changes require dev server restart.

## SESSION MEMORY RULE
- On every exit or end of task, write/update `session-memory.md` in project root
- Format:
  - Last task completed
  - Files created/modified (with paths)
  - What's pending (next steps in order)
  - Blockers/issues found
  - Registry status (brands confirmed on disk)
- On every NEW session start, read `session-memory.md` FIRST before doing anything
- Never start fresh if this file exists