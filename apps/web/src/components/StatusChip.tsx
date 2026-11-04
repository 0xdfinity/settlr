const LABEL: Record<string, string> = {
  pending: "Awaiting approval",
  authorized: "Funds held",
  capture_pending: "Capture pending",
  review_required: "Review required",
  captured: "Captured",
  voided: "Voided",
  expired: "Expired",
  failed: "Failed",
};

export default function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${status}`}>{LABEL[status] ?? status}</span>;
}
