import type { Metadata } from "next";
import Link from "next/link";
import { PageTour } from "@/features/guidance/page-tour";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reliability Lab",
  description: "Operator console for replayable LLM executions",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            <span className="brand-mark">RL</span>
            <span>
              Reliability Lab
              <small>operator console</small>
            </span>
          </Link>
          <nav aria-label="Primary navigation">
            <Link href="/">Executions</Link>
            <Link href="/investigations">Investigations</Link>
            <Link href="/investigation-cases">Cases</Link>
            <Link href="/guide">Guide</Link>
            <a href="http://localhost:4000/docs">API docs</a>
          </nav>
        </header>
        <main>{children}</main>
        <PageTour />
      </body>
    </html>
  );
}
