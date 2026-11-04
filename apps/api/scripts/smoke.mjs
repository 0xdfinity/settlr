// Smoke test: signup -> me -> create key -> deals via MCP key + catalog shape.
// Run: node scripts/smoke.mjs [baseUrl]
const base = process.argv[2] ?? "http://127.0.0.1:8787";
import crypto from "node:crypto";
const email = `smoke_${crypto.randomBytes(4).toString("hex")}@settlr.dev`;
const password = "correct horse battery";

function extractCookie(res) {
  const sc = res.headers.getSetCookie?.() ?? [];
  return sc.map((c) => c.split(";")[0]).join("; ");
}
const j = (r) => r.text().then((t) => { try { return JSON.parse(t); } catch { return t; } });

const signup = await fetch(`${base}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, name: "Smoke Test" }) });
const cookie = extractCookie(signup);
console.log("signup:", signup.status, await j(signup.clone()));

const me = await fetch(`${base}/v1/auth/me`, { headers: { cookie } });
console.log("me:", me.status, await j(me.clone()));

const keyRes = await fetch(`${base}/v1/api-keys`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "smoke-mcp-key" }) });
const keyBody = await j(keyRes.clone());
console.log("api key created:", keyRes.status, keyBody);
const apiKey = keyBody?.key;

const createDeal = await fetch(`${base}/v1/deals`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie, "Idempotency-Key": `smoke-${crypto.randomBytes(6).toString("hex")}` },
  body: JSON.stringify({ amountUsd: 24, description: "Agent buys Pro API plan from MerchantX", merchant: "MerchantX", merchantUrl: "https://example.com/api", proofSpec: { url: "https://example.com/health", expectStatus: 200, expectBodyContains: "ok" }, expiresMinutes: 60 }),
});
console.log("create deal:", createDeal.status, JSON.stringify(await j(createDeal.clone())).slice(0, 400));

const list = await fetch(`${base}/v1/deals`, { headers: { cookie } });
console.log("list deals:", list.status, JSON.stringify(await j(list.clone())).slice(0, 400));

if (apiKey) {
  const listMcp = await fetch(`${base}/v1/deals`, { headers: { authorization: `Bearer ${apiKey}` } });
  console.log("list via mcp key:", listMcp.status);
}

const metrics = await fetch(`${base}/v1/metrics`, { headers: { cookie } });
console.log("metrics:", metrics.status, await j(metrics.clone()));
