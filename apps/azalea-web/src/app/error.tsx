"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorShell } from "@/components/ErrorShell";

export default function Error({
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
    <ErrorShell
      code="500"
      title="Something went wrong"
      message="An unexpected error occurred while loading this page. You can try again or return home."
    >
      <button type="button" className="btn btn-primary min-w-[10rem]" onClick={() => reset()}>
        Try again
      </button>
      <Link href="/" className="btn btn-ghost min-w-[10rem]">
        Back home
      </Link>
    </ErrorShell>
  );
}
