"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { API_URL, api, type User } from "@/lib/api";

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { api.me().then(setUser).catch(() => undefined); }, []);

  const paypalEnv = process.env.NEXT_PUBLIC_PAYPAL_ENV ?? "sandbox";

  return (
    <AppShell>
      <div className="page-head enter">
        <div>
          <h1>Settings</h1>
          <p>Account, settlement rail, and runtime configuration.</p>
        </div>
      </div>

      <div className="detail" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <section className="panel enter">
          <div className="panel-head">
            <h2>Account</h2>
            <span className="eyebrow">operator</span>
          </div>
          <div className="panel-body">
            <div className="list-row">
              <div className="main-cell"><b>Name</b><span>The name on settlement receipts</span></div>
              <span className="fz-13">{user?.name ?? "…"}</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Email</b><span>Sign-in identity</span></div>
              <span className="fz-13">{user?.email ?? "…"}</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Member since</b><span>Account created</span></div>
              <span className="fz-13">{user ? new Date(user.createdAt).toLocaleDateString() : "…"}</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Session</b><span>HttpOnly cookie, scoped to this console</span></div>
              <span className="chip authorized">active</span>
            </div>
          </div>
        </section>

        <section className="panel enter enter-2">
          <div className="panel-head">
            <h2>Settlement rail</h2>
            <span className="eyebrow">PayPal Orders v2</span>
          </div>
          <div className="panel-body">
            <div className="list-row">
              <div className="main-cell"><b>Currency</b><span>Authorization and capture currency</span></div>
              <span className="mono fz-12">USD</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Flow</b><span>Reversible by default</span></div>
              <span className="mono fz-11">AUTHORIZE → CAPTURE / VOID</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Verifier</b><span>Deterministic HTTP checks, then model adjudication</span></div>
              <span className="chip authorized">two-stage</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Review gate</b><span>Ambiguous model verdicts wait for a person</span></div>
              <span className="chip review_required">enabled</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Receipts</b><span>PayPal capture reference plus the full audit trail</span></div>
              <span className="chip captured">final</span>
            </div>
          </div>
        </section>

        <section className="panel enter enter-3">
          <div className="panel-head">
            <h2>Runtime</h2>
            <span className="eyebrow">this deployment</span>
          </div>
          <div className="panel-body">
            <div className="list-row">
              <div className="main-cell"><b>API endpoint</b><span>Browser to settlement API</span></div>
              <span className="key-value">{API_URL}</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>PayPal environment</b><span>Set on the web build</span></div>
              <span className={`chip ${paypalEnv === "production" ? "captured" : "authorized"}`}>{paypalEnv}</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>AI planner</b><span>Contract drafting, adjudication, explanations</span></div>
              <span className="mono fz-11">Groq · gpt-oss-120b</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Catalog</b><span>Offer lookup before a deal is created</span></div>
              <span className="chip authorized">Channel3</span>
            </div>
          </div>
        </section>

        <section className="panel enter enter-3">
          <div className="panel-head">
            <h2>Deployment</h2>
            <span className="eyebrow">self-hosted</span>
          </div>
          <div className="panel-body">
            <div className="list-row">
              <div className="main-cell"><b>License</b><span>Source available, commercial use permitted</span></div>
              <span className="mono fz-12">MIT</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Database</b><span>Postgres in Docker, embedded PGlite in source runs</span></div>
              <span className="fz-12">your infrastructure</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Custody</b><span>Settlr never holds funds; PayPal holds the authorization</span></div>
              <span className="chip authorized">non-custodial</span>
            </div>
            <div className="list-row">
              <div className="main-cell"><b>Agent protocol</b><span>Model Context Protocol over stdio</span></div>
              <span className="mono fz-11">MCP</span>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
