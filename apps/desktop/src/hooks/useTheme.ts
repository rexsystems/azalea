import { useCallback, useEffect, useState } from "react";
import {
  APPEARANCE_EVENT,
  getStoredUiMode,
  getStoredUiTheme,
  notifyAppearanceChanged,
  setStoredUiMode,
  setStoredUiTheme,
  type UiMode,
  type UiThemeId,
} from "../lib/appearance";
import { getStoredTheme, setStoredTheme, type ThemeId } from "../lib/theme";

/**
 * Interface mode plus both theme choices. Every setter persists and applies
 * immediately, so switching between New, Minimal and Legacy needs no restart.
 */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(() => getStoredTheme());
  const [uiMode, setUiMode] = useState<UiMode>(() => getStoredUiMode());
  const [uiTheme, setUiTheme] = useState<UiThemeId>(() => getStoredUiTheme());

  useEffect(() => {
    const sync = () => {
      setTheme(getStoredTheme());
      setUiMode(getStoredUiMode());
      setUiTheme(getStoredUiTheme());
    };
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);

  const changeTheme = useCallback((id: ThemeId) => {
    setStoredTheme(id);
    notifyAppearanceChanged();
  }, []);

  const changeUiMode = useCallback((mode: UiMode) => {
    setStoredUiMode(mode);
  }, []);

  const changeUiTheme = useCallback((id: UiThemeId) => {
    setStoredUiTheme(id);
  }, []);

  return { theme, changeTheme, uiMode, changeUiMode, uiTheme, changeUiTheme };
}
