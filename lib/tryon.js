// lib/tryon.js
// Client-side virtual jewellery try-on (Path A — real product compositing, no image-gen API).
// 1) MediaPipe HandLandmarker finds the ring finger in a hand photo.
// 2) A transparent-background ring PNG is composited onto that finger via canvas.
// Runs entirely in the browser → ~₹0 per try-on. All functions are browser-only;
// import them lazily (they touch `window`/`Image`/`canvas`).

const MP_VERSION = "0.10.14";
const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// MediaPipe hand-landmark indices we care about.
const RING_MCP = 13; // base knuckle of the ring finger (where a ring sits)
const RING_PIP = 14; // first joint of the ring finger
const MIDDLE_MCP = 9; // used to estimate finger width

let _landmarkerPromise = null;

// Lazily create (and cache) the HandLandmarker. Loaded from CDN — fine in a real app.
export async function getHandLandmarker() {
  if (_landmarkerPromise) return _landmarkerPromise;
  _landmarkerPromise = (async () => {
    const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
    return HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "IMAGE",
      numHands: 1,
    });
  })().catch((e) => {
    _landmarkerPromise = null; // allow retry on next call
    throw e;
  });
  return _landmarkerPromise;
}

// Load a data/URL string into an <img> and resolve once decoded.
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Detect the ring-finger placement from a hand photo (data URL).
// Returns { ok, placement } where placement is in PIXELS of the given image,
// or { ok:false, reason } if no hand is found.
export async function detectRingFinger(handDataUrl) {
  let landmarker, img;
  try {
    [landmarker, img] = await Promise.all([getHandLandmarker(), loadImage(handDataUrl)]);
  } catch {
    return { ok: false, reason: "load_failed" };
  }

  let res;
  try {
    res = landmarker.detect(img);
  } catch {
    return { ok: false, reason: "detect_failed" };
  }

  const hands = res?.landmarks || [];
  if (!hands.length) return { ok: false, reason: "no_hand" };

  const lm = hands[0];
  const W = img.naturalWidth, H = img.naturalHeight;
  const px = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });

  const mcp = px(RING_MCP);
  const pip = px(RING_PIP);
  const midMcp = px(MIDDLE_MCP);

  // Ring sits ~35% up the proximal phalanx (from the knuckle toward the first joint).
  const t = 0.35;
  const cx = mcp.x + (pip.x - mcp.x) * t;
  const cy = mcp.y + (pip.y - mcp.y) * t;

  // Finger direction → rotation so the ring's vertical axis aligns with the finger.
  const angle = Math.atan2(pip.y - mcp.y, pip.x - mcp.x) - Math.PI / 2;

  // Approx finger width from the gap between the middle and ring knuckles.
  const fingerWidth = dist(mcp, midMcp) * 0.9;

  return {
    ok: true,
    placement: { cx, cy, angle, fingerWidth, imgW: W, imgH: H },
  };
}

// Composite a ring PNG onto the hand photo at the detected placement.
// `scale` tunes the PNG width relative to finger width (per-ring override possible).
// Returns a JPEG data URL of the finished try-on.
export async function compositeRing(handDataUrl, ringPngSrc, placement, scale = 1.25) {
  const [hand, ring] = await Promise.all([loadImage(handDataUrl), loadImage(ringPngSrc)]);

  const canvas = document.createElement("canvas");
  canvas.width = placement.imgW;
  canvas.height = placement.imgH;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(hand, 0, 0, canvas.width, canvas.height);

  // Target on-finger width, preserving the PNG's aspect ratio.
  const targetW = placement.fingerWidth * scale;
  const ratio = ring.naturalHeight / ring.naturalWidth || 1;
  const targetH = targetW * ratio;

  ctx.save();
  ctx.translate(placement.cx, placement.cy);
  ctx.rotate(placement.angle);
  ctx.drawImage(ring, -targetW / 2, -targetH / 2, targetW, targetH);
  ctx.restore();

  return canvas.toDataURL("image/jpeg", 0.85);
}
