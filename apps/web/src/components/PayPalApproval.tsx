"use client";

import { useState } from "react";
import { PayPalProvider, usePayPalOneTimePaymentSession } from "@paypal/react-paypal-js/sdk-v6";
import { api } from "@/lib/api";

function ApprovalButton({ orderId, dealId, label, onDone }: { orderId: string; dealId: string; label: string; onDone: () => void }) {
  const [syncError, setSyncError] = useState<string | null>(null);
  const { isPending, error, handleClick } = usePayPalOneTimePaymentSession({
    createOrder: async () => ({ orderId }),
    onApprove: async () => {
      try {
        await api.approveCallback(dealId);
        onDone();
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : "Could not sync PayPal approval");
      }
    },
    presentationMode: "auto",
  });
  if (error) return <div className="form-error" role="alert">PayPal error: {error.message}</div>;
  return (
    <div style={{ textAlign: "center", padding: "8px 0 0" }}>
      {label && <p className="sub" style={{ marginBottom: 12 }}>{label}</p>}
      <paypal-button onClick={handleClick} type="pay" disabled={isPending} />
      {syncError && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{syncError}</div>}
    </div>
  );
}

export default function PayPalApproval({ orderId, dealId, label, onDone }: { orderId: string; dealId: string; label?: string; onDone: () => void }) {
  return (
    <PayPalProvider
      clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""}
      components={["paypal-payments"]}
      environment={(process.env.NEXT_PUBLIC_PAYPAL_ENV as "sandbox" | "production") ?? "sandbox"}
    >
      <ApprovalButton orderId={orderId} dealId={dealId} label={label ?? "Buyer approves in the PayPal popup. Funds lock instantly, money never moves yet."} onDone={onDone} />
    </PayPalProvider>
  );
}
