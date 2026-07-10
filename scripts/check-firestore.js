// scripts/check-firestore.js
// Diagnostic: prints the exact project + Firestore database ID + full document resource
// path the seeder targets, then does one lightweight read to classify any error.
//   Usage:  node scripts/check-firestore.js
// Set a named DB to test:  $env:FIRESTORE_DATABASE_ID = "mydb"; node scripts/check-firestore.js

const fs = require("fs");
const path = require("path");
const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function loadEnv(file) {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(".env.local");

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });

// Target the same named database the app + seeder use (FIRESTORE_DATABASE_ID, else "(default)").
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const db = getFirestore(app, DATABASE_ID);

// Dig the database id out of the live handle across SDK versions.
const dbId =
  (db.databaseId && (db.databaseId.database || db.databaseId)) ||
  (db._databaseId && (db._databaseId.database || db._databaseId)) ||
  (db._settings && db._settings.databaseId) ||
  "(default)";

const projectId = process.env.FIREBASE_PROJECT_ID;
const ref = db.collection("bookings").doc("BT-2841");
// formattedName is the fully-qualified resource path in @google-cloud/firestore.
const fullPath =
  ref.formattedName ||
  `projects/${projectId}/databases/${dbId}/documents/bookings/BT-2841`;

console.log("──────────────────────────────────────────────");
console.log("FIREBASE_PROJECT_ID        :", projectId);
console.log("FIRESTORE_DATABASE_ID env  :", process.env.FIRESTORE_DATABASE_ID || "(not set → SDK uses \"(default)\")");
console.log("Database ID being targeted :", JSON.stringify(dbId));
console.log("Relative doc path          :", ref.path);
console.log("FULL resource path         :", fullPath);
console.log("──────────────────────────────────────────────");

ref
  .get()
  .then((snap) => {
    console.log("✓ Reachable. Database exists. Doc BT-2841 exists:", snap.exists);
    process.exit(0);
  })
  .catch((e) => {
    const msg = String(e && e.message ? e.message : e);
    console.error("✗ Read failed:", msg);
    if (/NOT_FOUND/i.test(msg)) {
      console.error(`  → No database named ${JSON.stringify(dbId)} in project "${projectId}".`);
      console.error("    Either that database was never created, OR you created a NAMED database");
      console.error("    (not \"(default)\"). If named, set FIRESTORE_DATABASE_ID and pass it to getFirestore().");
    }
    process.exit(1);
  });
