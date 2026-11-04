export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

export type DealStatus =
  | "pending"
  | "authorized"
  | "capture_pending"
  | "review_required"
  | "captured"
  | "voided"
  | "expired"
  | "failed";

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Offer {
  title: string;
  merchant: string;
  priceUsd: number;
  url: string;
  imageUrl: string | null;
  source: string;
}

export interface Deal {
  id: string;
  amountUsd: number;
  currency: string;
  status: DealStatus;
  description: string;
  merchant: string | null;
  merchantUrl: string | null;
  category: string | null;
  proofSpec: { url?: string | null; expectStatus?: number | null; expectBodyContains?: string | null };
  deliveryContract: string | null;
  offer: Offer | null;
  aiVerdict: "verified" | "underdelivered" | "ambiguous" | null;
  aiConfidence: number | null;
  aiReasoning: string | null;
  reviewState: string;
  paypalOrderId: string | null;
  authorizationId: string | null;
  captureId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  approveUrl?: string | null;
}

export interface ProofAttempt {
  kind: string;
  url: string | null;
  checks: { name: string; passed: boolean; detail: string }[];
  passed: boolean;
  reason: string;
  latency_ms: number;
  created_at: string;
  ai_verdict: string | null;
  ai_confidence: number | null;
  ai_reasoning: string | null;
}

export interface DealDetail extends Deal {
  audit: { id: number; actor: string; action: string; detail: Record<string, unknown>; created_at: string }[];
  proofAttempts: ProofAttempt[];
}

export interface Metrics {
  lockedUsd: number;
  lockedCount: number;
  capturedToday: number;
  voidedToday: number;
  settledTotal: number;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

export interface DealDraft {
  merchant: string;
  description: string;
  amountUsd: number;
  category: string;
  deliveryContract: string;
  proofUrl: string | null;
  expectStatus: number | null;
  expectBodyContains: string | null;
  offerUrl: string | null;
  risks: string[];
  rationale: string;
}

export interface AiVerdict {
  verdict: "verified" | "underdelivered" | "ambiguous";
  confidence: number | null;
  reasoning: string | null;
}

export interface ProofResponse {
  passed: boolean;
  outcome: "captured" | "voided" | "review_required";
  checks: { name: string; passed: boolean; detail: string }[];
  reason: string;
  ai: AiVerdict | null;
  deal: Deal;
}

export interface Analytics {
  totals: { deals: number; captured: number; voided: number; review: number; lockedUsd: number; capturedUsd: number };
  daily: { day: string; created: number; captured: number; voided: number; capturedUsd: number }[];
  merchants: { merchant: string; deals: number; capturedUsd: number; voided: number; captured: number; captureRate: number }[];
  outcomes: { status: string; count: number; amountUsd: number }[];
  latency: { p50: number | null; p95: number | null; samples: number };
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  acceptStatus: number[] = [],
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = undefined;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { /* leave undefined */ }
  if (!res.ok && !acceptStatus.includes(res.status)) {
    const p = parsed as { message?: string; code?: string } | undefined;
    throw new ApiError(res.status, p?.message ?? `Request failed (${res.status})`, p?.code);
  }
  return parsed as T;
}

export const api = {
  signup: (email: string, password: string, name: string) => request<User>("POST", "/v1/auth/signup", { email, password, name }),
  signin: (email: string, password: string) => request<User>("POST", "/v1/auth/signin", { email, password }),
  signout: () => request<void>("POST", "/v1/auth/signout"),
  me: () => request<User>("GET", "/v1/auth/me"),
  createDeal: (input: {
    amountUsd: number;
    description: string;
    merchant?: string;
    merchantUrl?: string;
    category?: string;
    deliveryContract?: string;
    offer?: Offer | null;
    proofUrl?: string;
    proofExpectStatus?: number;
    proofExpectBodyContains?: string;
    expiresMinutes?: number;
  }) =>
    request<Deal>("POST", "/v1/deals", {
      amountUsd: input.amountUsd,
      description: input.description,
      merchant: input.merchant,
      merchantUrl: input.merchantUrl,
      category: input.category,
      deliveryContract: input.deliveryContract,
      offer: input.offer ?? undefined,
      expiresMinutes: input.expiresMinutes ?? 60,
      proofSpec: { url: input.proofUrl, expectStatus: input.proofExpectStatus, expectBodyContains: input.proofExpectBodyContains },
    }, { "Idempotency-Key": `web-${crypto.randomUUID()}` }),
  listDeals: (params?: { status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    q.set("limit", String(params?.limit ?? 50));
    return request<{ items: Deal[]; total: number }>("GET", `/v1/deals?${q}`);
  },
  getDealByOrder: (orderId: string) => request<Deal>("GET", `/v1/deals/by-order/${encodeURIComponent(orderId)}`),
  getDeal: (id: string) => request<DealDetail>("GET", `/v1/deals/${id}`),
  approveCallback: (id: string) => request<Deal>("POST", `/v1/deals/${id}/approve-callback`, {}),
  submitProof: (id: string, input: { kind?: string; url?: string; expectStatus?: number; expectBodyContains?: string; note?: string }) =>
    request<ProofResponse>("POST", `/v1/deals/${id}/proof`, { kind: input.kind ?? "http_check", ...input }, {}, [200, 202, 422]),
  reviewDeal: (id: string, action: "capture" | "void", reason: string) =>
    request<Deal>("POST", `/v1/deals/${id}/review`, { action, reason }),
  forceSettle: (id: string, action: "capture" | "void", reason: string) =>
    request<Deal>("POST", `/v1/deals/${id}/force-settle`, { action, reason }),
  explain: (id: string) => request<{ headline: string; detail: string; next: string }>("POST", `/v1/ai/explain/${id}`, {}),
  draftDeal: (input: { intent: string; budgetUsd: number; category?: string }) =>
    request<{ draft: DealDraft; offers: Offer[]; catalogError: string | null }>("POST", "/v1/ai/draft", input),
  metrics: () => request<Metrics>("GET", "/v1/metrics"),
  analytics: () => request<Analytics>("GET", "/v1/analytics"),
  listApiKeys: () => request<ApiKeySummary[]>("GET", "/v1/api-keys"),
  createApiKey: (name: string) => request<{ id: string; name: string; key: string }>("POST", "/v1/api-keys", { name }),
  revokeApiKey: (id: string) => request<void>("DELETE", `/v1/api-keys/${id}`),
  catalogSearch: (q: string, maxPrice?: number) => {
    const params = new URLSearchParams({ q });
    if (maxPrice) params.set("maxPrice", String(maxPrice));
    return request<Offer[]>("GET", `/v1/catalog/search?${params}`);
  },
};
