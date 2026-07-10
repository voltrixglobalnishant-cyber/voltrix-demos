import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

// Firestore database ID. This project uses a NAMED database ("voltrix-demos"), not "(default)".
// Set FIRESTORE_DATABASE_ID in .env.local; falls back to "(default)" so nothing breaks if unset.
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";

function ensureApp() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET, // e.g. <project-id>.appspot.com
    });
  }
}

export function getDb() {
  ensureApp();
  return getFirestore(getApp(), DATABASE_ID);
}

// Storage bucket for durable try-on image hosting. Requires FIREBASE_STORAGE_BUCKET
// and an enabled Cloud Storage bucket on the Firebase project.
export function getBucket() {
  ensureApp();
  return getStorage().bucket();
}
