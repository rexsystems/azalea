export interface BatchSettings {
  timeoutEnabled: boolean;
  timeoutMinutes: number;
}

export const defaultBatchSettings: BatchSettings = { timeoutEnabled: true, timeoutMinutes: 60 };
export const MAX_BATCH_TIMEOUT_MINUTES = 10080;
export const BATCH_SETTINGS_EVENT = "azalea-batch-settings";
const STORAGE_KEY = "azalea-batch-settings";

export function validBatchTimeoutMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_BATCH_TIMEOUT_MINUTES;
}

export function getStoredBatchSettings(): BatchSettings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { ...defaultBatchSettings };
    const settings = parsed as Partial<BatchSettings>;
    return {
      timeoutEnabled: typeof settings.timeoutEnabled === "boolean" ? settings.timeoutEnabled : true,
      timeoutMinutes:
        typeof settings.timeoutMinutes === "number" &&
        validBatchTimeoutMinutes(settings.timeoutMinutes)
          ? settings.timeoutMinutes
          : 60,
    };
  } catch {
    return { ...defaultBatchSettings };
  }
}

export function setStoredBatchSettings(settings: BatchSettings): void {
  if (
    typeof settings.timeoutEnabled !== "boolean" ||
    !validBatchTimeoutMinutes(settings.timeoutMinutes)
  ) {
    throw new Error("Invalid batch timeout settings.");
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event(BATCH_SETTINGS_EVENT));
}

export function batchTimeoutSeconds(settings: BatchSettings): number | null {
  return settings.timeoutEnabled ? settings.timeoutMinutes * 60 : null;
}

export function batchTimeoutLabel(seconds: number | null): string {
  if (seconds === null) return "No timeout";
  const minutes = seconds / 60;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"} per host`;
  return `${minutes} minute${minutes === 1 ? "" : "s"} per host`;
}
