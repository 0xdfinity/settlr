import type { Config } from "./config.js";

export interface VerifierCheck { name: string; passed: boolean; detail: string }
export interface VerifierResult { passed: boolean; checks: VerifierCheck[]; reason: string; latencyMs: number; excerpt: string }

interface ProofSpec {
  url?: string | null;
  expectStatus?: number | null;
  expectBodyContains?: string | null;
  llmPrompt?: string | null;
}

export async function verifyProof(config: Config, spec: ProofSpec): Promise<VerifierResult> {
  const started = Date.now();
  const checks: VerifierCheck[] = [];
  let fetchedBody = "";

  if (spec.url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(spec.url, { signal: controller.signal, redirect: "follow" });
      checks.push({
        name: "http_status",
        passed: res.status === (spec.expectStatus ?? 200),
        detail: `GET ${spec.url} -> HTTP ${res.status} (expected ${spec.expectStatus ?? 200})`,
      });
      fetchedBody = await res.text();
      const contains = spec.expectBodyContains?.trim();
      if (contains) {
        const ok = fetchedBody.includes(contains);
        checks.push({
          name: "body_contains",
          passed: ok,
          detail: ok ? `Body contains "${contains}"` : `Body did not contain "${contains}" (${fetchedBody.length} bytes)`,
        });
      } else {
        checks.push({ name: "body_contains", passed: true, detail: "No body assertion configured" });
      }
    } catch (err) {
      checks.push({ name: "http_status", passed: false, detail: `HTTP fetch failed: ${err instanceof Error ? err.message : String(err)}` });
      if (spec.expectBodyContains) checks.push({ name: "body_contains", passed: false, detail: "Skipped: fetch failed" });
    } finally {
      clearTimeout(timer);
    }
  } else {
    checks.push({ name: "endpoint", passed: false, detail: "Deal proofSpec has no url: cannot verify delivery" });
  }

  const deterministicFailed = checks.filter((c) => !c.passed);
  const passed = deterministicFailed.length === 0;
  return {
    passed,
    checks,
    reason: passed
      ? "All deterministic checks passed."
      : `Failed check(s): ${deterministicFailed.map((c) => c.name).join(", ")}.`,
    latencyMs: Date.now() - started,
    excerpt: fetchedBody.slice(0, 2_000),
  };
}
