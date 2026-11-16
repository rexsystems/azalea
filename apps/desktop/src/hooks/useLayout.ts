import { useCallback, useEffect, useState } from "react";
import {
  applyLayout,
  getStoredLayout,
  setStoredLayout,
  type LayoutId,
} from "../lib/layout";

export function useLayout() {
  const [layout, setLayout] = useState<LayoutId>(() => getStoredLayout());

  useEffect(() => {
    applyLayout(layout);
  }, [layout]);

  const changeLayout = useCallback((id: LayoutId) => {
    setLayout(id);
    setStoredLayout(id);
  }, []);

  return { layout, changeLayout };
}
