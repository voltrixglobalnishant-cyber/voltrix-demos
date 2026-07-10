"use client";
// app/pay/[bookingId]/page.js
// Mock advance-payment page for The Binge Town. Dark, brand-themed.
// Flow: load booking summary (GET /api/pay) -> "Pay ₹750 Advance" -> 2s processing
// -> "Payment Successful" (updates Firestore status to "Advance Paid" via POST /api/pay).
// Self-contained: no shared CSS; brand tokens pulled from the bingetown config.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getBrand } from "../../../lib/brands";

const t = getBrand("bingetown").theme;
const ADVANCE = 750;

// "2026-07-12" -> "12 Jul 2026"
function prettyDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function PayPage() {
  const params = useParams();
  const bookingId = (params?.bookingId || "").toString().toUpperCase();

  const [phase, setPhase] = useState("loading"); // loading | ready | processing | success
  const [booking, setBooking] = useState(null);
  const [advance, setAdvance] = useState(ADVANCE);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/pay?bookingId=${encodeURIComponent(bookingId)}`);
        const d = await r.json();
        if (!alive) return;
        if (d.advance) setAdvance(d.advance);
        if (d.ok && d.booking) setBooking(d.booking);
      } catch {}
      if (alive) setPhase("ready");
    })();
    return () => { alive = false; };
  }, [bookingId]);

  async function pay() {
    setPhase("processing");
    const post = fetch("/api/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId }),
    }).catch(() => {});
    // Hold the spinner for a beat so the "securing your slot" moment reads.
    await Promise.all([post, new Promise((res) => setTimeout(res, 2000))]);
    setPhase("success");
  }

  const rows = booking
    ? [
        ["Guest", booking.name],
        ["Branch", booking.branch && (booking.city ? `${booking.branch}, ${booking.city}` : booking.branch)],
        ["Theatre", booking.theatre],
        ["Occasion", booking.occasion],
        ["Date & slot", [prettyDate(booking.date), booking.slot].filter(Boolean).join(" · ")],
      ].filter(([, v]) => v)
    : [];

  return (
    <div style={S.wrap}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div style={S.card} className="bt-card">
        {/* Logo placeholder */}
        <div style={S.brand}>
          <span style={S.logoRing}>{getBrand("bingetown").initial}</span>
          <span style={S.wordmark}>THE BINGE TOWN</span>
        </div>
        <div style={S.tagline}>Private theatres for unforgettable celebrations</div>

        {phase === "loading" && (
          <div style={S.center}>
            <div className="bt-spin" style={S.spin} />
            <div style={S.muted}>Loading your booking…</div>
          </div>
        )}

        {phase !== "loading" && phase !== "success" && (
          <>
            <div style={S.bookingIdChip}>Booking {bookingId}</div>

            {rows.length > 0 ? (
              <div style={S.summary}>
                {rows.map(([k, v]) => (
                  <div key={k} style={S.row}>
                    <span style={S.rowKey}>{k}</span>
                    <span style={S.rowVal}>{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={S.summaryFallback}>
                We couldn’t load the full details here — no problem, your ₹{advance} advance still
                locks the slot and our team confirms everything on WhatsApp.
              </div>
            )}

            <div style={S.advanceBox}>
              <div style={S.advanceLabel}>Advance to lock your slot</div>
              <div style={S.advanceAmt}>₹{advance}</div>
              <div style={S.advanceNote}>Balance paid on the day · advance is non-refundable per policy</div>
            </div>

            <button
              style={{ ...S.payBtn, ...(phase === "processing" ? S.payBtnBusy : null) }}
              className="bt-pay"
              onClick={pay}
              disabled={phase === "processing"}
            >
              {phase === "processing" ? (
                <span style={S.btnBusyInner}>
                  <span className="bt-spin" style={S.spinSm} /> Securing your slot…
                </span>
              ) : (
                `Pay ₹${advance} Advance`
              )}
            </button>

            <div style={S.secure}>🔒 Secure mock payment · demo environment</div>
          </>
        )}

        {phase === "success" && (
          <div style={S.center}>
            <div style={S.check} className="bt-pop">✓</div>
            <div style={S.successTitle}>Payment Successful</div>
            <div style={S.successAmt}>₹{advance} advance received</div>
            <div style={S.bookingIdChip}>Booking {bookingId}</div>
            <div style={S.successMsg}>
              Your slot is locked{booking?.theatre ? ` — ${booking.theatre}` : ""}
              {booking?.branch ? ` at ${booking.branch}` : ""}
              {booking?.date ? ` on ${prettyDate(booking.date)}` : ""}
              {booking?.slot ? `, ${booking.slot}` : ""}. 🎉
            </div>
            <div style={S.successSub}>
              We’ll send a WhatsApp confirmation now and a reminder the day before. See you at the show!
            </div>
          </div>
        )}
      </div>
      <div style={S.footer}>The Binge Town · Nexus AI concierge · this is a demo payment page</div>
    </div>
  );
}

const CSS = `
  @keyframes btspin { to { transform: rotate(360deg); } }
  @keyframes btpop { 0% { transform: scale(.4); opacity:0; } 60% { transform: scale(1.12); } 100% { transform: scale(1); opacity:1; } }
  .bt-spin { animation: btspin .7s linear infinite; }
  .bt-pop { animation: btpop .5s cubic-bezier(.2,.8,.2,1) both; }
  .bt-card { animation: btpop .45s cubic-bezier(.2,.8,.2,1) both; }
  .bt-pay:not(:disabled):hover { filter: brightness(1.08); transform: translateY(-1px); }
  .bt-pay:not(:disabled):active { transform: translateY(0); }
`;

const S = {
  wrap: {
    minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", padding: "32px 18px",
    background: `radial-gradient(1200px 600px at 50% -10%, ${t.leatherDark} 0%, ${t.ink} 45%, #160e18 100%)`,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: t.cream,
  },
  card: {
    width: "100%", maxWidth: 420, background: "rgba(43,27,46,.72)",
    border: `1px solid ${t.tan}44`, borderRadius: 20, padding: "30px 26px 24px",
    boxShadow: "0 30px 80px rgba(0,0,0,.5)", backdropFilter: "blur(6px)", textAlign: "center",
  },
  brand: { display: "flex", alignItems: "center", justifyContent: "center", gap: 11, marginBottom: 4 },
  logoRing: {
    width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center",
    fontWeight: 800, fontSize: 18, color: t.ink, background: t.tan,
    boxShadow: `0 0 0 3px ${t.tan}33`,
  },
  wordmark: { fontSize: 15, fontWeight: 700, letterSpacing: ".18em", color: t.tan },
  tagline: { fontSize: 12, color: `${t.cream}99`, marginBottom: 22 },

  bookingIdChip: {
    display: "inline-block", fontSize: 12, fontWeight: 700, letterSpacing: ".06em",
    color: t.tan, background: `${t.tan}1a`, border: `1px solid ${t.tan}44`,
    borderRadius: 20, padding: "5px 13px", margin: "4px 0 16px",
  },
  summary: {
    textAlign: "left", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 12, padding: "6px 15px", marginBottom: 18,
  },
  row: {
    display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14,
    padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.07)",
  },
  rowKey: { fontSize: 12.5, color: `${t.cream}88`, whiteSpace: "nowrap" },
  rowVal: { fontSize: 13.5, fontWeight: 600, color: t.cream, textAlign: "right" },
  summaryFallback: {
    textAlign: "left", fontSize: 13, lineHeight: 1.5, color: `${t.cream}bb`,
    background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 12, padding: "14px 15px", marginBottom: 18,
  },

  advanceBox: {
    background: `linear-gradient(135deg, ${t.leather} 0%, ${t.leatherDark} 100%)`,
    borderRadius: 14, padding: "16px 18px", marginBottom: 18,
  },
  advanceLabel: { fontSize: 11.5, letterSpacing: ".08em", textTransform: "uppercase", color: `${t.cream}cc` },
  advanceAmt: { fontSize: 34, fontWeight: 800, lineHeight: 1.15, margin: "2px 0 3px", color: "#fff" },
  advanceNote: { fontSize: 11, color: `${t.cream}bb` },

  payBtn: {
    width: "100%", border: "none", borderRadius: 12, padding: "15px 18px",
    fontSize: 15.5, fontWeight: 700, cursor: "pointer", color: t.ink, background: t.tan,
    boxShadow: `0 10px 24px ${t.tan}33`, transition: "transform .12s, filter .12s",
  },
  payBtnBusy: { cursor: "default", background: `${t.tan}cc`, color: `${t.ink}cc` },
  btnBusyInner: { display: "inline-flex", alignItems: "center", gap: 9, justifyContent: "center" },
  secure: { fontSize: 11.5, color: `${t.cream}77`, marginTop: 14 },

  center: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 0 4px" },
  spin: { width: 26, height: 26, border: `3px solid ${t.tan}33`, borderTopColor: t.tan, borderRadius: "50%", marginBottom: 6 },
  spinSm: { width: 15, height: 15, border: `2px solid ${t.ink}55`, borderTopColor: t.ink, borderRadius: "50%", display: "inline-block" },
  muted: { fontSize: 13, color: `${t.cream}99` },

  check: {
    width: 66, height: 66, borderRadius: "50%", display: "grid", placeItems: "center",
    fontSize: 34, fontWeight: 800, color: "#0e2a17", background: "#3ddc84",
    boxShadow: "0 0 0 8px rgba(61,220,132,.15)", marginBottom: 6,
  },
  successTitle: { fontSize: 21, fontWeight: 800, color: t.cream },
  successAmt: { fontSize: 13.5, color: t.tan, fontWeight: 600, marginBottom: 4 },
  successMsg: { fontSize: 14, lineHeight: 1.55, color: t.cream, marginTop: 4 },
  successSub: { fontSize: 12.5, lineHeight: 1.5, color: `${t.cream}aa`, marginTop: 8 },

  footer: { marginTop: 20, fontSize: 11.5, color: `${t.cream}66`, textAlign: "center" },
};
