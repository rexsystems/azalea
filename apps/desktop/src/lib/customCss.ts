const STORAGE_KEY = "azalea-custom-css";
const STYLE_ELEMENT_ID = "azalea-custom-css";
const MAX_CSS_CHARS = 64_000;
export const CUSTOM_CSS_EVENT = "azalea-custom-css";

export interface CustomCssSettings {
  enabled: boolean;
  css: string;
}

const DEFAULT: CustomCssSettings = {
  enabled: false,
  css: "",
};

export const CUSTOM_CSS_PLACEHOLDER = `/* Overrides the active theme. Examples:

html {
  --accent: #ff6b6b;
  --bg-base: #0a0a0c;
}

[data-theme="noir"] {
  --accent: #a3e635;
}
*/`;

export function getStoredCustomCss(): CustomCssSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<CustomCssSettings>;
    return {
      enabled: Boolean(parsed.enabled),
      css: typeof parsed.css === "string" ? parsed.css.slice(0, MAX_CSS_CHARS) : "",
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function setStoredCustomCss(settings: CustomCssSettings) {
  const next: CustomCssSettings = {
    enabled: Boolean(settings.enabled),
    css: sanitizeCss(settings.css),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  applyCustomCss(next);
  window.dispatchEvent(new CustomEvent(CUSTOM_CSS_EVENT, { detail: next }));
}

/** Enable/disable without overwriting unsaved draft CSS. */
export function setCustomCssEnabledFlag(enabled: boolean) {
  const stored = getStoredCustomCss();
  setStoredCustomCss({ enabled: Boolean(enabled), css: stored.css });
}

/** Strip sequences that could break out of a <style> element. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/\u0000/g, "")
    .replace(/<\/style/gi, "<\\/style")
    .slice(0, MAX_CSS_CHARS);
}

export function applyCustomCss(settings: CustomCssSettings = getStoredCustomCss()) {
  const existing = document.getElementById(STYLE_ELEMENT_ID);
  if (!settings.enabled || !settings.css.trim()) {
    existing?.remove();
    return;
  }

  const el =
    (existing as HTMLStyleElement | null) ??
    (() => {
      const style = document.createElement("style");
      style.id = STYLE_ELEMENT_ID;
      document.documentElement.appendChild(style);
      return style;
    })();

  el.textContent = sanitizeCss(settings.css);
}

export function clearCustomCss() {
  setStoredCustomCss({ enabled: false, css: "" });
}
