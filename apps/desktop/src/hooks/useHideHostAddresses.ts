import { useEffect, useState } from "react";
import { getStoredHideHostAddresses } from "../lib/settings";

export function useHideHostAddresses(): boolean {
  const [hide, setHide] = useState(getStoredHideHostAddresses);

  useEffect(() => {
    const sync = () => setHide(getStoredHideHostAddresses());
    window.addEventListener("azalea-hide-host-addresses", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("azalea-hide-host-addresses", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return hide;
}
