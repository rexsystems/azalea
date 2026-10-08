"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredSession } from "@/lib/azalea-api";
import { AdminDenied, AdminLayout } from "@/components/admin/AdminLayout";
import { ServerAiPanel } from "@/components/admin/ServerAiPanel";

export default function ServerAiPage() {
  const router = useRouter();
  const [denied, setDenied] = useState(false);
  const onDenied = useCallback(() => setDenied(true), []);
  useEffect(() => {
    if (!getStoredSession()) router.replace("/login?next=%2Fadmin%2Fai");
  }, [router]);
  if (denied) return <AdminDenied />;
  return (
    <AdminLayout
      title="Server AI"
      subtitle="Providers, shared models and per-user limits"
    >
      <ServerAiPanel onDenied={onDenied} />
    </AdminLayout>
  );
}
