import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-figtree",
  display: "swap",
});

const FAVICON =
  "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65dbc8c137b6d056d81db0ad_fame-f-icon-square-pink-cream%403x%201.png";

export const metadata: Metadata = {
  title: "Fame · Shoot status",
  description: "Where your Fame shoot is in the production pipeline.",
  icons: { icon: FAVICON },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={figtree.variable}>
      <body>{children}</body>
    </html>
  );
}
