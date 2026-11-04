#!/usr/bin/env node
// Settlr MCP server â€” lets AI agents create/inspect/prove escrow deals via the Settlr API.
// Designed for Claude Desktop, Claude Code, Cursor, or any MCP-capable client (stdio transport).
//
// Config (stdio):
//   { "command": "npx", "args": ["-y", "@settlr/mcp"],
//     "env": { "SETTLR_API_URL": "http://localhost:8787", "SETTLR_API_KEY": "settlr_live_..." } }
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.SETTLR_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const API_KEY = process.env.SETTLR_API_KEY ?? "";

if (!API_KEY.startsWith("settlr_")) {
  console.error("SETTLR_API_KEY is missing or malformed. Mint one in the Settlr console (Settings -> API keys) and pass it as settlr_live_...");
  process.exit(1);
}

async function api<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    const message = typeof parsed === "object" && parsed !== null && "message" in parsed ? String((parsed as { message?: unknown }).message) : text;
    throw new Error(`Settlr API ${method} ${path} -> ${res.status}: ${message}`);
  }
  return parsed as T;
}

const server = new McpServer({ name: "settlr", version: "1.0.0" });

server.registerTool(
  "escrow_create",
  {
    description: "Create an escrow deal for an agent purchase. Funds are locked (PayPal authorization), not sent. Returns the deal and an approval link the buyer must open to lock funds. Use before paying any merchant.",
    inputSchema: {
      amountUsd: z.number().positive().max(10000).describe("Total amount to lock, in USD"),
      description: z.string().min(3).max(500).describe("What the agent intends to buy and from whom"),
      merchant: z.string().max(200).optional().describe("Merchant name, e.g. MerchantX"),
      merchantUrl: z.string().url().optional().describe("Merchant checkout/API base URL"),
      proofUrl: z.string().url().optional().describe("URL Settlr will check to verify delivery (e.g. a health endpoint of the delivered API). If set, proof must pass before capture."),
      proofExpectStatus: z.number().int().min(100).max(599).optional().describe("Expected HTTP status for the proof URL (default 200)"),
      proofExpectBodyContains: z.string().max(200).optional().describe("String the proof URL response must contain"),
      category: z.string().max(80).optional(),
      expiresMinutes: z.number().int().min(5).max(1440).optional().describe("Deal expiry in minutes (default 60)"),
    },
  },
  async (args) => {
    const deal = await api<Record<string, unknown>>("POST", "/v1/deals", {
      amountUsd: args.amountUsd,
      description: args.description,
      merchant: args.merchant,
      merchantUrl: args.merchantUrl,
      category: args.category,
      proofSpec: {
        url: args.proofUrl,
        expectStatus: args.proofExpectStatus,
        expectBodyContains: args.proofExpectBodyContains,
      },
      expiresMinutes: args.expiresMinutes,
    }, `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return {
      content: [{
        type: "text",
        text: [
          `Deal created (NOT yet locked).`,
          `Deal ID: ${deal.id}`,
          `Amount: $${deal.amountUsd}`,
          `Status: ${deal.status}`,
          `Approval link: ${deal.approveUrl ?? "n/a"}`,
          `Tell the buyer to open the approval link to lock the funds. Funds capture only after proof passes.`,
        ].join("\n"),
      }],
    };
  },
);

server.registerTool(
  "escrow_submit_proof",
  {
    description: "Submit proof that the merchant delivered. Settlr verifies the evidence (HTTP status + body match) and either captures the held funds (pass) or voids the authorization (fail, refund).",
    inputSchema: {
      dealId: z.string().uuid(),
      kind: z.enum(["http_check", "url_screenshot", "log"]).default("http_check"),
      url: z.string().url().optional().describe("Override the proof URL for this check"),
      expectStatus: z.number().int().min(100).max(599).optional(),
      expectBodyContains: z.string().max(200).optional(),
      note: z.string().max(1000).optional().describe("Delivery note / evidence summary"),
    },
  },
  async (args) => {
    const { dealId, ...body } = args;
    const res = await api<Record<string, unknown>>("POST", `/v1/deals/${dealId}/proof`, body)
      .catch(async (err: Error) => {
        // Settlr returns 422 on rejected proof â€” that is still a successful tool call.
        const match = /-> (\d+):/.exec(err.message);
        if (match?.[1] === "422") {
          const raw = err.message.replace(/^Settlr API POST \/v1\/deals\/[^ ]+ -> \d+: /, "");
          return JSON.parse(raw) as Record<string, unknown>;
        }
        throw err;
      });
    return {
      content: [{
        type: "text",
        text: [
          `Proof ${res.passed ? "PASSED â€” funds captured" : "FAILED â€” hold voided"}.`,
          `Reason: ${res.reason ?? "n/a"}`,
          `Deal: ${JSON.stringify((res.deal as { id?: string; status?: string }) ?? {})}`,
        ].join("\n"),
      }],
    };
  },
);

server.registerTool(
  "escrow_status",
  {
    description: "Get Settlr deal status. Pass dealId for one deal (includes audit trail and proof attempts), or omit to list recent deals.",
    inputSchema: {
      dealId: z.string().uuid().optional(),
      status: z.enum(["pending", "authorized", "capture_pending", "captured", "voided", "expired", "failed"]).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
  },
  async (args) => {
    if (args.dealId) {
      const deal = await api<Record<string, unknown>>("GET", `/v1/deals/${args.dealId}`);
      return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
    }
    const params = new URLSearchParams();
    if (args.status) params.set("status", args.status);
    params.set("limit", String(args.limit ?? 10));
    const list = await api<Record<string, unknown>>("GET", `/v1/deals?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  },
);

server.registerTool(
  "catalog_search",
  {
    description: "Search the Channel3 product catalog for what to buy before creating an escrow deal. Returns merchant offers with prices and buy links.",
    inputSchema: {
      query: z.string().min(3).describe("Natural-language product search, e.g. 'wireless ergonomic mouse under $25'"),
      maxPrice: z.number().positive().optional().describe("Maximum price in USD"),
      limit: z.number().int().min(1).max(10).optional(),
    },
  },
  async (args) => {
    const params = new URLSearchParams({ q: args.query });
    if (args.maxPrice) params.set("maxPrice", String(args.maxPrice));
    params.set("limit", String(args.limit ?? 5));
    const offers = await api<unknown[]>("GET", `/v1/catalog/search?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(offers, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Settlr MCP server ready (stdio)");
