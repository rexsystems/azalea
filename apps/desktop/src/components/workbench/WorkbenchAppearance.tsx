import { useEffect, useId, useState } from "react";
import {
  effectiveUiTheme,
  prefersDarkScheme,
  uiThemes,
  type FixedUiThemeId,
  type UiThemeId,
} from "../../lib/appearance";
import {
  clampFontSize,
  terminalFonts,
  type TerminalFontId,
  type TerminalSettings,
} from "../../lib/settings";
import {
  isLightUiTheme,
  paletteSwatches,
  terminalPalettes,
  type TerminalPaletteId,
} from "../../lib/terminalPalettes";
import { WbCheck } from "./wbIcons";

interface ThemePreviewColors {
  bg: string;
  panel: string;
  line: string;
  text: string;
  accent: string;
}

/** Literal colors so every card shows its own theme, not the active one. */
const THEME_PREVIEW: Record<FixedUiThemeId, ThemePreviewColors> = {
  ink: { bg: "#0F0F12", panel: "#16161B", line: "#26262D", text: "#ECECF1", accent: "#A898FF" },
  paper: { bg: "#FAFAF8", panel: "#F1F1ED", line: "#E0E0DA", text: "#17171C", accent: "#372882" },
  noir: { bg: "#000000", panel: "#0A0A0A", line: "#1F1F1F", text: "#FFFFFF", accent: "#FFFFFF" },
  contrast: {
    bg: "#000000",
    panel: "#000000",
    line: "#FFFFFF",
    text: "#FFFFFF",
    accent: "#FFD84D",
  },
};

const PREVIEW_OK = "#7FD19B";
const LINE_HEIGHT = 1.55;

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(prefersDarkScheme);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return dark;
}

function useLightWindow(): boolean {
  const read = () => isLightUiTheme(document.documentElement.dataset.theme);
  const [light, setLight] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setLight(read()));
    observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return light;
}

function Bar({ color, width, opacity }: { color: string; width: string; opacity?: number }) {
  return <span className="wb-tc-bar" style={{ background: color, width, opacity }} />;
}

function ThemeCard({
  id,
  label,
  description,
  selected,
  onSelect,
}: {
  id: FixedUiThemeId;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const c = THEME_PREVIEW[id];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className="wb-theme-card"
      onClick={onSelect}
    >
      <span className="wb-tc-preview" style={{ background: c.bg }} aria-hidden>
        <span className="wb-tc-side" style={{ background: c.panel, borderColor: c.line }}>
          <Bar color={c.text} width="70%" opacity={0.7} />
          <Bar color={c.accent} width="85%" />
          <Bar color={c.text} width="60%" opacity={0.35} />
          <Bar color={c.text} width="75%" opacity={0.35} />
        </span>
        <span className="wb-tc-main">
          <Bar color={PREVIEW_OK} width="45%" />
          <Bar color={c.text} width="80%" opacity={0.5} />
          <Bar color={c.text} width="65%" opacity={0.5} />
        </span>
      </span>
      <span className="wb-tc-name">
        {label}
        {selected && <WbCheck className="wb-tc-check" />}
      </span>
      <span className="wb-tc-desc">{description}</span>
    </button>
  );
}

interface WorkbenchAppearanceProps {
  uiTheme: UiThemeId;
  onUiThemeChange: (id: UiThemeId) => void;
  terminalSettings: TerminalSettings;
  onTerminalSettingsChange: (patch: Partial<TerminalSettings>) => void;
}

