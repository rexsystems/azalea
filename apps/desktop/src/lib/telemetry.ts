/** Opt-in anonymous daily install pings (active users). Crashes go to GlitchTip. */

import { invoke } from "@tauri-apps/api/core";

const ENABLED_KEY = "azalea-telemetry-enabled";
const ASKED_KEY = "azalea-telemetry-asked";
const INSTALL_ID_KEY = "azalea-telemetry-install-id";
const LAST_PING_DAY_KEY = "azalea-telemetry-last-ping-day";

export const TELEMETRY_BASE_URL = "https://azalea-penguin.694206767.xyz";

export type CrashKind =
  | "js_error"
  | "js_unhandledrejection"
  | "react_boundary"
  | "rust_panic"
  | "native"
  | "unknown";

export interface CrashReport {
  kind: CrashKind;
  message?: string;
  stack?: string;
}

const MAX_MESSAGE = 240;
const MAX_STACK = 800;

export function getTelemetryAsked(): boolean {
  return localStorage.getItem(ASKED_KEY) === "1";
}

export function setTelemetryAsked() {
  localStorage.setItem(ASKED_KEY, "1");
}

export function isTelemetryEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "1";
}

function syncCrashReporting(enabled: boolean) {
  void invoke("set_crash_reporting_enabled", { enabled }).catch(() => {
    /* not in tauri / command missing */
  });
}

export function setTelemetryEnabled(enabled: boolean) {
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  setTelemetryAsked();
  syncCrashReporting(enabled);
}

export function getOrCreateInstallId(): string {
  const existing = localStorage.getItem(INSTALL_ID_KEY)?.trim();
  if (existing && existing.length >= 8) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `az-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(INSTALL_ID_KEY, id);
  return id;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function detectOs(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export function detectArch(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("aarch64") || ua.includes("arm64")) return "aarch64";
  if (ua.includes("x86_64") || ua.includes("win64") || ua.includes("wow64")) return "x86_64";
  if (ua.includes("i686") || ua.includes("i386")) return "x86";
  return "unknown";
}

function redact(text: string): string {
  let out = text;
  out = out.replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi, "[email]");
  out = out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]");
  out = out.replace(/(\/home|\/Users|\/root)\/[^\s/"']+/g, "$1/[user]");
  out = out.replace(/[A-Za-z]:\\Users\\[^\s\\/"']+/gi, "[drive]\\Users\\[user]");
  out = out.replace(/[\u0000-\u001f\u007f]/g, " ");
  return out.trim();
}

function clip(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const cleaned = redact(text).slice(0, max).trim();
  return cleaned || undefined;
}

function normalizeKind(kind: string | undefined): CrashKind {
  switch (kind) {
    case "js_error":
    case "js_unhandledrejection":
    case "react_boundary":
    case "rust_panic":
    case "native":
      return kind;
    default:
      return "unknown";
  }
}

/** Send a crash / error to GlitchTip when telemetry is enabled. */
export async function reportCrash(report: CrashReport): Promise<void> {
  if (!isTelemetryEnabled()) return;
  const kind = normalizeKind(report.kind);
  const message = clip(report.message, MAX_MESSAGE) ?? kind;
  const stack = clip(report.stack, MAX_STACK);
  try {
    await invoke("report_client_error", {
      input: { kind, message, stack: stack ?? null },
    });
  } catch {
    /* offline / not tauri */
  }
}

/** At most one successful ping per UTC day when enabled. */
export async function maybeTelemetryPing(appVersion: string): Promise<void> {
  if (!isTelemetryEnabled()) return;
  const day = todayUtc();
  if (localStorage.getItem(LAST_PING_DAY_KEY) === day) return;

  const install_id = getOrCreateInstallId();
  try {
    const res = await fetch(`${TELEMETRY_BASE_URL}/v1/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        install_id,
        app_version: appVersion.slice(0, 32),
        os: detectOs(),
        arch: detectArch(),
      }),
    });
    if (!res.ok) return;
    localStorage.setItem(LAST_PING_DAY_KEY, day);
  } catch {
    /* offline / blocked — try again next launch */
  }
}

let crashHandlersInstalled = false;

/** Global JS error hooks (idempotent). Syncs GlitchTip enable flag on install. */
export function installCrashReporting(): void {
  syncCrashReporting(isTelemetryEnabled());
  if (crashHandlersInstalled || typeof window === "undefined") return;
  crashHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    const err = event.error;
    const message =
      (err && typeof err === "object" && "message" in err && String((err as Error).message)) ||
      event.message ||
      "window.error";
    const stack =
      err && typeof err === "object" && "stack" in err
        ? String((err as Error).stack ?? "")
        : undefined;
    void reportCrash({ kind: "js_error", message, stack });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    let message = "unhandledrejection";
    let stack: string | undefined;
    if (reason instanceof Error) {
      message = reason.message || message;
      stack = reason.stack;
    } else if (typeof reason === "string") {
      message = reason;
    } else if (reason != null) {
      try {
        message = JSON.stringify(reason).slice(0, MAX_MESSAGE);
      } catch {
        message = String(reason);
      }
    }
    void reportCrash({ kind: "js_unhandledrejection", message, stack });
  });
}
