import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "t-one-theme";

function getSystemTheme() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useTheme() {
  const [preference, setPreference] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });

  const [systemTheme, setSystemTheme] = useState(getSystemTheme);

  useEffect(() => {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return undefined;

    const onChange = () => setSystemTheme(mql.matches ? "dark" : "light");
    onChange();

    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);

    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  const resolved = useMemo(() => {
    return preference === "system" ? systemTheme : preference;
  }, [preference, systemTheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  const toggle = () => setPreference((p) => (p === "dark" ? "light" : "dark"));

  return {
    preference,
    resolved,
    setPreference,
    toggle,
  };
}

