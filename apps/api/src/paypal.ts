import type { Config } from "./config.js";
import { PAYPAL_BASE_URL } from "./config.js";

export interface PayPalOrderLink { rel: string; href: string; method: string }

export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private config: Config) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - Date.now() > 60_000) return this.token.value;
    const res = await fetch(`${PAYPAL_BASE_URL(this.config.PAYPAL_ENV)}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.PAYPAL_CLIENT_ID}:${this.config.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PayPalError(`oauth2 token failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  private async call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
    const token = await this.accessToken();
    const res = await fetch(`${PAYPAL_BASE_URL(this.config.PAYPAL_ENV)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new PayPalError(`${method} ${path} failed: ${res.status} ${text}`, res.status);
    return data as T;
  }

  async createAuthorizeOrder(input: {
    amountUsd: string;
    referenceId: string;
    description: string;
    requestId: string;
  }): Promise<{ id: string; status: string; links: PayPalOrderLink[] }> {
    return this.call("POST", "/v2/checkout/orders", {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.referenceId,
          description: input.description.slice(0, 127),
          amount: { currency_code: "USD", value: input.amountUsd },
        },
      ],
      application_context: {
        return_url: this.config.WEB_RETURN_URL,
        cancel_url: this.config.WEB_CANCEL_URL,
        user_action: "PAY_NOW",
        brand_name: "Settlr",
      },
    }, input.requestId);
  }

  async authorizeOrder(orderId: string, requestId: string): Promise<Record<string, unknown>> {
    return this.call("POST", `/v2/checkout/orders/${orderId}/authorize`, {}, requestId);
  }

  async showOrder(orderId: string): Promise<Record<string, unknown>> {
    return this.call("GET", `/v2/checkout/orders/${orderId}`);
  }

  async captureAuthorization(authorizationId: string, requestId: string): Promise<Record<string, unknown>> {
    return this.call("POST", `/v2/payments/authorizations/${authorizationId}/capture`, {}, requestId);
  }

  async voidAuthorization(authorizationId: string, requestId: string): Promise<Record<string, unknown>> {
    return this.call("POST", `/v2/payments/authorizations/${authorizationId}/void`, {}, requestId);
  }

  async verifyWebhookSignature(input: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    webhookId: string;
    webhookEvent: unknown;
  }): Promise<boolean> {
    try {
      const result = await this.call<{ verification_status?: string }>(
        "POST",
        "/v1/notifications/verify-webhook-signature",
        input,
      );
      return result.verification_status === "SUCCESS";
    } catch (err) {
      console.error("verify-webhook-signature error", err);
      return false;
    }
  }
}

export class PayPalError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "PayPalError";
  }
}
