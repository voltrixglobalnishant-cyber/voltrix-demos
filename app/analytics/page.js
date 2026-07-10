// app/analytics/page.js
// Your private dashboard. Open it at: yoursite.com/analytics?key=YOUR_SECRET
// It shows: how many conversations per demo, hot-lead counts, and full transcripts.

import { getDb } from "../lib/firebase-admin";
import { sweepAbandoned } from "../lib/bingetown-abandon";

export const dynamic = "force-dynamic"; // always fetch fresh data

export default async function Analytics({ searchParams }) {
  const params = await searchParams;
  const key = params?.key || "";
  const branchFilter = params?.branch || ""; // per-branch (FOFO) view for a franchise owner

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

  // ── Fetch conversations + claims (claims carry the INTERNAL AI score — admin-only) ──
  let convos = [];
  let claims = [];
  try {
    const db = getDb();
    const snap = await db.collection("conversations").orderBy("createdAt", "desc").limit(500).get();
    convos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    try {
      const csnap = await db.collection("claims").orderBy("createdAt", "desc").limit(200).get();
      claims = csnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
  } catch (e) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: 40 }}>
        <h1>Analytics</h1>
        <p style={{ color: "#c00" }}>Couldn't load data yet. If this is the first run, send a test chat first, then refresh.</p>
      </main>
    );
  }

  // ── Binge Town live ops (bookings / leads / abandoned / escalations) — admin-only ──
  // First run the abandoned-booking sweep so unpaid chat bookings past the timeout show as
  // Abandoned the moment an admin refreshes (this is the "next-check" cleanup).
  await sweepAbandoned().catch(() => {});
  let btBookings = [], btLeads = [], btAbandoned = [], btEscalations = [], btDecor = [];
  try {
    const db = getDb();
    const grab = async (coll, order) => {
      try {
        let q = db.collection(coll).where("brand", "==", "bingetown");
        if (order) q = q.orderBy("createdAt", "desc");
        const s = await q.limit(200).get();
        return s.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch {
        // composite index (where + orderBy) may be missing → retry without ordering
        try {
          const s = await db.collection(coll).where("brand", "==", "bingetown").limit(200).get();
          return s.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch { return []; }
      }
    };
    [btBookings, btLeads, btAbandoned, btEscalations, btDecor] = await Promise.all([
      grab("bookings", false), grab("leads", false), grab("abandoned", false),
      grab("escalations", true), grab("decor", true),
    ]);
  } catch {}

  // Per-branch (FOFO) filter — a franchise owner sees only their branch.
  const btBranches = [...new Set(btBookings.map(b => b.branchName || b.branch).filter(Boolean))].sort();
  const bookingsView = branchFilter
    ? btBookings.filter(b => (b.branchName || b.branch) === branchFilter)
    : btBookings;
  const activeStatuses = ["Confirmed", "Completed", "Rescheduled"];
  const btRevenue = bookingsView
    .filter(b => activeStatuses.includes(b.status))
    .reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const csatScores = bookingsView.map(b => Number(b.csat)).filter(n => n > 0);
  const csatAvg = csatScores.length ? (csatScores.reduce((a, c) => a + c, 0) / csatScores.length).toFixed(1) : null;
  const statusCounts = bookingsView.reduce((m, b) => { m[b.status] = (m[b.status] || 0) + 1; return m; }, {});

  // Abandoned recovery list = seeded fixtures + chat bookings the sweep marked "Abandoned"
  // (unpaid past the timeout). Both feed the recovery panel + the Abandoned KPI.
  const abandonedFromBookings = btBookings
    .filter(b => b.status === "Abandoned")
    .map(b => ({
      id: b.id, bookingId: b.bookingId, name: b.name, phone: b.phone,
      branch: b.branch, branchName: b.branchName, city: b.city, theatre: b.theatre,
      occasion: b.occasion, date: b.date, slot: b.slot,
      stage: "unpaid — advance not received", fromBooking: true,
    }));
  const abandonedAll = [...abandonedFromBookings, ...btAbandoned];

  const inr = (n) => "₹" + (Number(n) || 0).toLocaleString("en-IN");
  const btLink = (branch) => `/analytics?key=${encodeURIComponent(key)}${branch ? "&branch=" + encodeURIComponent(branch) : ""}`;

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

      {/* CLAIMS — internal AI photo assessment (score/authenticity live HERE, never in the customer chat) */}
      {claims.length > 0 && (
        <>
          <h2 style={{ marginTop: 36, fontSize: 18 }}>🔍 Photo claims — internal AI assessment</h2>
          <p style={{ color: "#888", fontSize: 13, marginTop: 4 }}>Confidence score &amp; authenticity are internal — customers only see “logged, team will review”.</p>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {claims.map(c => {
              const band = c.band || "—";
              const bandColor = band === "High" ? "#2e7d4f" : band === "Medium" ? "#b8860b" : "#b3402f";
              const authColor = c.authenticity === "real" ? "#2e7d4f" : c.authenticity === "likely_fake" ? "#b3402f" : "#b8860b";
              return (
                <div key={c.id} style={{ border: "1px solid #eaeaea", borderRadius: 12, padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, textTransform: "capitalize" }}>{c.brand || "—"}</span>
                    <span style={{ color: "#666" }}>{c.orderId || "no order"}</span>
                    <span style={{ color: "#666" }}>· {c.issue || "claim"}</span>
                    <span style={{ marginLeft: "auto", fontWeight: 800, fontSize: 20, color: bandColor }}>{c.score ?? "—"}<span style={{ fontSize: 12, color: "#999" }}>/100</span></span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: bandColor }}>{band}</span>
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
                    <span style={{ background: c.damageVisible ? "#fbeaea" : "#eef3ec", color: c.damageVisible ? "#b3402f" : "#2e7d4f", padding: "3px 9px", borderRadius: 20 }}>
                      {c.damageVisible ? "Damage confirmed" : "No clear damage"} · {c.severity || "—"}
                    </span>
                    <span style={{ background: "#f3f3f3", color: authColor, padding: "3px 9px", borderRadius: 20 }}>
                      authenticity: {c.authenticity || "—"}{c.aiGenerated ? " · AI-gen suspected" : ""}
                    </span>
                    {c.doubleChecked && <span style={{ background: "#eef2ff", color: "#4338ca", padding: "3px 9px", borderRadius: 20 }}>double-checked ✓</span>}
                    <span style={{ color: "#999" }}>{c.customerEmail || "—"} · {c.hasPhoto ? "photo ✓" : "no photo"}</span>
                  </div>
                  {c.recommendation && <div style={{ marginTop: 8, fontSize: 13, color: "#444" }}>→ {c.recommendation}</div>}
                  <div style={{ marginTop: 6, fontSize: 12, color: "#aaa" }}>{c.createdAt ? new Date(c.createdAt).toLocaleString() : ""}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── BINGE TOWN — live celebration ops (bookings, leads, revenue, CSAT, escalations) ── */}
      {btBookings.length > 0 && (
        <>
          <h2 style={{ marginTop: 40, fontSize: 18 }}>🎉 The Binge Town — live ops</h2>

          {/* Per-branch (FOFO) filter */}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: "#888" }}>Branch view:</span>
            <a href={btLink("")} style={{ fontSize: 12.5, textDecoration: "none", padding: "4px 11px", borderRadius: 20,
              background: !branchFilter ? "#7c2d5a" : "#f1f1f1", color: !branchFilter ? "#fff" : "#555" }}>All branches</a>
            {btBranches.map(b => (
              <a key={b} href={btLink(b)} style={{ fontSize: 12.5, textDecoration: "none", padding: "4px 11px", borderRadius: 20,
                background: branchFilter === b ? "#7c2d5a" : "#f1f1f1", color: branchFilter === b ? "#fff" : "#555" }}>{b}</a>
            ))}
          </div>
          {branchFilter && <p style={{ fontSize: 12.5, color: "#7c2d5a", marginTop: 8 }}>Showing <b>{branchFilter}</b> only (franchise/FOFO view).</p>}

          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginTop: 14 }}>
            {[
              ["Bookings", bookingsView.length, "#7c2d5a"],
              ["Revenue (locked)", inr(btRevenue), "#2e7d4f"],
              ["Avg CSAT", csatAvg ? csatAvg + " / 5" : "—", "#c9a24b"],
              ["Leads", branchFilter ? "—" : btLeads.length, "#b8860b"],
              ["Abandoned", branchFilter ? "—" : abandonedAll.length, "#b3402f"],
              ["Escalations", branchFilter ? "—" : btEscalations.length, "#4338ca"],
            ].map(([label, val, color]) => (
              <div key={label} style={{ border: "1px solid #eaeaea", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "#888" }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 4 }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Status breakdown */}
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(statusCounts).map(([st, n]) => (
              <span key={st} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, background: "#f6eef2", color: "#7c2d5a" }}>{st}: {n}</span>
            ))}
          </div>

          {/* Bookings table */}
          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 720 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#888", borderBottom: "1px solid #eaeaea" }}>
                  {["Booking", "Guest", "Phone", "Branch", "Theatre", "Occasion", "Date · Slot", "Status", "Amount", "CSAT"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookingsView.sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(bk => (
                  <tr key={bk.id} style={{ borderBottom: "1px solid #f2f2f2" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{bk.bookingId || bk.id}</td>
                    <td style={{ padding: "8px 10px" }}>{bk.name}</td>
                    <td style={{ padding: "8px 10px", color: "#888" }}>{bk.phone}</td>
                    <td style={{ padding: "8px 10px" }}>{bk.branchName || bk.branch}</td>
                    <td style={{ padding: "8px 10px" }}>{bk.theatre}</td>
                    <td style={{ padding: "8px 10px" }}>{bk.occasion}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{bk.date} · {bk.slot}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                        background: bk.status === "Confirmed" ? "#e7f4ec" : bk.status === "Completed" ? "#eef2ff" : bk.status === "Cancelled" ? "#fbeaea" : bk.status === "Rescheduled" ? "#fff4e0" : bk.status === "Abandoned" ? "#fbeaea" : bk.status === "Pending Advance" ? "#fef3c7" : "#f1f1f1",
                        color: bk.status === "Confirmed" ? "#2e7d4f" : bk.status === "Completed" ? "#4338ca" : bk.status === "Cancelled" ? "#b3402f" : bk.status === "Rescheduled" ? "#b8860b" : bk.status === "Abandoned" ? "#b3402f" : bk.status === "Pending Advance" ? "#92600a" : "#666" }}>
                        {bk.status}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{inr(bk.amount)}</td>
                    <td style={{ padding: "8px 10px" }}>{bk.csat ? bk.csat + "★" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Leads + Abandoned + Escalations + Decor reads — hidden in single-branch view */}
          {!branchFilter && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 20 }}>
              <div style={{ border: "1px solid #eaeaea", borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>🔥 Leads ({btLeads.length})</div>
                {btLeads.map(l => (
                  <div key={l.id} style={{ fontSize: 12.5, color: "#444", padding: "5px 0", borderBottom: "1px solid #f4f4f4" }}>
                    <b>{l.name || "—"}</b> · {l.occasion} · {l.city} · {l.groupSize} pax
                    <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: l.tag === "hot" ? "#d97706" : "#7c2d5a" }}>{(l.tag || "").toUpperCase()}</span>
                    <span style={{ color: "#aaa" }}> · {l.source}</span>
                  </div>
                ))}
              </div>
              <div style={{ border: "1px solid #eaeaea", borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>🕗 Abandoned — recover ({abandonedAll.length})</div>
                {abandonedAll.map(a => (
                  <div key={a.id} style={{ fontSize: 12.5, color: "#444", padding: "5px 0", borderBottom: "1px solid #f4f4f4" }}>
                    <b>{a.name || "—"}</b> · {a.theatre} @ {a.branchName || a.branch} · {a.occasion} · {a.date} {a.slot}
                    {a.fromBooking && a.bookingId && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#7c2d5a" }}>{a.bookingId}</span>}
                    <div style={{ color: "#b3402f", fontSize: 11.5 }}>{a.stage}</div>
                  </div>
                ))}
              </div>
              <div style={{ border: "1px solid #eaeaea", borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>↗ Escalations ({btEscalations.length})</div>
                {btEscalations.length === 0 && <div style={{ fontSize: 12.5, color: "#aaa" }}>None yet.</div>}
                {btEscalations.map(e => (
                  <div key={e.id} style={{ fontSize: 12.5, color: "#444", padding: "5px 0", borderBottom: "1px solid #f4f4f4" }}>
                    {e.reason || "Human handoff requested"}
                    <span style={{ color: "#aaa" }}> · {e.createdAt ? new Date(e.createdAt).toLocaleString() : ""}</span>
                  </div>
                ))}
              </div>
              {btDecor.length > 0 && (
                <div style={{ border: "1px solid #eaeaea", borderRadius: 12, padding: 16 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>🎨 Decor-match reads — internal ({btDecor.length})</div>
                  <p style={{ fontSize: 11.5, color: "#aaa", marginTop: -4, marginBottom: 6 }}>Vision reasoning &amp; confidence are internal — the guest only saw a friendly recommendation.</p>
                  {btDecor.map(d => (
                    <div key={d.id} style={{ fontSize: 12.5, color: "#444", padding: "5px 0", borderBottom: "1px solid #f4f4f4" }}>
                      <b>{d.matchedTheme}</b> · {d.vibe || "—"} · {d.suggestedTheatre || "—"}
                      <span style={{ marginLeft: 6, fontSize: 11, color: "#7c2d5a" }}>{d.confidence != null ? d.confidence + "/100" : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* TRANSCRIPTS */}
      <h2 style={{ marginTop: 36, fontSize: 18 }}>Recent conversations</h2>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
        {convos.map(c => (
          <details key={c.id} style={{ border: "1px solid #eaeaea", borderRadius: 12, padding: "14px 18px", background: c.isHot ? "#fffbeb" : "#fff" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              <span style={{ textTransform: "capitalize" }}>{c.brand}</span>
              {(c.leadTag || (c.isHot ? "hot" : "")) && (
                <span style={{
                  marginLeft: 8, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                  background: c.leadTag === "hot" || c.isHot ? "#fef3c7" : c.leadTag === "warm" ? "#fee2e2" : "#f1f5f9",
                  color: c.leadTag === "hot" || c.isHot ? "#d97706" : c.leadTag === "warm" ? "#dc2626" : "#64748b",
                  textTransform: "uppercase", letterSpacing: ".05em",
                }}>
                  {c.leadTag === "hot" || c.isHot ? "🔥 hot" : c.leadTag || "cold"}
                </span>
              )}
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