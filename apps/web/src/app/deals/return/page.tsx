"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";

function ReturnInner() {
  const params = useSearchParams();
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [deal, setDeal] = useState<{ id: string; merchant: string | null; amountUsd: number } | null>(null);
  const [message, setMessage] = useState("Syncing the authorization with PayPal.");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setState("error");
      setMessage("PayPal returned without an order token. Open the deal in the console; Settlr will reconcile it there.");
      return;
    }
    (async () => {
      try {
        const found = await api.getDealByOrder(token);
        const synced = await api.approveCallback(found.id);
        setDeal({ id: synced.id, merchant: synced.merchant, amountUsd: synced.amountUsd });
        setState("done");
        setMessage("Authorization locked. The funds are held and the deal is waiting on delivery proof.");
      } catch (err) {
        setState("error");
        setMessage(err instanceof Error ? err.message : "Could not sync this approval. Open the deal in the console to retry.");
      }
    })();
  }, [params]);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="glass panel-pad" style={{ maxWidth: 460, width: "100%", textAlign: "center" }}>
        <div
          className="icon-badge"
          style={{
            margin: "0 auto 14px",
            background: state === "done" ? "rgba(70,227,162,.1)" : state === "error" ? "rgba(255,110,110,.1)" : "var(--surface-2)",
            color: state === "done" ? "var(--accent)" : state === "error" ? "var(--danger)" : "var(--ink-2)",
          }}
          aria-hidden
        >
          {state === "done" ? "✓" : state === "error" ? "!" : "…"}
        </div>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>{state === "done" ? "Funds held" : state === "error" ? "Needs a look" : "One moment"}</h1>
        <p className="fz-13" style={{ marginBottom: 16 }}>{message}</p>
        {deal && <p className="mono fz-11 muted" style={{ marginBottom: 12 }}>{deal.merchant ?? "Deal"} · ${deal.amountUsd.toFixed(2)}</p>}
        <Link className="btn btn-primary" href={deal ? `/deals/${deal.id}` : "/deals"}>
          {deal ? "Open the deal" : "Back to deals"}
        </Link>
      </div>
    </div>
  );
}

export default function DealReturnPage() {
  return <Suspense fallback={null}><ReturnInner /></Suspense>;
}
