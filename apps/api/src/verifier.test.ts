import test from "node:test";
import assert from "node:assert/strict";
import { verifyProof } from "./verifier.js";
import { loadConfig } from "./config.js";

const testConfig = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "pglite://./.pglite-data-test",
  PAYPAL_CLIENT_ID: "test",
  PAYPAL_CLIENT_SECRET: "test",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  VERIFIER_HMAC_SECRET: "0123456789abcdef0123456789abcdef",
} as unknown as NodeJS.ProcessEnv);

function stubFetch(payload: { status?: number; body?: string; throws?: boolean }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    if (payload.throws) throw new Error("connection refused");
    return new Response(payload.body ?? "", { status: payload.status ?? 200 });
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("passes when status and body match", async () => {
  const restore = stubFetch({ status: 200, body: "{\"status\":\"ok\"}" });
  try {
    const result = await verifyProof(testConfig, { url: "http://merchant.test/health", expectStatus: 200, expectBodyContains: "ok" });
    assert.equal(result.passed, true);
    assert.equal(result.checks.find((c) => c.name === "http_status")?.passed, true);
    assert.equal(result.checks.find((c) => c.name === "body_contains")?.passed, true);
  } finally { restore(); }
});

test("fails when HTTP status mismatches", async () => {
  const restore = stubFetch({ status: 503, body: "unavailable" });
  try {
    const result = await verifyProof(testConfig, { url: "http://merchant.test/health", expectStatus: 200, expectBodyContains: "ok" });
    assert.equal(result.passed, false);
    assert.match(result.reason, /http_status/);
  } finally { restore(); }
});

test("fails when body does not contain expected string", async () => {
  const restore = stubFetch({ status: 200, body: "everything is down" });
  try {
    const result = await verifyProof(testConfig, { url: "http://merchant.test/health", expectStatus: 200, expectBodyContains: "ok" });
    assert.equal(result.passed, false);
  } finally { restore(); }
});

test("fails closed when the proof URL cannot be reached", async () => {
  const restore = stubFetch({ throws: true });
  try {
    const result = await verifyProof(testConfig, { url: "http://merchant.test/health", expectStatus: 200, expectBodyContains: "ok" });
    assert.equal(result.passed, false);
  } finally { restore(); }
});

test("fails when the deal has no proof URL", async () => {
  const result = await verifyProof(testConfig, {});
  assert.equal(result.passed, false);
  assert.equal(result.checks[0]?.name, "endpoint");
});