/** App theme, terminal palette, font and size, with a live preview. */
export function WorkbenchAppearance({
  uiTheme,
  onUiThemeChange,
  terminalSettings,
  onTerminalSettingsChange,
}: WorkbenchAppearanceProps) {
  const prefersDark = usePrefersDark();
  const lightWindow = useLightWindow();
  const followSystem = uiTheme === "system";
  const shown = effectiveUiTheme(uiTheme, prefersDark);
  const palettes = terminalPalettes(lightWindow);
  const active = palettes.find((p) => p.id === terminalSettings.palette) ?? palettes[0];
  const t = active.theme;
  const fontLabel =
    terminalFonts.find((f) => f.id === terminalSettings.fontFamily)?.label ?? "JetBrains Mono";
  const fontId = useId();
  const sizeId = useId();
  const followId = useId();

  const setSize = (size: number) => onTerminalSettingsChange({ fontSize: clampFontSize(size) });

  return (
    <>
      <section className="wb-set-section" aria-labelledby="wb-app-theme">
        <div>
          <div className="wb-set-title" id="wb-app-theme">
            App theme
          </div>
          <div className="wb-set-note">Sidebar, panels and dialogs.</div>
        </div>
        <div role="radiogroup" aria-labelledby="wb-app-theme" className="wb-theme-grid">
          {uiThemes.map((theme) => (
            <ThemeCard
              key={theme.id}
              id={theme.id}
              label={theme.label}
              description={theme.description}
              selected={shown === theme.id}
              onSelect={() => onUiThemeChange(theme.id)}
            />
          ))}
        </div>
        <label className="wb-check" htmlFor={followId}>
          <input
            id={followId}
            type="checkbox"
            checked={followSystem}
            onChange={(e) => {
              onUiThemeChange(e.target.checked ? "system" : shown);
            }}
          />
          <span className="wb-check-box" aria-hidden>
            <WbCheck />
          </span>
          Follow the system light or dark setting
        </label>
      </section>

      <section className="wb-set-cols">
        <div className="wb-set-section wb-set-tight">
          <div>
            <div className="wb-set-title" id="wb-term-colors">
              Terminal colors
            </div>
            <div className="wb-set-note">The old Ocean, Ember and Forest themes live here now.</div>
          </div>
          <div role="radiogroup" aria-labelledby="wb-term-colors" className="wb-pal-box">
            {palettes.map((p) => {
              const on = p.id === active.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="wb-row wb-pal-row"
                  aria-current={on ? "true" : undefined}
                  onClick={() => onTerminalSettingsChange({ palette: p.id as TerminalPaletteId })}
                >
                  <span
                    className="wb-swatch"
                    style={{ background: p.theme.background }}
                    aria-hidden
                  >
                    {paletteSwatches(p.theme).map((color, index) => (
                      <span key={index} style={{ background: color }} />
                    ))}
                  </span>
                  <span className="wb-row-label">{p.label}</span>
                  {on && <WbCheck className="wb-meta wb-accent" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="wb-set-section wb-set-tight">
          <div>
            <div className="wb-set-title">Preview</div>
            <div className="wb-set-note">
              {fontLabel} · {terminalSettings.fontSize} px · line height {LINE_HEIGHT}
            </div>
          </div>
          <pre
            className="wb-term-preview"
            aria-label="Terminal color preview"
            style={{
              background: t.background,
              color: t.foreground,
              fontSize: Math.max(11, terminalSettings.fontSize - 0.5),
            }}
          >
            <span style={{ color: t.green }}>deploy@web-01</span>:
            <span style={{ color: t.blue }}>~/app</span>$ ls{"\n"}
            <span style={{ color: t.blue }}>dist</span>
            {"  "}
            <span style={{ color: t.blue }}>src</span>
            {"  "}package.json{"  "}
            <span style={{ color: t.yellow }}>deploy.sh</span>
            {"\n"}
            <span style={{ color: t.green }}>deploy@web-01</span>:
            <span style={{ color: t.blue }}>~/app</span>$ git status -s{"\n"}{" "}
            <span style={{ color: t.red }}>M</span> src/routes/checkout.ts{"\n"}
            <span style={{ color: t.green }}>?? </span>notes.md
          </pre>
          <div className="wb-set-pair">
            <div>
              <label className="wb-label" htmlFor={fontId}>
                Font
              </label>
              <select
                id={fontId}
                className="wb-input wb-select"
                value={terminalSettings.fontFamily}
                onChange={(e) =>
                  onTerminalSettingsChange({ fontFamily: e.target.value as TerminalFontId })
                }
              >
                {terminalFonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="wb-label" id={sizeId}>
                Size
              </span>
              <div className="wb-input wb-stepper" role="group" aria-labelledby={sizeId}>
                <button
                  type="button"
                  aria-label="Decrease font size"
                  disabled={terminalSettings.fontSize <= 12}
                  onClick={() => setSize(terminalSettings.fontSize - 1)}
                >
                  -
                </button>
                <output className="wb-mono" aria-live="polite">
                  {terminalSettings.fontSize}
                </output>
                <button
                  type="button"
                  aria-label="Increase font size"
                  disabled={terminalSettings.fontSize >= 26}
                  onClick={() => setSize(terminalSettings.fontSize + 1)}
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
