import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  getStoredTheme,
  setStoredTheme,
  type ThemeId,
} from "../lib/theme";

export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const changeTheme = useCallback((id: ThemeId) => {
    setTheme(id);
    setStoredTheme(id);
  }, []);

  return { theme, changeTheme };
}
