import Link from "next/link";

const TRACE = [
  {
    state: "done",
    what: "Hold placed",
    why: "PayPal holds $24.00, the merchant sees nothing yet",
    when: "14:03:11",
    ref: "AUTH · 51V7…6207",
  },
  {
    state: "done",
    what: "Delivery checked",
    why: "GET /health → HTTP 200 · body contained “active”",
    when: "14:03:42",
    ref: "2 checks passed",
  },
  {
    state: "done",
    what: "Capture settled",
    why: "Hold released to the merchant of record",
    when: "14:03:43",
    ref: "CAPTURE · 2US9…7335",
  },
];

export default function LandingPage() {
  return (
    <div className="land">
      <nav className="land-nav">
        <Link className="brand" href="/">
          <span className="mark">S</span>
          Settlr
        </Link>
        <div className="links">
          <a href="#protocol">How it works</a>
          <a href="#answers">Straight answers</a>
        </div>
        <div className="cta">
          <Link className="btn btn-ghost btn-sm" href="/signin">Sign in</Link>
          <Link className="btn btn-primary btn-sm" href="/signup">Open console</Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <h1>
            <span className="line">Never pay for</span>
            <span className="line">work that never landed.</span>
          </h1>
          <p className="hero-sub">
            Settlr holds the money in a PayPal authorization. It captures only after the work passes
            your own checks. Otherwise the full hold goes back. No agent ever holds a credential that can move money.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary btn-lg" href="/signup">Open an account</Link>
            <a className="btn btn-outline btn-lg" href="#trace">See a settlement</a>
          </div>
          <div className="hero-facts">
            <span><i />PayPal authorization</span>
            <span><i />Proof before payment</span>
            <span><i />A human decides the unclear ones</span>
          </div>
        </div>

        <div className="glass trace-card" id="trace">
          <div className="trace-head">
            <div className="t">Settlement · #940C62AC</div>
            <div className="tag-example">Example</div>
          </div>
          <div className="trace-body">
            {TRACE.map((row, i) => (
              <div className={`trace-row ${row.state}`} key={row.what} style={{ animationDelay: `${120 * i + 120}ms` }}>
                <span className="trace-dot" aria-hidden />
                <div>
                  <div className="what">{row.what}</div>
                  <div className="why">{row.why}</div>
                </div>
                <div className="when">
                  <b>{row.when}</b>
                  {row.ref}
                </div>
              </div>
            ))}
          </div>
          <div className="trace-foot">
            <div className="amount">$24.00<span>USD</span></div>
            <div className="ref">ORD · 3VT4…1837</div>
          </div>
        </div>
      </section>

      <section className="protocol" id="protocol">
        <div className="protocol-copy">
          <h2>Hold first. Pay on proof.</h2>
          <p>
            Settlr is an MCP server. The agent gets a key that cannot move money. It asks for a hold,
            the buyer approves it in PayPal, and then code decides, not the agent, not a model&apos;s mood.
          </p>
          <ol className="steps">
            <li>
              <b>escrow_create</b>
              <span>The agent states amount, merchant, and the URL that proves delivery.</span>
            </li>
            <li>
              <b>Buyer approves</b>
              <span>PayPal authorizes the hold. Nothing is charged; the merchant is not paid.</span>
            </li>
            <li>
              <b>escrow_submit_proof</b>
              <span>Your checks run: status, body, contract. A model only reads what code cannot settle.</span>
            </li>
            <li>
              <b>Settlement</b>
              <span>Checks pass: capture. Checks fail: void. Nobody can tell: a person decides.</span>
            </li>
          </ol>
        </div>

        <div className="glass code-card">
          <div className="code-head">
            <span>agent → settlr</span>
            <span className="mono">mcp · stdio</span>
          </div>
          <pre className="code">{`escrow_create({
  amountUsd: 24.00,
  merchant: "MerchantX",
  description: "Pro API plan, one month",
  proofUrl: "https://merchant.example/health",
  proofExpectBodyContains: "active"
})

{
  dealId: "940c62ac…",
  status: "pending",
  approveUrl: "https://www.sandbox…"
}

escrow_submit_proof({
  dealId: "940c62ac…",
  note: "Subscription active, key issued"
})

{
  passed: true,
  outcome: "captured",
  ai: { verdict: "verified", confidence: 0.99 }
}`}</pre>
        </div>
      </section>

      <section className="band" id="answers">
        <h2 className="answers-title">Straight answers.</h2>
        <div className="answers">
          <div className="answer">
            <div className="q">Who holds the money?</div>
            <p>PayPal, inside an authorization you approve. Settlr never holds funds. It decides when the hold becomes a payment or goes back.</p>
          </div>
          <div className="answer">
            <div className="q">What can the agent do with its key?</div>
            <p>Ask for a hold, submit proof, read status. It cannot approve, capture, or move money. The buyer approves in PayPal, every time.</p>
          </div>
          <div className="answer">
            <div className="q">What if the proof is unclear?</div>
            <p>A person decides. Capture or release, with a written reason in the audit log. The model advises; it never settles on its own.</p>
          </div>
        </div>
      </section>

      <footer className="land-foot">
        <div className="row" style={{ gap: 10 }}>
          <span className="rail-brand" style={{ padding: 0 }}>
            <span className="mark" style={{ width: 26, height: 26, borderRadius: 8, fontSize: 13 }}>S</span>
          </span>
          <span className="fz-12 muted">Agent settlement infrastructure.</span>
        </div>
        <div className="meta">
          <span>MIT licensed</span>
          <span>Self-hosted</span>
          <Link href="/signin">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
