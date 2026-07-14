import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateCheckResult =
  | { status: "current" }
  | { status: "available"; update: Update; version: string }
  | { status: "unavailable"; message: string };

export function isUpdaterSupported(): boolean {
  return !import.meta.env.DEV;
}

export function formatUpdateError(error: unknown): string {
  const message = String(error);

  if (
    message.includes("valid release JSON") ||
    message.includes("404") ||
    message.includes("Not Found")
  ) {
    return "No published release yet. Updates appear after the first signed release is uploaded.";
  }

  if (message.includes("network") || message.includes("fetch")) {
    return "Could not reach the update server. Check your internet connection and try again.";
  }

  return message.replace(/^Error:\s*/i, "");
}

export async function checkForUpdateSilent(): Promise<Extract<UpdateCheckResult, { status: "available" }> | null> {
  const result = await checkForUpdate();
  if (result.status === "available") return result;
  return null;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isUpdaterSupported()) {
    return {
      status: "unavailable",
      message: "Auto-updates work in release builds only, not in dev mode.",
    };
  }

  try {
    const update = await check();
    if (!update) return { status: "current" };
    return { status: "available", update, version: update.version };
  } catch (error) {
    return { status: "unavailable", message: formatUpdateError(error) };
  }
}

export async function installUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
