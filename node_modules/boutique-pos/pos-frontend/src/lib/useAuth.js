import { useCallback, useEffect, useMemo, useState } from "react";
import * as authApi from "../api/auth.js";
import { clearTokens, getRefreshToken, setTokens } from "./authTokens.js";

const AUTH_LOGOUT_EVENT = "tone:auth:logout";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshMe = useCallback(async ({ signal } = {}) => {
    try {
      const data = await authApi.me({ signal });
      setUser(data?.user || null);
      setError("");
      return data?.user || null;
    } catch (err) {
      // If not logged in / tokens expired, treat as signed out.
      setUser(null);
      setError("");
      return null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refreshMe({ signal: controller.signal }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [refreshMe]);

  useEffect(() => {
    const onLogout = () => {
      setUser(null);
      setError("");
    };

    if (typeof window !== "undefined") {
      window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
      }
    };
  }, []);

  const login = useCallback(async ({ username, password }) => {
    setError("");
    const data = await authApi.login({ username, password });
    if (data?.accessToken && data?.refreshToken) {
      setTokens({ accessToken: String(data.accessToken), refreshToken: String(data.refreshToken) });
    }
    setUser(data?.user || null);
    return data;
  }, []);

  const bootstrap = useCallback(async ({ name, username, password }) => {
    setError("");
    const data = await authApi.bootstrap({ name, username, password });
    if (data?.accessToken && data?.refreshToken) {
      setTokens({ accessToken: String(data.accessToken), refreshToken: String(data.refreshToken) });
    }
    setUser(data?.user || null);
    return data;
  }, []);

  const logout = useCallback(async () => {
    setError("");
    const rt = getRefreshToken();
    try {
      if (rt) await authApi.logout({ refreshToken: rt });
    } catch {
      // ignore network/server errors on logout
    }
    clearTokens();
    setUser(null);
  }, []);

  const isAdmin = useMemo(() => String(user?.role || "").toLowerCase() === "admin", [user]);

  return {
    user,
    loading,
    error,
    setError,
    login,
    bootstrap,
    logout,
    refreshMe,
    isAdmin,
  };
}
