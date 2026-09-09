"use client";

import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { Footer } from "@/components/Footer";
import { PLAN_COPY } from "@/lib/plans";

const FEATURES = {
  free: [
    "Cloud sync included",
    "256 KB encrypted cloud vault",
    "Unlimited local hosts and keys",
    "SSH terminal on all platforms",
    "Manual backup export/import",
  ],
  pro: [
    "Everything in Free",
    "10 MB encrypted cloud vault",
    "Room for hundreds of hosts and keys",
    "Priority when billing launches",
    "Same zero-knowledge encryption",
  ],
} as const;

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
        <div className="rise mb-12 text-center">
          <h1
            className="text-3xl font-semibold tracking-tight md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Simple plans
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm" style={{ color: "var(--text-muted)" }}>
            Free includes cloud sync. Local data is always unlimited — you only pay for more
            encrypted cloud storage.
          </p>
        </div>

        <div className="rise delay-1 grid gap-6 md:grid-cols-2">
          {(["free", "pro"] as const).map((id) => {
            const plan = PLAN_COPY[id];
            return (
              <div
                key={id}
                className="flex flex-col rounded-xl border p-6"
                style={{
                  borderColor: id === "pro" ? "color-mix(in srgb, var(--accent) 45%, var(--border))" : "var(--border)",
                  background: "var(--bg-raised)",
                }}
              >
                <div className="mb-4">
                  <h2 className="text-lg font-semibold">{plan.name}</h2>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-semibold">{plan.price}</span>
                    <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {plan.period}
                    </span>
                  </div>
                  <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                    {plan.storage}
                  </p>
                </div>
                <ul className="mb-6 flex-1 space-y-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                  {FEATURES[id].map((item) => (
                    <li key={item} className="flex gap-2">
                      <span style={{ color: "var(--accent)" }}>·</span>
                      {item}
                    </li>
                  ))}
                </ul>
                {id === "free" ? (
                  <Link href="/signup" className="btn btn-ghost w-full">
                    Get started
                  </Link>
                ) : (
                  <a
                    href="mailto:alexutzeranio@gmail.com?subject=Azalea%20Pro"
                    className="btn btn-primary w-full"
                  >
                    Contact for Pro
                  </a>
                )}
              </div>
            );
          })}
        </div>

        <p
          className="rise delay-2 mx-auto mt-10 max-w-xl text-center text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Online checkout is coming soon. Until then, Pro is enabled manually from your account
          after you get in touch.
        </p>
      </main>
      <Footer />
    </div>
  );
}
