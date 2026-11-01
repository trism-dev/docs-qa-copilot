import type { ReactNode } from "react";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import Link from "next/link";
import Nav from "./nav.tsx";
import "./globals.css";

const serif = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });

export const metadata = {
  title: "Docs Q&A Copilot",
  description: "Ask questions about benefits and policy PDFs and get answers that cite the exact page.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <div className="wrap bar">
            <Link className="brand" href="/">
              Docs Q&amp;A Copilot
            </Link>
            <Nav />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
