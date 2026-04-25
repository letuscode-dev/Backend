import { useCallback, useEffect, useMemo, useState } from "react";

function normalizePath(path) {
  if (!path) return "/dashboard";
  if (!path.startsWith("/")) return `/${path}`;
  return path;
}

function parseHash(hash) {
  const cleaned = (hash || "").replace(/^#/, "");
  const [rawPath, rawQuery] = cleaned.split("?");
  const path = normalizePath(rawPath || "/dashboard");
  const query = new URLSearchParams(rawQuery || "");
  return { path, query };
}

function buildHash(path, query) {
  const normalized = normalizePath(path);
  const qs = query ? query.toString() : "";
  return `#${normalized}${qs ? `?${qs}` : ""}`;
}

export function useHashLocation() {
  const [loc, setLoc] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setLoc(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((path, nextQuery) => {
    const query = nextQuery instanceof URLSearchParams ? nextQuery : new URLSearchParams(nextQuery || "");
    window.location.hash = buildHash(path, query);
  }, []);

  const setQuery = useCallback((mutator) => {
    const query = new URLSearchParams(loc.query);
    mutator(query);
    window.location.hash = buildHash(loc.path, query);
  }, [loc.path, loc.query]);

  const routeKey = useMemo(() => {
    switch (loc.path) {
      case "/":
      case "/dashboard":
        return "dashboard";
      case "/products":
        return "products";
      case "/sales":
      case "/orders":
        return "sales";
      case "/inventory":
        return "inventory";
      case "/reports":
        return "reports";
      case "/settings":
        return "settings";
      default:
        return "dashboard";
    }
  }, [loc.path]);

  return { ...loc, routeKey, navigate, setQuery };
}

