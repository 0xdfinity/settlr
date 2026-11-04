"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, type User } from "@/lib/api";

const NAV = [
  {
    href: "/deals",
    label: "Deals",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
        <path d="M2.5 8h15M7 12h4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 16.5h14" strokeLinecap="round" />
        <path d="M5 13V9M9 13V5.5M13 13v-3M17 13V7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/receipts",
    label: "Receipts",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 2.5h10v15l-2.5-1.5L10 17.5 7.5 16 5 17.5v-15Z" strokeLinejoin="round" />
        <path d="M7.5 6.5h5M7.5 9.5h5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/agent-setup",
    label: "Agent access",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
        <path d="m6.5 8 2 2-2 2M11 12.5h3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="10" cy="10" r="2.5" />
        <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" strokeLinecap="round" />
      </svg>
    ),
  },
];

function initials(user: User | null): string {
  if (!user) return "S";
  const source = user.name?.trim() || user.email;
  return source.slice(0, 1).toUpperCase();
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const me = await api.me();
          if (!cancelled) { setUser(me); setLoading(false); }
          return;
        } catch {
          if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (!cancelled) router.replace("/signin");
    };
    check();
    return () => { cancelled = true; };
  }, [router]);

  if (loading) {
    return (
      <div className="shell">
        <aside className="rail" aria-hidden />
        <main className="main">
          <div className="skeleton" style={{ height: 42, width: 220, marginBottom: 24 }} />
          <div className="skeleton" style={{ height: 110, marginBottom: 14 }} />
          <div className="skeleton" style={{ height: 460 }} />
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="rail">
        <Link className="rail-brand" href="/deals" aria-label="Settlr home">
          <span className="mark">S</span>
          <span>
            <span className="name">Settlr</span>
            <span className="tag">Settlement infrastructure</span>
          </span>
        </Link>
        <div className="rail-group">Operations</div>
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href} className={`rail-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} aria-label={item.label} title={item.label}>
              {item.icon}
              <span className="rail-label">{item.label}</span>
            </Link>
          );
        })}
        <div className="rail-foot">
          <div className="rail-user">
            <span className="avatar" aria-hidden>{initials(user)}</span>
            <span className="who">
              <b>{user?.name ?? "Operator"}</b>
              <span>{user?.email ?? ""}</span>
            </span>
          </div>
          <button
            className="btn btn-ghost btn-sm rail-signout"
            onClick={async () => { await api.signout().catch(() => undefined); router.replace("/"); }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}
