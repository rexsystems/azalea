import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Create account",
  robots: { index: false, follow: false },
  alternates: { canonical: "/signup" },
};

export default function SignupPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
