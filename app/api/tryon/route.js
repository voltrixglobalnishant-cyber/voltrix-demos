// app/api/tryon/route.js
// Persists an Éclat virtual try-on: uploads the hand photo + composited overlays to
// Firebase Storage (durable URLs) and logs a `tryOns` record in Firestore.
// Node runtime (firebase-admin needs Node — cannot run on edge).
// Images live in Storage; Firestore holds only metadata + URLs (1 MiB doc limit).

import { randomUUID } from "crypto";
import { getDb, getBucket } from "../../lib/firebase-admin";

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
function validPhone(p) { const d = (p || "").replace(/\D/g, ""); return d.length === 10 && /^[6-9]/.test(d); }

// Upload a data-URL image to Storage and return a durable public URL.
// Prefers making the object public; falls back to a long-lived signed URL if the
// bucket uses uniform access (object ACLs disabled).
async function uploadImage(bucket, path, dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  const token = randomUUID();
  const file = bucket.file(path);

  await file.save(buffer, {
    resumable: false,
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });

  try {
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${encodeURI(path)}`;
  } catch {
    // uniform bucket-level access → use the Firebase download token URL
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  }
}

export async function POST(req) {
  try {
    const {
      tryOnName, email, phone, consent,
      handPhoto, overlays, // overlays: [{ ringName, dataUrl }]
    } = await req.json();

    // Consent is required to STORE anything. Without it, we persist nothing.
    if (!consent) return Response.json({ ok: false, error: "no consent" });
    if (!EMAIL_RE.test(email || "") || !validPhone(phone || "")) {
      return Response.json({ ok: false, error: "invalid lead" });
    }
    const items = Array.isArray(overlays) ? overlays.filter((o) => o?.dataUrl) : [];
    if (!items.length) return Response.json({ ok: false, error: "no overlays" });

    const userId = randomUUID();
    const base = `tryons/${userId}`;

    let bucket;
    try { bucket = getBucket(); }
    catch { return Response.json({ ok: false, error: "storage unavailable" }); }

    // hand photo (best-effort — a failed hand upload shouldn't block the record)
    let handPhotoUrl = null;
    try { handPhotoUrl = await uploadImage(bucket, `${base}/hand.jpg`, handPhoto); } catch {}

    // overlay images
    const overlayImages = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const url = await uploadImage(bucket, `${base}/overlay-${i}.jpg`, items[i].dataUrl);
        if (url) overlayImages.push({ ringName: items[i].ringName || `Design ${i + 1}`, url });
      } catch {}
    }
    if (!overlayImages.length) return Response.json({ ok: false, error: "upload failed" });

    // Log metadata only — never raw image bytes in Firestore (1 MiB doc cap).
    const record = {
      userId,
      tryOnName: (tryOnName || "My Éclat try-on").toString().slice(0, 80),
      handPhotoUrl,
      overlayImages,
      ringNames: overlayImages.map((o) => o.ringName),
      email, phone, consent: true,
      brand: "eclat",
      timestamp: new Date().toISOString(),
    };

    try {
      const db = getDb();
      await db.collection("tryOns").doc(userId).set(record);
    } catch {
      return Response.json({ ok: false, error: "log failed" });
    }

    return Response.json({ ok: true, id: userId, overlayImages, handPhotoUrl });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
