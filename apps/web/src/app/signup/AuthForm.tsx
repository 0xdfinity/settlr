"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import WakeNotice from "@/components/WakeNotice";

export default function AuthForm({ mode }: { mode: "signup" | "signin" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wake, setWake] = useState(false);
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSignup = mode === "signup";

  useEffect(() => () => {
    if (wakeTimer.current) clearTimeout(wakeTimer.current);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isSignup && name.trim().length < 1) {
      setError("Enter your name.");
      return;
    }
    if (isSignup && password.length < 10) {
      setError("Use at least ten characters for the password.");
      return;
    }
    setBusy(true);
    setWake(false);
    if (wakeTimer.current) clearTimeout(wakeTimer.current);
    wakeTimer.current = setTimeout(() => setWake(true), 1500);
    try {
      if (isSignup) await api.signup(email.trim(), password, name.trim());
      else await api.signin(email.trim(), password);
      router.replace("/deals");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete that request.");
      setBusy(false);
      setWake(false);
      if (wakeTimer.current) clearTimeout(wakeTimer.current);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-side">
        <Link className="brand" href="/">
          <span className="mark">S</span>
          Settlr
        </Link>

        <div>
          <h1>
            Never pay for
            <br />
            <span className="accent">work that never landed.</span>
          </h1>
          <p className="quote">
            Settlr holds the money in a PayPal authorization. It captures only after the work passes
            your own checks, otherwise the full hold goes back.
          </p>
        </div>

        <div className="bottom">
          PayPal Orders v2 · MCP native · Self-hosted
          <small className="wake-note">Free instance. If idle, the first request takes up to a minute.</small>
        </div>
      </aside>

      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <h2>{isSignup ? "Open an account" : "Sign in"}</h2>
          <p className="sub">{isSignup ? "One operator account controls every agent and every settlement." : "Continue to your settlement console."}</p>

          {error && <div className="form-error" role="alert">{error}</div>}

          {isSignup && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Operator name" />
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={isSignup ? 10 : 1}
              required
            />
            {isSignup && <span className="help">At least ten characters.</span>}
          </div>

          {wake && <WakeNotice active={wake} />}

          <button type="submit" className={`btn btn-primary btn-lg${busy ? " btn-loading" : ""}`} style={{ width: "100%" }} disabled={busy}>
            {busy ? (wake ? "Waking the service…" : "Working…") : isSignup ? "Create account" : "Sign in"}
          </button>

          <p className="alt">
            {isSignup
              ? <>Already have an account? <Link href="/signin">Sign in</Link></>
              : <>New to Settlr? <Link href="/signup">Open an account</Link></>}
          </p>
        </form>
      </div>
    </div>
  );
}
