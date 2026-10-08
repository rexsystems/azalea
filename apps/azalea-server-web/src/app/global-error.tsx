"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Space_Grotesk, Inter } from "next/font/google";
import { ErrorShell } from "@/components/ErrorShell";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} antialiased`}
        style={{ fontFamily: "var(--font-body), sans-serif" }}
      >
        <ErrorShell
          code="Error"
          title="Application error"
          message="Azalea hit a critical error. Try reloading the page or come back in a moment."
        >
          <button type="button" className="btn btn-primary min-w-[10rem]" onClick={() => reset()}>
            Reload
          </button>
          <Link href="/" className="btn btn-ghost min-w-[10rem]">
            Back home
          </Link>
        </ErrorShell>
      </body>
    </html>
  );
}
