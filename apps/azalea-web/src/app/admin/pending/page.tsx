"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminPendingPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin");
  }, [router]);
  return null;
}
