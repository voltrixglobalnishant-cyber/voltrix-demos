import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) {
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[m[1]] = v;
  }
}

console.log("project_id :", env.FIREBASE_PROJECT_ID);
console.log("client     :", env.FIREBASE_CLIENT_EMAIL);
console.log("key length :", (env.FIREBASE_PRIVATE_KEY || "").length);

initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});

async function tryDb(name) {
  try {
    const db = name ? getFirestore(name) : getFirestore();
    await db.collection("__diag").doc("ping").set({ at: new Date().toISOString() });
    console.log(`\nWRITE OK on database "${name || "(default)"}"`);
    return true;
  } catch (e) {
    console.log(`\nFAIL database "${name || "(default)"}" -> code=${e.code} details=${JSON.stringify(e.details)} msg=${e.message}`);
    return false;
  }
}

await tryDb();
await tryDb("voltrix-demos");
process.exit(0);
