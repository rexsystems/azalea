"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiRequestError, getStoredSession } from "@/lib/azalea-api";
import { getAdminSettings, patchAdminSettings } from "@/lib/admin-api";
import type { AdminSettings } from "@/lib/admin-users";
import { AdminDenied, AdminLayout, AdminLoading } from "@/components/admin/AdminLayout";
import { CustomSelect } from "@/components/CustomSelect";
import { ApprovalToggle } from "@/components/admin/ApprovalToggle";

export default function InstanceSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  useEffect(() => {
    if (!getStoredSession()) { router.replace("/login?next=%2Fadmin%2Fsettings"); return; }
    void getAdminSettings().then(setSettings).catch((err) => { if (err instanceof ApiRequestError && err.status === 403) setDenied(true); else setError(err instanceof Error ? err.message : String(err)); });
  }, [router]);
  if (denied) return <AdminDenied />;
  if (!settings && !error) return <AdminLoading />;
  const save = async () => {
    if (!settings) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const next = await patchAdminSettings({ instance_name: settings.instance_name.trim(), signup_enabled: settings.signup_enabled,
        free_limit_bytes: settings.free_limit_bytes, pro_limit_bytes: settings.pro_limit_bytes, captcha_provider: settings.captcha_provider,
        captcha_site_key: settings.captcha_site_key.trim(), ...(clearSecret ? { captcha_secret_key: "" } : secret.trim() ? { captcha_secret_key: secret.trim() } : {}) });
      setSettings(next); setSecret(""); setClearSecret(false); setMessage("Instance settings saved.");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  return <AdminLayout title="Instance settings" subtitle="Identity, registration, storage and captcha">
    {error && <p className="admin-error" role="alert">{error}</p>}
    {message && <p className="admin-success" role="status">{message}</p>}
    {settings && <div className="server-ai-panel">
      <section className="rex-card"><div className="rex-card-head"><h2>Identity and access</h2></div>
        <div className="server-ai-grid">
          <label className="rex-label">Instance name<input className="field" disabled={busy} maxLength={100} value={settings.instance_name} onChange={(e) => setSettings({ ...settings, instance_name: e.target.value })} /></label>
          <div className="rex-label">Public registration<ApprovalToggle id="instance-signup" approved={settings.signup_enabled} approvedLabel="Open" pendingLabel="Closed" disabled={busy} onChange={(signup_enabled) => setSettings({ ...settings, signup_enabled })} /><p className="rex-hint">When closed, administrators can still create accounts.</p></div>
        </div>
      </section>
      <section className="rex-card"><div className="rex-card-head"><h2>Vault storage</h2><span>Per account</span></div>
        <div className="server-ai-grid">
          <label className="rex-label">Free limit (KiB)<input className="field" type="number" min={1} max={1048576} disabled={busy} value={settings.free_limit_bytes / 1024} onChange={(e) => setSettings({ ...settings, free_limit_bytes: Math.round(Number(e.target.value) * 1024) })} /></label>
          <label className="rex-label">Pro limit (KiB)<input className="field" type="number" min={1} max={1048576} disabled={busy} value={settings.pro_limit_bytes / 1024} onChange={(e) => setSettings({ ...settings, pro_limit_bytes: Math.round(Number(e.target.value) * 1024) })} /></label>
        </div><p className="rex-hint">Lowering a limit does not delete existing vault data. Users must reduce their vault before uploading again.</p>
      </section>
      <section className="rex-card"><div className="rex-card-head"><h2>Captcha</h2><span>{settings.captcha_secret_configured ? "Secret saved" : "No secret saved"}</span></div>
        <div className="server-ai-grid">
          <label className="rex-label">Provider<CustomSelect ariaLabel="Captcha provider" disabled={busy} value={settings.captcha_provider} options={[{ value: "none", label: "Disabled" }, { value: "turnstile", label: "Cloudflare Turnstile" }]} onChange={(captcha_provider) => setSettings({ ...settings, captcha_provider })} /></label>
          <label className="rex-label">Site key<input className="field" disabled={busy} value={settings.captcha_site_key} onChange={(e) => setSettings({ ...settings, captcha_site_key: e.target.value })} /></label>
          <label className="rex-label">Secret key<input className="field" type="password" autoComplete="off" disabled={busy} value={secret} placeholder={settings.captcha_secret_configured ? "Leave blank to keep the saved secret" : "Turnstile secret key"} onChange={(e) => { setSecret(e.target.value); setClearSecret(false); }} /></label>
        </div>
        <label className="rex-hint"><input type="checkbox" disabled={busy} checked={clearSecret} onChange={(e) => { setClearSecret(e.target.checked); setSecret(""); }} /> Remove saved secret on save</label>
        <p className="rex-hint">The dashboard loads these settings from the server; no frontend rebuild is needed. Disable captcha before clearing its active secret.</p>
      </section>
      <div className="server-ai-save"><p className="rex-hint">Settings apply to this self-hosted instance.</p><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save instance settings"}</button></div>
    </div>}
  </AdminLayout>;
}
