/** Anonymous daily pings + crash reports (opt-in). No hosts, emails, or keys. */

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

const ENABLED_KEY = "azalea-telemetry-enabled";
const ASKED_KEY = "azalea-telemetry-asked";
const INSTALL_ID_KEY = "azalea-telemetry-install-id";
const LAST_PING_DAY_KEY = "azalea-telemetry-last-ping-day";
const CRASH_QUEUE_KEY = "azalea-telemetry-crash-queue";
const CRASH_RATE_KEY = "azalea-telemetry-crash-rate";

export const TELEMETRY_BASE_URL = "https://azalea-penguin.694206767.xyz";

const MAX_QUEUE = 12;
const MAX_CRASHES_PER_HOUR = 8;
const MAX_MESSAGE = 240;
const MAX_STACK = 800;

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

interface PendingCrashFile {
  kind?: string;
  message?: string;
  stack?: string;
  app_version?: string;
  created_at?: string;
}

export function getTelemetryAsked(): boolean {
  return localStorage.getItem(ASKED_KEY) === "1";
}

export function setTelemetryAsked() {
  localStorage.setItem(ASKED_KEY, "1");
}

export function isTelemetryEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "1";
}

export function setTelemetryEnabled(enabled: boolean) {
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  setTelemetryAsked();
  if (enabled) {
    void flushCrashQueue();
    void flushPendingNativeCrash();
  }
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

function fingerprint(kind: CrashKind, message: string | undefined): string {
  return `${kind}:${(message ?? "").slice(0, 120)}`;
}

function readCrashRate(): { hour: string; count: number; fps: string[] } {
  try {
    const raw = localStorage.getItem(CRASH_RATE_KEY);
    if (!raw) return { hour: "", count: 0, fps: [] };
    const parsed = JSON.parse(raw) as { hour?: string; count?: number; fps?: string[] };
    return {
      hour: parsed.hour ?? "",
      count: typeof parsed.count === "number" ? parsed.count : 0,
      fps: Array.isArray(parsed.fps) ? parsed.fps.slice(0, 40) : [],
    };
  } catch {
    return { hour: "", count: 0, fps: [] };
  }
}

function crashRateWindow(): { hour: string; count: number; fps: string[] } {
  const hour = new Date().toISOString().slice(0, 13);
  const state = readCrashRate();
  return state.hour === hour ? state : { hour, count: 0, fps: [] };
}

/** Returns 'send' | 'skip' (duplicate/cap — drop) */
function crashSendDecision(kind: CrashKind, message: string | undefined): "send" | "skip" {
  const next = crashRateWindow();
  const fp = fingerprint(kind, message);
  if (next.fps.includes(fp)) return "skip";
  if (next.count >= MAX_CRASHES_PER_HOUR) return "skip";
  return "send";
}

function noteCrashSent(kind: CrashKind, message: string | undefined) {
  const next = crashRateWindow();
  const fp = fingerprint(kind, message);
  if (!next.fps.includes(fp)) next.fps = [...next.fps, fp].slice(-40);
  next.count += 1;
  localStorage.setItem(CRASH_RATE_KEY, JSON.stringify(next));
}

function readQueue(): CrashReport[] {
  try {
    const raw = localStorage.getItem(CRASH_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CrashReport[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_QUEUE) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: CrashReport[]) {
  localStorage.setItem(CRASH_QUEUE_KEY, JSON.stringify(items.slice(0, MAX_QUEUE)));
}

async function postCrash(
  report: CrashReport,
  appVersion: string,
): Promise<"ok" | "retry" | "drop"> {
  const kind = normalizeKind(report.kind);
  const message = clip(report.message, MAX_MESSAGE);
  const stack = clip(report.stack, MAX_STACK);
  const decision = crashSendDecision(kind, message);
  if (decision === "skip") return "drop";

  try {
    const res = await fetch(`${TELEMETRY_BASE_URL}/v1/crash`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        install_id: getOrCreateInstallId(),
        kind,
        message,
        stack,
        app_version: appVersion.slice(0, 32),
        os: detectOs(),
        arch: detectArch(),
      }),
    });
    if (!res.ok) return "retry";
    noteCrashSent(kind, message);
    return "ok";
  } catch {
    return "retry";
  }
}

/** Queue + send a crash report when telemetry is enabled. */
export async function reportCrash(report: CrashReport): Promise<void> {
  if (!isTelemetryEnabled()) return;
  const kind = normalizeKind(report.kind);
  const payload: CrashReport = {
    kind,
    message: clip(report.message, MAX_MESSAGE),
    stack: clip(report.stack, MAX_STACK),
  };

  let version = "unknown";
  try {
    version = await getVersion();
  } catch {
    /* ignore */
  }

  const result = await postCrash(payload, version);
  if (result === "retry") {
    const q = readQueue();
    q.push(payload);
    writeQueue(q);
  }
}

export async function flushCrashQueue(): Promise<void> {
  if (!isTelemetryEnabled()) return;
  const q = readQueue();
  if (q.length === 0) return;
  let version = "unknown";
  try {
    version = await getVersion();
  } catch {
    /* ignore */
  }
  const remaining: CrashReport[] = [];
  for (const item of q) {
    const result = await postCrash(item, version);
    if (result === "retry") remaining.push(item);
  }
  writeQueue(remaining);
}

export async function flushPendingNativeCrash(): Promise<void> {
  if (!isTelemetryEnabled()) return;
  try {
    const pending = await invoke<PendingCrashFile | null>("take_pending_crash");
    if (!pending) return;
    await reportCrash({
      kind: normalizeKind(pending.kind ?? "rust_panic"),
      message: pending.message,
      stack: pending.stack,
    });
  } catch {
    /* command missing / not tauri */
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

/** Global JS error hooks (idempotent). */
export function installCrashReporting(): void {
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
