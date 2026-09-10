import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyIconPack,
  getStoredIconPack,
  setStoredIconPack,
  type IconPackId,
} from "../lib/iconPack";

interface IconPackContextValue {
  iconPack: IconPackId;
  changeIconPack: (id: IconPackId) => void;
}

const IconPackContext = createContext<IconPackContextValue | null>(null);

export function IconPackProvider({ children }: { children: ReactNode }) {
  const [iconPack, setIconPack] = useState<IconPackId>(() => getStoredIconPack());

  useEffect(() => {
    applyIconPack(iconPack);
  }, [iconPack]);

  useEffect(() => {
    const onPack = (event: Event) => {
      const next = (event as CustomEvent<IconPackId>).detail;
      if (next) setIconPack(next);
    };
    window.addEventListener("azalea-icon-pack", onPack);
    return () => window.removeEventListener("azalea-icon-pack", onPack);
  }, []);

  const changeIconPack = useCallback((id: IconPackId) => {
    setIconPack(id);
    setStoredIconPack(id);
  }, []);

  const value = useMemo(
    () => ({ iconPack, changeIconPack }),
    [iconPack, changeIconPack],
  );

  return <IconPackContext.Provider value={value}>{children}</IconPackContext.Provider>;
}

export function useIconPack(): IconPackContextValue {
  const ctx = useContext(IconPackContext);
  if (!ctx) {
    return {
      iconPack: getStoredIconPack(),
      changeIconPack: setStoredIconPack,
    };
  }
  return ctx;
}
