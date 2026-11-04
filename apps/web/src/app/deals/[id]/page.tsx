"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PayPalApproval from "@/components/PayPalApproval";
import StatusChip from "@/components/StatusChip";
import { api, type DealDetail, type ProofResponse } from "@/lib/api";

const STATUS_COPY: Record<string, string> = {
  pending: "The buyer has not approved the PayPal authorization yet.",
  authorized: "Funds are held. Submit delivery evidence to capture or release them.",
  capture_pending: "Settlement is in flight. The worker retries automatically.",
  review_required: "The model was not confident enough to settle. A person decides.",
  captured: "Delivery passed. Funds were captured and the receipt is final.",
  voided: "The hold was released. No money moved.",
  expired: "The authorization expired and the hold was released.",
  failed: "The deal failed. Read the audit trail for the cause.",
};

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

function shortTime(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function actorLabel(actor: string) {
  if (actor.startsWith("user:") || actor.startsWith("admin:")) return "operator";
  if (actor.startsWith("reviewer:")) return "reviewer";
  if (actor.startsWith("key:")) return "agent key";
  return actor;
}

function Verdict({ verdict, confidence, reasoning }: { verdict: string | null; confidence: number | null; reasoning: string | null }) {
  if (!verdict && !reasoning) return null;
  const tone = verdict === "underdelivered" ? "bad" : verdict === "ambiguous" ? "warn" : "ok";
  const label = verdict === "underdelivered" ? "Under-delivered" : verdict === "ambiguous" ? "Needs review" : verdict === "verified" ? "Verified" : "Assessment";
  return (
    <div className={`verdict ${tone === "ok" ? "" : tone}`}>
      <div className="head">
        <b>{label}</b>
        {confidence !== null && <span className="conf">confidence {Math.round(confidence * 100)}%</span>}
      </div>
      <p>{reasoning ?? "The model returned no reasoning."}</p>
    </div>
  );
}

function CheckList({ checks }: { checks: { name: string; passed: boolean; detail: string }[] }) {
  return (
    <div className="proof-checks">
      {checks.map((check) => (
        <div key={check.name} className={`check-row ${check.passed ? "pass" : "fail"}`}>
          <span className="mark" aria-hidden>{check.passed ? "✓" : "✕"}</span>
          <span className="txt"><b>{check.name}</b> · {check.detail}</span>
        </div>
      ))}
    </div>
  );
}

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [proofNote, setProofNote] = useState("");
  const [runState, setRunState] = useState<"idle" | "running">("idle");
  const [proof, setProof] = useState<ProofResponse | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<"capture" | "void" | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [forceAction, setForceAction] = useState<"capture" | "void" | null>(null);
  const [forceReason, setForceReason] = useState("");
  const [forceBusy, setForceBusy] = useState(false);
  const [explanation, setExplanation] = useState<{ headline: string; detail: string; next: string } | null>(null);
  const [explaining, setExplaining] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.getDeal(id);
      setDeal(next);
      setProofUrl((prev) => prev || next.proofSpec?.url || "");
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this deal");
      return null;
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const explain = useCallback(async () => {
    setExplaining(true);
    try {
      setExplanation(await api.explain(id));
    } catch {
      setExplanation(null);
    } finally {
      setExplaining(false);
    }
  }, [id]);

  useEffect(() => {
    if (!deal) return;
    if (["captured", "voided", "review_required", "expired", "failed"].includes(deal.status)) {
      explain();
    }
  }, [deal, explain]);

  async function runProof() {
    if (!proofUrl.trim()) {
      setActionMsg("Enter the proof URL the verifier should call.");
      return;
    }
    setRunState("running");
    setProof(null);
    setActionMsg(null);
    try {
      const result = await api.submitProof(id, {
        kind: "http_check",
        url: proofUrl.trim(),
        note: proofNote.trim() || undefined,
      });
      setProof(result);
      const next = await load();
      if (next) explain();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Verification failed.");
      await load();
    } finally {
      setRunState("idle");
    }
  }

  async function submitReview() {
    if (!reviewAction) return;
    if (reviewReason.trim().length < 10) {
      setActionMsg("Write at least ten characters. The reason is written to the audit log.");
      return;
    }
    setReviewBusy(true);
    setActionMsg(null);
    try {
      await api.reviewDeal(id, reviewAction, reviewReason.trim());
      setReviewAction(null);
      setReviewReason("");
      await load();
      explain();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Review action failed.");
    } finally {
      setReviewBusy(false);
    }
  }

  async function submitForce() {
    if (!forceAction) return;
    if (forceReason.trim().length < 10) {
      setActionMsg("Write at least ten characters. The reason is written to the audit log.");
      return;
    }
    setForceBusy(true);
    setActionMsg(null);
    try {
      await api.forceSettle(id, forceAction, forceReason.trim());
      setForceAction(null);
      setForceReason("");
      await load();
      explain();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Settlement failed.");
    } finally {
      setForceBusy(false);
    }
  }

  if (error) {
    return (
      <AppShell>
        <div className="form-error" role="alert">{error}</div>
        <Link className="btn btn-outline" href="/deals">Back to deals</Link>
      </AppShell>
    );
  }

  if (!deal) {
    return (
      <AppShell>
        <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 480 }} />
      </AppShell>
    );
  }

  const acting = deal.status === "authorized" || deal.status === "capture_pending";
  const proofSpec = deal.proofSpec ?? {};

  return (
    <AppShell>
      <div className="page-head enter">
        <div>
          <Link className="crumb" href="/deals">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M9.5 3.5 5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Deals
          </Link>
          <h1>{deal.description}</h1>
          <p>{STATUS_COPY[deal.status] ?? "Settlement state recorded."}</p>
          <p className="mono fz-11 muted" style={{ marginTop: 6 }}>deal …{deal.id.slice(-8)}</p>
        </div>
        <StatusChip status={deal.status} />
      </div>

      {actionMsg && <div className="inline-alert warn" role="alert">{actionMsg}</div>}

      <div className="detail">
        <div className="stack">
          <section className="glass panel-pad enter">
            <div className="row-between" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="eyebrow">Authorized amount</div>
                <div className="amount-hero" style={{ marginTop: 8 }}>
                  <span className="value">{money(deal.amountUsd)}</span>
                  <span className="cur">{deal.currency}</span>
                </div>
                <div className="fz-13 muted" style={{ marginTop: 4 }}>{deal.description}</div>
              </div>
              {deal.offer?.imageUrl && (
                <img
                  src={deal.offer.imageUrl}
                  alt=""
                  width={56}
                  height={56}
                  style={{ borderRadius: 10, border: "1px solid var(--line)", objectFit: "cover" }}
                />
              )}
            </div>

            <div style={{ marginTop: 20 }}>
              <dl>
                <div className="kv"><dt>Merchant</dt><dd>{deal.merchant ?? "Unlisted"}</dd></div>
                <div className="kv"><dt>Delivery condition</dt><dd>{deal.deliveryContract ?? "No formal contract. Evidence is checked against the description."}</dd></div>
                <div className="kv"><dt>Proof URL</dt><dd className="mono">{proofSpec.url ?? "Manual evidence"}</dd></div>
                {deal.offer && (
                  <div className="kv">
                    <dt>Offer</dt>
                    <dd>
                      <a className="link" href={deal.offer.url} target="_blank" rel="noreferrer">{deal.offer.title}</a>
                      <span className="muted"> · {deal.offer.merchant} · {money(deal.offer.priceUsd)}</span>
                    </dd>
                  </div>
                )}
                <div className="kv"><dt>PayPal order</dt><dd className="mono">{deal.paypalOrderId ?? "None"}</dd></div>
                <div className="kv"><dt>Authorization</dt><dd className="mono">{deal.authorizationId ?? "None"}</dd></div>
                <div className="kv"><dt>Capture</dt><dd className="mono">{deal.captureId ?? "None"}</dd></div>
                <div className="kv"><dt>Created</dt><dd>{shortTime(deal.createdAt)}</dd></div>
                <div className="kv"><dt>Hold expires</dt><dd>{shortTime(deal.expiresAt)}</dd></div>
              </dl>
            </div>

            {deal.status === "pending" && deal.paypalOrderId && (
              <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Buyer approval</div>
                <PayPalApproval
                  orderId={deal.paypalOrderId}
                  dealId={deal.id}
                  onDone={() => { load(); }}
                  label="Approval locks the funds. They move only after delivery is proven."
                />
              </div>
            )}
          </section>

          {acting && (
            <section className="panel enter enter-2">
              <div className="panel-head">
                <h2>Verify delivery</h2>
                <span className="eyebrow">capture or release</span>
              </div>
              <div className="panel-body">
                <div className="field">
                  <label htmlFor="proofUrl">Proof URL</label>
                  <input
                    id="proofUrl"
                    value={proofUrl}
                    onChange={(e) => setProofUrl(e.target.value)}
                    placeholder="https://merchant.example.com/api/v1/health"
                  />
                </div>
                <div className="field">
                  <label htmlFor="proofNote">Agent note <span className="muted">(optional)</span></label>
                  <textarea
                    id="proofNote"
                    rows={2}
                    value={proofNote}
                    onChange={(e) => setProofNote(e.target.value)}
                    placeholder="What was delivered, where to look, or anything the checks cannot see."
                  />
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <button className="btn btn-primary" onClick={runProof} disabled={runState === "running"}>
                    {runState === "running" ? "Checking…" : "Run verifier"}
                  </button>
                  <span className="fz-11 muted">Deterministic checks run first. The model reviews the evidence only after they pass.</span>
                </div>

                {proof && (
                  <div className={`inline-alert ${proof.outcome === "captured" ? "ok" : proof.outcome === "voided" ? "" : "warn"}`} style={{ display: "block", marginTop: 14 }} role="status">
                    <span className="title">
                      {proof.outcome === "captured" ? "Delivery verified. Funds captured." : proof.outcome === "voided" ? "Delivery check failed. Hold released." : "Held for human review."}
                    </span>
                    {proof.reason}
                    <CheckList checks={proof.checks} />
                    {proof.ai && <div style={{ marginTop: 12 }}><Verdict verdict={proof.ai.verdict} confidence={proof.ai.confidence} reasoning={proof.ai.reasoning} /></div>}
                  </div>
                )}
              </div>
            </section>
          )}

          {deal.status === "review_required" && (
            <section className="panel enter enter-2" style={{ borderColor: "rgba(242,180,94,.28)" }}>
              <div className="panel-head">
                <h2>Human review</h2>
                <span className="chip review_required">Review required</span>
              </div>
              <div className="panel-body">
                <p className="fz-12" style={{ marginBottom: 12 }}>
                  The deterministic checks passed, but the model could not confirm the delivery contract. The hold is untouched until you decide.
                </p>
                <Verdict verdict={deal.aiVerdict} confidence={deal.aiConfidence} reasoning={deal.aiReasoning} />

                {!reviewAction ? (
                  <div className="row wrap" style={{ marginTop: 16 }}>
                    <button className="btn btn-primary" onClick={() => setReviewAction("capture")}>Capture the hold</button>
                    <button className="btn btn-outline" onClick={() => setReviewAction("void")}>Release the hold</button>
                  </div>
                ) : (
                  <div style={{ marginTop: 16 }}>
                    <div className="field">
                      <label htmlFor="reviewReason">
                        Reason for {reviewAction === "capture" ? "capturing" : "releasing"} <span className="muted">(10+ characters, audited)</span>
                      </label>
                      <textarea
                        id="reviewReason"
                        rows={2}
                        autoFocus
                        value={reviewReason}
                        onChange={(e) => setReviewReason(e.target.value)}
                        placeholder={reviewAction === "capture" ? "Merchant confirmed activation and supplied the subscription record." : "Delivery could not be confirmed; buyer asked for the hold to be released."}
                      />
                    </div>
                    <div className="row">
                      <button className="btn btn-primary" onClick={submitReview} disabled={reviewBusy}>
                        {reviewBusy ? "Settling…" : `Confirm ${reviewAction}`}
                      </button>
                      <button className="btn btn-ghost" onClick={() => { setReviewAction(null); setReviewReason(""); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {acting && (
            <section className="panel">
              <div className="panel-head">
                <h2>Operator override</h2>
                <span className="eyebrow">audited</span>
              </div>
              <div className="panel-body">
                {!forceAction ? (
                  <div className="row wrap">
                    <button className="btn btn-outline btn-sm" onClick={() => setForceAction("capture")}>Force capture</button>
                    <button className="btn btn-outline btn-sm" onClick={() => setForceAction("void")}>Force release</button>
                    <span className="fz-11 muted">Both actions require a written reason and appear in the audit log.</span>
                  </div>
                ) : (
                  <div>
                    <div className="field">
                      <label htmlFor="forceReason">Reason for force {forceAction} <span className="muted">(10+ characters)</span></label>
                      <textarea id="forceReason" rows={2} value={forceReason} onChange={(e) => setForceReason(e.target.value)} />
                    </div>
                    <div className="row">
                      <button className="btn btn-danger btn-sm" onClick={submitForce} disabled={forceBusy}>
                        {forceBusy ? "Settling…" : `Confirm force ${forceAction}`}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setForceAction(null); setForceReason(""); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="panel enter enter-2">
            <div className="panel-head">
              <h2>Decision explainer</h2>
              <button className="btn btn-ghost btn-sm" onClick={explain} disabled={explaining}>
                {explaining ? "Reading…" : "Refresh"}
              </button>
            </div>
            <div className="panel-body">
              {explanation ? (
                <>
                  <h3 style={{ fontSize: 14, marginBottom: 6 }}>{explanation.headline}</h3>
                  <p className="fz-12" style={{ marginBottom: 10 }}>{explanation.detail}</p>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Next</div>
                  <p className="fz-12">{explanation.next}</p>
                </>
              ) : (
                <p className="fz-12 muted">{explaining ? "Reading the audit trail…" : "An explanation appears once this deal has a decision to describe."}</p>
              )}
            </div>
          </section>

          {deal.proofAttempts.length > 0 && (
            <section className="panel enter enter-3">
              <div className="panel-head">
                <h2>Proof attempts</h2>
                <span className="eyebrow">{deal.proofAttempts.length} recorded</span>
              </div>
              <div className="panel-body">
                {deal.proofAttempts.map((attempt, index) => (
                  <div key={index} style={{ borderTop: index === 0 ? 0 : "1px solid rgba(255,255,255,.05)", paddingTop: index === 0 ? 0 : 14, marginTop: index === 0 ? 0 : 14 }}>
                    <div className="row-between">
                      <span className={`chip ${attempt.passed ? "captured" : "voided"}`}>{attempt.passed ? "Checks passed" : "Checks failed"}</span>
                      <span className="mono fz-11 muted">{shortTime(attempt.created_at)}</span>
                    </div>
                    <CheckList checks={attempt.checks} />
                    <p className="fz-11 muted" style={{ marginTop: 6 }}>{attempt.reason}</p>
                    {attempt.ai_verdict && (
                      <div style={{ marginTop: 10 }}>
                        <Verdict verdict={attempt.ai_verdict} confidence={attempt.ai_confidence} reasoning={attempt.ai_reasoning} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2>Audit trail</h2>
              <span className="eyebrow">immutable</span>
            </div>
            <div className="panel-body">
              {deal.audit.length === 0 ? (
                <p className="fz-12 muted">No events recorded.</p>
              ) : (
                <div className="trace-list">
                  {deal.audit.map((event) => {
                    const tone = event.action.includes("fail") || event.action.includes("void") || event.action.includes("expired")
                      ? "bad"
                      : event.action.includes("review") || event.action.includes("force")
                        ? "warn"
                        : "ok";
                    return (
                      <div key={event.id} className={`tl-item ${tone}`}>
                        <div className="when">{shortTime(event.created_at)} · {actorLabel(event.actor)}</div>
                        <div className="what">{event.action}</div>
                        {event.detail && Object.keys(event.detail).length > 0 && (
                          <div className="note mono">{Object.entries(event.detail).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join(" · ")}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
