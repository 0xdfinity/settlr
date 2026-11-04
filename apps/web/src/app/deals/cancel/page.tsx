import Link from "next/link";

export default function DealCancelPage() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="glass panel-pad" style={{ maxWidth: 460, width: "100%", textAlign: "center" }}>
        <div className="icon-badge" style={{ margin: "0 auto 14px" }} aria-hidden>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>Approval cancelled</h1>
        <p className="fz-13" style={{ marginBottom: 16 }}>
          No funds were held. The deal stays open until you approve it, or expires and releases itself.
        </p>
        <Link className="btn btn-outline" href="/deals">Back to deals</Link>
      </div>
    </div>
  );
}
