import { useCallback, useState } from "react";
import {
  getStoredConnectScreen,
  setStoredConnectScreen,
  type ConnectScreenMode,
} from "../lib/settings";

export function useConnectScreen() {
  const [connectScreen, setConnectScreen] = useState<ConnectScreenMode>(() =>
    getStoredConnectScreen(),
  );

  const changeConnectScreen = useCallback((mode: ConnectScreenMode) => {
    setConnectScreen(mode);
    setStoredConnectScreen(mode);
  }, []);

  return { connectScreen, changeConnectScreen };
}
