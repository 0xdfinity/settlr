import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Settlr · Agent settlement infrastructure", template: "%s · Settlr" },
  description: "Never pay for work that never landed. Settlr holds every agent purchase in a PayPal authorization and pays out only when delivery is proven.",
  icons: [{ rel: "icon", url: "/icon.svg", type: "image/svg+xml" }],
  openGraph: { title: "Settlr · Never pay for work that never landed", description: "Every agent purchase runs inside a PayPal authorization. The merchant is paid only after delivery is proven. Otherwise the full hold goes back.", type: "website" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
