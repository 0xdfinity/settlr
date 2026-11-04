"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule, type ColDef } from "ag-grid-community";
import AppShell from "@/components/AppShell";
import { api, type Analytics } from "@/lib/api";
import { gridTheme } from "@/lib/gridTheme";

ModuleRegistry.registerModules([AllCommunityModule]);

interface MerchantRow {
  merchant: string;
  deals: number;
  captured: number;
  voided: number;
  capturedUsd: number;
  captureRate: number;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting approval",
  authorized: "Funds held",
  capture_pending: "Capture pending",
  review_required: "Review required",
  captured: "Captured",
  voided: "Released",
  expired: "Expired",
  failed: "Failed",
};

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.analytics().then(setData).catch((err) => setError(err instanceof Error ? err.message : "Could not load analytics"));
  }, []);

  const totals = data?.totals;
  const daily = data?.daily ?? [];
  const maxDaily = Math.max(1, ...daily.map((d) => d.captured + d.voided));
  const settled = (totals?.captured ?? 0) + (totals?.voided ?? 0);
  const captureRate = settled ? Math.round(((totals?.captured ?? 0) / settled) * 100) : null;
  const maxOutcome = Math.max(1, ...(data?.outcomes ?? []).map((o) => o.count));

  const merchantRows = useMemo<MerchantRow[]>(() => data?.merchants ?? [], [data]);

  const merchantColumns = useMemo<ColDef<MerchantRow>[]>(
    () => [
      { headerName: "Merchant", field: "merchant", flex: 1.4, minWidth: 160 },
      { headerName: "Deals", field: "deals", width: 90, type: "numericColumn", cellClass: "mono" },
      { headerName: "Captured", field: "captured", width: 100, type: "numericColumn", cellClass: "mono" },
      { headerName: "Released", field: "voided", width: 100, type: "numericColumn", cellClass: "mono" },
      {
        headerName: "Volume",
        field: "capturedUsd",
        width: 120,
        type: "numericColumn",
        cellClass: "mono",
        valueFormatter: (p) => `$${Number(p.value).toFixed(2)}`,
      },
      {
        headerName: "Capture rate",
        field: "captureRate",
        width: 128,
        type: "numericColumn",
        cellClass: "mono",
        valueFormatter: (p) => `${Math.round(Number(p.value) * 100)}%`,
      },
    ],
    [],
  );

  return (
    <AppShell>
      <div className="page-head enter">
        <div>
          <h1>Analytics</h1>
          <p>Settlement volume, outcomes, and verification latency across the last 90 days.</p>
        </div>
        <div className="actions">
          <Link className="btn btn-outline btn-sm" href="/receipts">Receipts</Link>
        </div>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="kpi-row enter enter-2">
        <div className="panel kpi">
          <div className="label">Captured volume</div>
          <div className="value">${(totals?.capturedUsd ?? 0).toFixed(2)}</div>
          <div className="hint"><span className="dot" />{totals?.captured ?? 0} deals settled</div>
        </div>
        <div className="panel kpi">
          <div className="label">Capture rate</div>
          <div className="value">{captureRate === null ? "None" : `${captureRate}%`}</div>
          <div className="hint quiet"><span className="dot" />{settled} settled outcomes</div>
        </div>
        <div className="panel kpi">
          <div className="label">In review</div>
          <div className="value">{totals?.review ?? 0}</div>
          <div className="hint warn"><span className="dot" />waiting on a person</div>
        </div>
        <div className="panel kpi">
          <div className="label">Verifier p50</div>
          <div className="value">{data?.latency.p50 === null || data?.latency.p50 === undefined ? "None" : `${data.latency.p50} ms`}</div>
          <div className="hint quiet"><span className="dot" />{data?.latency.samples ?? 0} samples</div>
        </div>
      </div>

      <div className="detail" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, .8fr)" }}>
        <section className="panel chart-panel enter enter-3">
          <div className="chart-head">
            <div>
              <h2>Daily settlements</h2>
              <p>Last 14 days · captured versus released</p>
            </div>
            <div className="legend">
              <span><i style={{ background: "var(--accent)" }} />Captured</span>
              <span><i style={{ background: "rgba(255,110,110,.62)" }} />Released</span>
            </div>
          </div>

          {daily.length === 0 ? (
            <div className="empty" style={{ padding: "48px 12px" }}>
              <p>No activity in this window yet.</p>
            </div>
          ) : (
            <>
              <div className="bars" role="img" aria-label="Daily captured and released deal counts">
                {daily.map((day) => {
                  const total = day.captured + day.voided;
                  return (
                    <div className="bar-col" key={day.day} title={`${day.day}: ${day.captured} captured, ${day.voided} released, $${day.capturedUsd.toFixed(2)}`}>
                      {total === 0 ? (
                        <div className="bar" style={{ height: 2, background: "rgba(255,255,255,.08)" }} />
                      ) : (
                        <>
                          {day.voided > 0 && <div className="bar void" style={{ height: `${(day.voided / maxDaily) * 100}%` }} />}
                          {day.captured > 0 && <div className="bar" style={{ height: `${(day.captured / maxDaily) * 100}%` }} />}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="bar-labels">
                {daily.map((day) => (
                  <span key={day.day}>{day.day.slice(5).replace("-", "/")}</span>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel chart-panel enter enter-3">
          <div className="chart-head">
            <div>
              <h2>Outcome mix</h2>
              <p>All deals in the window</p>
            </div>
          </div>
          {data && data.outcomes.length > 0 ? (
            <div className="col" style={{ gap: 14 }}>
              {data.outcomes.map((outcome) => (
                <div key={outcome.status}>
                  <div className="row-between" style={{ marginBottom: 5 }}>
                    <span className="fz-12">{STATUS_LABEL[outcome.status] ?? outcome.status}</span>
                    <span className="mono fz-11 muted">{outcome.count} · ${outcome.amountUsd.toFixed(2)}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,.05)", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${(outcome.count / maxOutcome) * 100}%`,
                        background: outcome.status === "captured" ? "var(--accent)" : outcome.status === "review_required" ? "var(--warn)" : outcome.status === "voided" ? "rgba(255,110,110,.65)" : "rgba(255,255,255,.28)",
                      }}
                    />
                  </div>
                </div>
              ))}
              <div className="divider" style={{ marginTop: 6 }} />
              <div className="row-between fz-11 muted">
                <span>p95 verification</span>
                <span className="mono">{data.latency.p95 === null ? "None" : `${data.latency.p95} ms`}</span>
              </div>
            </div>
          ) : (
            <p className="fz-12 muted">No settled outcomes yet.</p>
          )}
        </section>
      </div>

      <section className="panel grid-panel enter enter-3" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <h2>Merchants</h2>
          <span className="eyebrow">by deal count</span>
        </div>
        {merchantRows.length === 0 ? (
          <div className="empty">
            <p>Merchant performance appears after the first deal settles.</p>
          </div>
        ) : (
          <div className="grid-wrap" style={{ height: Math.min(440, 56 + merchantRows.length * 50) }}>
            <AgGridReact<MerchantRow>
              rowData={merchantRows}
              columnDefs={merchantColumns}
              defaultColDef={{ sortable: true, resizable: true }}
              theme={gridTheme}
              rowHeight={50}
              headerHeight={40}
              suppressCellFocus
            />
          </div>
        )}
      </section>
    </AppShell>
  );
}
