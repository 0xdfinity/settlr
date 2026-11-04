"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { API_URL, api, type ApiKeySummary } from "@/lib/api";

function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="code-bar">
        <span className="eyebrow">{label}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="code">{code}</pre>
    </div>
  );
}

export default function AgentSetupPage() {
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const [name, setName] = useState("claude-desktop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listApiKeys().then(setKeys).catch(() => setKeys([]));
  useEffect(() => { load(); }, []);

  async function mint() {
    if (name.trim().length < 3) {
      setError("Name the key with at least three characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createApiKey(name.trim());
      setNewKey({ name: created.name, key: created.key });
      setName("claude-desktop");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a key.");
    } finally {
      setBusy(false);
    }
  }

  const mcpPath = "/absolute/path/to/settlr/apps/mcp/dist/index.js";
  const config = (key: string) => JSON.stringify({
    mcpServers: {
      settlr: {
        command: "node",
        args: [mcpPath],
        env: { SETTLR_API_URL: API_URL, SETTLR_API_KEY: key },
      },
    },
  }, null, 2);

  return (
    <AppShell>
      <div className="page-head enter">
        <div>
          <h1>Agent access</h1>
          <p>Give an agent a key, point it at the MCP server, and it can open and prove deals.</p>
        </div>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      {newKey && (
        <div className="inline-alert ok" role="status" style={{ display: "block" }}>
          <span className="title">Key created. Copy it now.</span>
          Only a hash is stored. This value is not shown again.
          <CopyBlock label={newKey.name} code={newKey.key} />
        </div>
      )}

      <div className="detail" style={{ gridTemplateColumns: "minmax(0, .9fr) minmax(0, 1.1fr)" }}>
        <section className="panel enter">
          <div className="panel-head">
            <h2>1 · Create a key</h2>
            <span className="eyebrow">bearer token</span>
          </div>
          <div className="panel-body">
            <div className="field">
              <label htmlFor="keyName">Key name</label>
              <input id="keyName" value={name} onChange={(e) => setName(e.target.value)} placeholder="claude-desktop" />
              <span className="help">Use the machine or agent name so revocation stays obvious.</span>
            </div>
            <button className="btn btn-primary" onClick={mint} disabled={busy}>{busy ? "Creating…" : "Create key"}</button>

            {keys && keys.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Active keys</div>
                {keys.map((key) => (
                  <div key={key.id} className="list-row">
                    <div className="main-cell">
                      <b><span className="mono">{key.prefix}…</span> · {key.name}</b>
                      <span>{key.last_used_at ? `Last used ${new Date(key.last_used_at).toLocaleString()}` : "Never used"}</span>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => { await api.revokeApiKey(key.id); load(); }}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="stack">
          <section className="panel enter enter-2">
            <div className="panel-head">
              <h2>2 · Point the agent at Settlr</h2>
              <span className="eyebrow">MCP stdio</span>
            </div>
            <div className="panel-body">
              <p className="fz-12" style={{ marginBottom: 4 }}>
                Build the server from this repository with <span className="key-value">npm run -w apps/mcp build</span>, then add the block below
                to <span className="key-value">claude_desktop_config.json</span> or <span className="key-value">~/.cursor/mcp.json</span>.
              </p>
              <CopyBlock label="Claude Desktop / Cursor" code={config(newKey?.key ?? "settlr_live_YOUR_KEY")} />
            </div>
          </section>

          <section className="panel enter enter-3">
            <div className="panel-head">
              <h2>3 · Tools the agent gets</h2>
              <span className="eyebrow">four calls</span>
            </div>
            <div className="panel-body">
              <div className="list-row">
                <div className="main-cell"><b>catalog_search</b><span>Find a product and price before committing.</span></div>
                <span className="mono fz-11 muted">GET</span>
              </div>
              <div className="list-row">
                <div className="main-cell"><b>escrow_create</b><span>Open a deal and return the buyer approval link.</span></div>
                <span className="mono fz-11 muted">POST</span>
              </div>
              <div className="list-row">
                <div className="main-cell"><b>escrow_submit_proof</b><span>Send evidence; funds capture or release automatically.</span></div>
                <span className="mono fz-11 muted">POST</span>
              </div>
              <div className="list-row">
                <div className="main-cell"><b>escrow_status</b><span>Read the deal, checks, verdict, and audit trail.</span></div>
                <span className="mono fz-11 muted">GET</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
