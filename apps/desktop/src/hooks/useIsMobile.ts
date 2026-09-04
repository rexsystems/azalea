import { useEffect, useState } from "react";

/** True on Tauri Android/iOS webviews (and similar mobile UAs). */
export function isMobileRuntime(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

/**
 * Mobile layout mode: native mobile runtime, or narrow viewport.
 * Sets `document.documentElement.dataset.mobile` to `"true"` / `"false"`.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return isMobileRuntime() || window.innerWidth < 768;
  });

  useEffect(() => {
    const apply = (value: boolean) => {
      setMobile(value);
      document.documentElement.dataset.mobile = value ? "true" : "false";
    };

    if (isMobileRuntime()) {
      apply(true);
      return;
    }

    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => apply(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return mobile;
}
