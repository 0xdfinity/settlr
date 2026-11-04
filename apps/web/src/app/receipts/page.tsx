"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import StatusChip from "@/components/StatusChip";
import { api, type Deal } from "@/lib/api";

function settledTime(deal: Deal) {
  return new Date(deal.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export default function ReceiptsPage() {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.listDeals({ status: "captured", limit: 100 }),
      api.listDeals({ status: "voided", limit: 100 }),
    ])
      .then(([captured, voided]) => {
        setDeals([...captured.items, ...voided.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not load receipts");
        setDeals([]);
      });
  }, []);

  const totals = useMemo(() => {
    const rows = deals ?? [];
    const captured = rows.filter((d) => d.status === "captured");
    const voided = rows.filter((d) => d.status === "voided");
    return {
      capturedUsd: captured.reduce((sum, d) => sum + d.amountUsd, 0),
      releasedUsd: voided.reduce((sum, d) => sum + d.amountUsd, 0),
      captured: captured.length,
      released: voided.length,
      rate: rows.length ? Math.round((captured.length / rows.length) * 100) : 0,
    };
  }, [deals]);

  function exportCsv() {
    const rows = deals ?? [];
    const header = ["deal_id", "merchant", "description", "amount_usd", "outcome", "settled_at", "paypal_order", "authorization", "capture"];
    const body = rows.map((d) => [
      d.id,
      d.merchant ?? "",
      d.description,
      d.amountUsd.toFixed(2),
      d.status,
      d.updatedAt,
      d.paypalOrderId ?? "",
      d.authorizationId ?? "",
      d.captureId ?? "",
    ]);
    const csv = [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `settlr-receipts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell>
      <div className="page-head enter">
        <div>
          <h1>Receipts</h1>
          <p>Every settled deal, with the PayPal reference that anchors it.</p>
        </div>
        <div className="actions">
          <button className="btn btn-outline btn-sm" onClick={exportCsv} disabled={!deals || deals.length === 0}>
            Export CSV
          </button>
          <Link className="btn btn-primary btn-sm" href="/deals">Open deals</Link>
        </div>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="kpi-row enter enter-2">
        <div className="panel kpi">
          <div className="label">Captured volume</div>
          <div className="value">${totals.capturedUsd.toFixed(2)}</div>
          <div className="hint"><span className="dot" />{totals.captured} captures</div>
        </div>
        <div className="panel kpi">
          <div className="label">Released volume</div>
          <div className="value">${totals.releasedUsd.toFixed(2)}</div>
          <div className="hint warn"><span className="dot" />{totals.released} releases</div>
        </div>
        <div className="panel kpi">
          <div className="label">Capture rate</div>
          <div className="value">{deals && deals.length > 0 ? `${totals.rate}%` : "None"}</div>
          <div className="hint quiet"><span className="dot" />settled deals</div>
        </div>
        <div className="panel kpi">
          <div className="label">Receipts on file</div>
          <div className="value">{deals?.length ?? "…"}</div>
          <div className="hint quiet"><span className="dot" />captured and released</div>
        </div>
      </div>

      <section className="panel enter enter-3" style={{ overflow: "hidden" }}>
        {deals === null ? (
          <div style={{ padding: 22 }}>
            {[0, 1, 2, 3, 4].map((i) => <div className="skeleton" key={i} style={{ height: 44, marginBottom: 8 }} />)}
          </div>
        ) : deals.length === 0 ? (
          <div className="empty">
            <div className="icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" strokeLinejoin="round" />
                <path d="M9 8h6M9 12h6" strokeLinecap="round" />
              </svg>
            </div>
            <h3>No settled deals yet</h3>
            <p>A receipt appears here as soon as the verifier captures or releases a hold.</p>
            <div className="actions">
              <Link className="btn btn-primary" href="/deals">Open deals</Link>
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Merchant</th>
                  <th>Contract</th>
                  <th>Amount</th>
                  <th>Outcome</th>
                  <th>Settled</th>
                  <th>Capture reference</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr key={deal.id}>
                    <td className="mono">…{deal.id.slice(-8)}</td>
                    <td>{deal.merchant ?? "Unlisted"}</td>
                    <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deal.description}</td>
                    <td className="mono">${deal.amountUsd.toFixed(2)}</td>
                    <td><StatusChip status={deal.status} /></td>
                    <td className="mono fz-11">{settledTime(deal)}</td>
                    <td className="mono fz-11">{deal.captureId ?? (deal.status === "voided" ? "released" : "None")}</td>
                    <td className="right"><Link className="link fz-12" href={`/deals/${deal.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
