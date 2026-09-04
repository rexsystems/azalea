import { writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";

/** Copy plain text via Tauri (works on Android WebView); falls back to browser API. */
export async function copyText(text: string): Promise<void> {
  try {
    await writeClipboardText(text);
    return;
  } catch {
    // fall through
  }

  await navigator.clipboard.writeText(text);
}
