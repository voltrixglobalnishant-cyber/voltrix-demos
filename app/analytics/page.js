// app/analytics/page.js
// Your private dashboard. Open it at: yoursite.com/analytics?key=YOUR_SECRET
// It shows: how many conversations per demo, hot-lead counts, and full transcripts.

import { getDb } from "../lib/firebase-admin";

export const dynamic = "force-dynamic"; // always fetch fresh data

export default async function Analytics({ searchParams }) {
  const params = await searchParams;
  const key = params?.key || "";

  // ── Password gate ──
  if (key !== process.env.ANALYTICS_KEY) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: 40, maxWidth: 500, margin: "60px auto", textAlign: "center" }}>
        <h1>🔒 Private</h1>
        <p style={{ color: "#666" }}>Add your access key to the web address to view analytics, like:</p>
        <code style={{ background: "#f3f3f3", padding: "8px 12px", borderRadius: 6, display: "inline-block" }}>
          /analytics?key=YOUR_KEY
        </code>
      </main>
    );
  }

  // ── Fetch conversations ──
  let convos = [];
  try {
    const db = getDb();
    const snap = await db.collection("conversations").orderBy("createdAt", "desc").limit(500).get();
    convos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: 40 }}>
        <h1>Analytics</h1>
        <p style={{ color: "#c00" }}>Couldn't load data yet. If this is the first run, send a test chat first, then refresh.</p>
      </main>
    );
  }

  // ── Count per brand ──
  const byBrand = {};
  for (const c of convos) {
    if (!byBrand[c.brand]) byBrand[c.brand] = { total: 0, hot: 0 };
    byBrand[c.brand].total++;
    if (c.isHot) byBrand[c.brand].hot++;
  }
  const brands = Object.entries(byBrand).sort((a, b) => b[1].total - a[1].total);

  return (
    <main style={{ fontFamily: "sans-serif", padding: "30px 24px", maxWidth: 860, margin: "0 auto", color: "#1a1a1a" }}>
      <h1 style={{ fontSize: 28 }}>📊 Nexus Analytics</h1>
      <p style={{ color: "#666", marginTop: 4 }}>{convos.length} total conversations logged</p>

      {/* SUMMARY CARDS */}
      <h2 style={{ marginTop: 28, fontSize: 18 }}>By demo</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginTop: 12 }}>
        {brands.map(([brand, s]) => (
          <div key={brand} style={{ border: "1px solid #eaeaea", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 17, textTransform: "capitalize" }}>{brand}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "#007B7B", marginTop: 6 }}>{s.total}</div>
            <div style={{ fontSize: 13, color: "#888" }}>conversations</div>
            {s.hot > 0 && (
              <div style={{ marginTop: 8, fontSize: 13, color: "#d97706", fontWeight: 600 }}>🔥 {s.hot} hot lead{s.hot > 1 ? "s" : ""}</div>
            )}
          </div>
        ))}
      </div>

      {/* TRANSCRIPTS */}
      <h2 style={{ marginTop: 36, fontSize: 18 }}>Recent conversations</h2>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
        {convos.map(c => (
          <details key={c.id} style={{ border: "1px solid #eaeaea", borderRadius: 12, padding: "14px 18px", background: c.isHot ? "#fffbeb" : "#fff" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              <span style={{ textTransform: "capitalize" }}>{c.brand}</span>
              {c.isHot && <span style={{ color: "#d97706" }}> 🔥</span>}
              <span style={{ color: "#999", fontWeight: 400, fontSize: 13 }}> — {c.messageCount} messages · {new Date(c.createdAt).toLocaleString()}</span>
            </summary>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {(c.messages || []).map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "80%", padding: "8px 12px", borderRadius: 12, fontSize: 14,
                    background: m.role === "user" ? "#007B7B" : "#f1f1f1",
                    color: m.role === "user" ? "#fff" : "#222",
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}