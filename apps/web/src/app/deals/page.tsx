"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule, type ColDef } from "ag-grid-community";
import AppShell from "@/components/AppShell";
import PayPalApproval from "@/components/PayPalApproval";
import StatusChip from "@/components/StatusChip";
import WakeNotice from "@/components/WakeNotice";
import { api, type Deal, type DealDraft, type Metrics, type Offer } from "@/lib/api";
import { gridTheme } from "@/lib/gridTheme";

ModuleRegistry.registerModules([AllCommunityModule]);

type Stage = "describe" | "contract" | "approve";

interface FormState {
  amountUsd: string;
  description: string;
  merchant: string;
  merchantUrl: string;
  category: string;
  deliveryContract: string;
  proofUrl: string;
  proofExpectStatus: string;
  proofExpectBodyContains: string;
}

const EMPTY_FORM: FormState = {
  amountUsd: "24",
  description: "",
  merchant: "",
  merchantUrl: "",
  category: "",
  deliveryContract: "",
  proofUrl: "",
  proofExpectStatus: "200",
  proofExpectBodyContains: "",
};

function VerdictChip({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="muted">None</span>;
  return <span className={`chip ${verdict}`}>{verdict.replace("underdelivered", "under-delivered")}</span>;
}

export default function DealsConsole() {
  const router = useRouter();
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("describe");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [intent, setIntent] = useState("");
  const [budget, setBudget] = useState("25");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DealDraft | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdDeal, setCreatedDeal] = useState<Deal | null>(null);
  const [wake, setWake] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [list, m] = await Promise.all([api.listDeals({ limit: 100 }), api.metrics()]);
      setDeals(list.items);
      setMetrics(m);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load deals");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (deals !== null || error) return;
    const timer = setTimeout(() => setWake(true), 1500);
    return () => clearTimeout(timer);
  }, [deals, error]);

  useEffect(() => {
    refresh(true);
    const timer = setInterval(() => refresh(true), 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const openCreate = () => {
    setModalOpen(true);
    setStage("describe");
    setForm(EMPTY_FORM);
    setIntent("");
    setBudget("25");
    setAiError(null);
    setDraft(null);
    setOffers([]);
    setSelectedOffer(null);
    setCreatedDeal(null);
  };

  const closeModal = () => {
    if (createdDeal) refresh(true);
    setModalOpen(false);
  };

  const patch = (next: Partial<FormState>) => setForm((prev) => ({ ...prev, ...next }));

  async function plan() {
    setAiError(null);
    if (intent.trim().length < 8) {
      setAiError("Describe the purchase in at least eight characters.");
      return;
    }
    const cap = Number(budget);
    if (!Number.isFinite(cap) || cap <= 0) {
      setAiError("Set a positive budget.");
      return;
    }
    setAiBusy(true);
    try {
      const result = await api.draftDeal({ intent: intent.trim(), budgetUsd: cap });
      setDraft(result.draft);
      setOffers(result.offers);
      setSelectedOffer(result.offers.find((o) => o.url === result.draft.offerUrl) ?? null);
      setForm({
        amountUsd: result.draft.amountUsd > 0 ? String(result.draft.amountUsd) : "",
        description: result.draft.description,
        merchant: result.draft.merchant,
        merchantUrl: result.draft.offerUrl ?? "",
        category: result.draft.category,
        deliveryContract: result.draft.deliveryContract,
        proofUrl: result.draft.proofUrl ?? "",
        proofExpectStatus: String(result.draft.expectStatus ?? 200),
        proofExpectBodyContains: result.draft.expectBodyContains ?? "",
      });
      setStage("contract");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "The planner is unavailable. Write the contract manually.");
      const fallback: FormState = { ...EMPTY_FORM, amountUsd: String(cap) };
      setForm(fallback);
      setStage("contract");
    } finally {
      setAiBusy(false);
    }
  }

  async function createDeal() {
    setAiError(null);
    const amount = Number(form.amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) {
      setAiError("Amount must be a positive number.");
      return;
    }
    if (form.description.trim().length < 3) {
      setAiError("Describe what the agent is buying.");
      return;
    }
    setCreating(true);
    try {
      const deal = await api.createDeal({
        amountUsd: amount,
        description: form.description.trim(),
        merchant: form.merchant.trim() || undefined,
        merchantUrl: form.merchantUrl.trim() || undefined,
        category: form.category.trim() || undefined,
        deliveryContract: form.deliveryContract.trim() || undefined,
        offer: selectedOffer,
        proofUrl: form.proofUrl.trim() || undefined,
        proofExpectStatus: Number(form.proofExpectStatus) || 200,
        proofExpectBodyContains: form.proofExpectBodyContains.trim() || undefined,
      });
      setCreatedDeal(deal);
      setStage("approve");
      refresh(true);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Could not create the deal.");
    } finally {
      setCreating(false);
    }
  }

  const columnDefs = useMemo<ColDef<Deal>[]>(
    () => [
      {
        headerName: "Deal",
        field: "id",
        width: 104,
        pinned: "left",
        cellClass: "mono",
        valueFormatter: (p) => `…${String(p.value).slice(-6)}`,
      },
      {
        headerName: "Merchant",
        field: "merchant",
        flex: 0.8,
        minWidth: 120,
        valueFormatter: (p) => p.value ?? "Unlisted",
      },
      {
        headerName: "Contract",
        field: "description",
        flex: 1.8,
        minWidth: 200,
      },
      {
        headerName: "Amount",
        field: "amountUsd",
        width: 118,
        type: "numericColumn",
        cellClass: "mono",
        valueFormatter: (p) => `$${Number(p.value).toFixed(2)}`,
      },
      {
        headerName: "Status",
        field: "status",
        width: 150,
        cellRenderer: (p: { value: string }) => <StatusChip status={p.value} />,
      },
      {
        headerName: "AI verdict",
        field: "aiVerdict",
        width: 132,
        cellRenderer: (p: { value: string | null }) => <VerdictChip verdict={p.value} />,
      },
      {
        headerName: "Created",
        field: "createdAt",
        width: 138,
        cellClass: "mono fz-11",
        valueFormatter: (p) => new Date(p.value).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      },
      {
        headerName: "",
        width: 58,
        sortable: false,
        filter: false,
        pinned: "right",
        cellRenderer: () => (
          <span className="row-open" aria-hidden>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3.5 8h9M8.5 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ),
      },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef<Deal>>(() => ({ sortable: true, filter: true, resizable: true }), []);

  return (
    <AppShell>
      <div className="page-head enter">
        <div>
          <h1>Deals</h1>
          <p>Every authorization, check, and settlement your agents create.</p>
        </div>
        <div className="actions">
          <button className="btn btn-outline btn-sm" onClick={() => refresh()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button className="btn btn-primary" onClick={openCreate}>
            New deal
          </button>
        </div>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="kpi-row enter enter-2">
        <div className="panel kpi">
          <div className="label">Locked by agents</div>
          <div className="value">${metrics?.lockedUsd.toFixed(2) ?? "…"}</div>
          <div className="hint"><span className="dot" />{metrics?.lockedCount ?? 0} open holds</div>
        </div>
        <div className="panel kpi">
          <div className="label">Captured today</div>
          <div className="value">{metrics?.capturedToday ?? "…"}</div>
          <div className="hint"><span className="dot" />delivery proven</div>
        </div>
        <div className="panel kpi">
          <div className="label">Released today</div>
          <div className="value">{metrics?.voidedToday ?? "…"}</div>
          <div className="hint warn"><span className="dot" />holds returned</div>
        </div>
        <div className="panel kpi">
          <div className="label">Settled all time</div>
          <div className="value">{metrics?.settledTotal ?? "…"}</div>
          <div className="hint quiet"><span className="dot" />captures and releases</div>
        </div>
      </div>

      <section className="panel grid-panel enter enter-3">
        <div className="grid-toolbar">
          <div className="search">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deals, merchants, contracts"
              aria-label="Search deals"
            />
          </div>
          <span className="stat">{deals?.length ?? 0} deals</span>
          <span className="spacer" />
          <Link className="btn btn-ghost btn-sm" href="/agent-setup">Agent access</Link>
        </div>

        {deals === null ? (
          <div style={{ padding: 20 }}>
            <WakeNotice active={wake} />
            <div className="skeleton" style={{ height: 34, marginBottom: 10 }} />
            {[0, 1, 2, 3, 4, 5].map((i) => <div className="skeleton" key={i} style={{ height: 42, marginBottom: 8 }} />)}
          </div>
        ) : deals.length === 0 ? (
          <div className="empty">
            <div className="icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="5" width="18" height="15" rx="3" />
                <path d="M3 10h18M8 15h5" strokeLinecap="round" />
              </svg>
            </div>
            <h3>No deals yet</h3>
            <p>Create one here, or point an agent at the MCP server and let it open deals on its own.</p>
            <div className="actions">
              <button className="btn btn-primary" onClick={openCreate}>Create a deal</button>
              <Link className="btn btn-outline" href="/agent-setup">Connect an agent</Link>
            </div>
          </div>
        ) : (
          <div
            className="grid-wrap"
            style={{ height: Math.min(deals.length, 12) * 50 + 40 + 52 }}
          >
            <AgGridReact<Deal>
              rowData={deals}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              theme={gridTheme}
              animateRows
              rowHeight={50}
              headerHeight={40}
              pagination
              paginationPageSize={12}
              quickFilterText={search}
              suppressCellFocus
              onRowClicked={(event) => {
                if (event.data) router.push(`/deals/${event.data.id}`);
              }}
            />
          </div>
        )}
      </section>

      {modalOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="New deal"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div className="modal">
            {stage === "describe" && (
              <>
                <div className="eyebrow">New deal</div>
                <h2 style={{ marginTop: 6 }}>Describe the purchase</h2>
                <p className="sub">
                  The planner turns intent into a reversible contract: amount, merchant, delivery condition, and proof URL.
                </p>
                {aiError && <div className="inline-alert warn" role="alert">{aiError}</div>}
                <div className="field">
                  <label htmlFor="intent">What should the agent buy?</label>
                  <textarea
                    id="intent"
                    autoFocus
                    rows={3}
                    value={intent}
                    onChange={(e) => setIntent(e.target.value)}
                    placeholder="One month of the Pro API plan from MerchantX, only pay if the health endpoint returns ok."
                  />
                  <span className="help">Be specific about the merchant and the condition that proves delivery.</span>
                </div>
                <div className="field">
                  <label htmlFor="budget">Budget cap (USD)</label>
                  <input
                    id="budget"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                  />
                  <span className="help">The contract can never authorize more than this.</span>
                </div>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                  <button className="btn btn-outline" onClick={() => { setForm({ ...EMPTY_FORM, amountUsd: budget }); setStage("contract"); }}>
                    Write it manually
                  </button>
                  <button className="btn btn-primary" onClick={plan} disabled={aiBusy}>
                    {aiBusy ? "Planning…" : "Draft contract"}
                  </button>
                </div>
              </>
            )}

            {stage === "contract" && (
              <>
                <div className="eyebrow">{draft ? "Planner proposal" : "Contract"}</div>
                <h2 style={{ marginTop: 6 }}>{draft ? "Review the contract" : "Write the contract"}</h2>
                <p className="sub">
                  {draft
                    ? "Every field is editable. Funds stay held until the delivery condition is met."
                    : "Set the amount and the exact condition that releases the hold."}
                </p>

                {aiError && <div className="inline-alert warn" role="alert">{aiError}</div>}

                {draft && (draft.rationale || draft.risks.length > 0) && (
                  <div className="inline-alert ok" style={{ display: "block" }}>
                    {draft.rationale && <span><span className="title">Why this contract</span>{draft.rationale}</span>}
                    {draft.risks.length > 0 && (
                      <ul style={{ margin: "8px 0 0 16px", padding: 0, color: "inherit", fontSize: 11.5 }}>
                        {draft.risks.map((risk) => <li key={risk}>{risk}</li>)}
                      </ul>
                    )}
                  </div>
                )}

                {selectedOffer && (
                  <div className="panel" style={{ padding: 13, marginBottom: 15, borderRadius: 12 }}>
                    <div className="row-between">
                      <div style={{ minWidth: 0 }}>
                        <div className="fz-11 muted">Matched offer · {selectedOffer.source}</div>
                        <div style={{ fontSize: 13, fontWeight: 560 }}>{selectedOffer.title}</div>
                        <div className="fz-11 muted">{selectedOffer.merchant}</div>
                      </div>
                      <div className="mono fz-13">${selectedOffer.priceUsd.toFixed(2)}</div>
                    </div>
                  </div>
                )}

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="amount">Amount (USD)</label>
                    <input id="amount" type="number" min="0.01" step="0.01" value={form.amountUsd} onChange={(e) => patch({ amountUsd: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="merchant">Merchant</label>
                    <input id="merchant" value={form.merchant} onChange={(e) => patch({ merchant: e.target.value })} placeholder="MerchantX" />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="description">What is being purchased?</label>
                  <input id="description" autoFocus={!draft} value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Pro API plan, 1M requests/month" />
                </div>

                <div className="field">
                  <label htmlFor="contract">Delivery condition</label>
                  <textarea id="contract" rows={2} value={form.deliveryContract} onChange={(e) => patch({ deliveryContract: e.target.value })} placeholder="The health endpoint must return HTTP 200 with an active subscription record." />
                  <span className="help">This is the exact condition the verifier and the model check against.</span>
                </div>

                <div className="field">
                  <label htmlFor="proofUrl">Proof URL</label>
                  <input id="proofUrl" value={form.proofUrl} onChange={(e) => patch({ proofUrl: e.target.value })} placeholder="https://merchant.example.com/api/v1/health" />
                  <span className="help">The verifier calls this URL. Leave empty to submit evidence manually later.</span>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="proofStatus">Expected status</label>
                    <input id="proofStatus" type="number" value={form.proofExpectStatus} onChange={(e) => patch({ proofExpectStatus: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="proofBody">Body contains</label>
                    <input id="proofBody" value={form.proofExpectBodyContains} onChange={(e) => patch({ proofExpectBodyContains: e.target.value })} placeholder="optional" />
                  </div>
                </div>

                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setStage("describe")}>Back</button>
                  <button className="btn btn-primary" onClick={createDeal} disabled={creating}>
                    {creating ? "Creating order…" : "Create and authorize"}
                  </button>
                </div>
              </>
            )}

            {stage === "approve" && createdDeal && (
              <>
                <div className="eyebrow">Authorization</div>
                <h2 style={{ marginTop: 6 }}>Approve the hold</h2>
                <p className="sub">
                  Deal <span className="mono">…{createdDeal.id.slice(-8)}</span> is ready. The buyer approves {createdDeal.currency}{" "}
                  ${createdDeal.amountUsd.toFixed(2)} in PayPal. Funds are held, not charged.
                </p>
                {createdDeal.paypalOrderId ? (
                  <PayPalApproval
                    orderId={createdDeal.paypalOrderId}
                    dealId={createdDeal.id}
                    onDone={() => { setModalOpen(false); refresh(true); }}
                    label="Approval locks the funds. They move only after delivery is proven."
                  />
                ) : (
                  <div className="inline-alert warn">PayPal did not return an order. Open the deal to retry settlement.</div>
                )}
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={closeModal}>Do this later</button>
                  <Link className="btn btn-outline" href={`/deals/${createdDeal.id}`}>Open deal</Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
