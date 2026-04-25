import { useEffect, useMemo, useState } from "react";
import { bootstrapStatus } from "../api/auth.js";
import { LockIcon, MoonIcon, SunIcon, UserIcon } from "../components/icons/Icons.jsx";

function normalizeUsername(v) {
  return String(v || "").trim().toLowerCase();
}

export default function LoginPage({ theme, onToggleTheme, onLogin, onBootstrap }) {
  const [mode, setMode] = useState("login"); // login | bootstrap
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [bootForm, setBootForm] = useState({ name: "", username: "", password: "" });
  const [setupEnabled, setSetupEnabled] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    bootstrapStatus({ signal: controller.signal })
      .then((data) => setSetupEnabled(Boolean(data?.enabled)))
      .catch(() => setSetupEnabled(false))
      .finally(() => setSetupChecked(true));

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (mode === "bootstrap" && setupChecked && !setupEnabled) setMode("login");
  }, [mode, setupChecked, setupEnabled]);

  const subtitle = useMemo(() => {
    if (mode === "bootstrap") return "First-time setup: create the initial admin account.";
    return "Sign in to manage inventory, sales, and receipts.";
  }, [mode]);

  const submitLogin = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onLogin?.({
        username: normalizeUsername(loginForm.username),
        password: String(loginForm.password || ""),
      });
    } catch (err) {
      setError(err?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const submitBootstrap = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onBootstrap?.({
        name: String(bootForm.name || "").trim(),
        username: normalizeUsername(bootForm.username),
        password: String(bootForm.password || ""),
      });
    } catch (err) {
      setError(err?.message || "Bootstrap failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-bg" aria-hidden="true" />

      <div className="auth-card">
        <aside className="auth-hero" aria-label="T-ONE welcome">
          <div className="auth-hero-top">
            <div className="auth-mark" aria-hidden="true">
              T1
            </div>
            <button className="icon-btn auth-theme-btn" type="button" onClick={onToggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? <SunIcon className="nav-icon" /> : <MoonIcon className="nav-icon" />}
            </button>
          </div>

          <div className="auth-hero-body">
            <div className="auth-hero-eyebrow">T-ONE POS</div>
            <div className="auth-hero-title">Boutique sales, done fast.</div>
            <div className="auth-hero-sub">
              A premium dashboard for inventory, shifts, purchases, and clean receipts.
            </div>

            <div className="auth-chips" aria-label="Highlights">
              <span className="auth-chip">Bluetooth receipts</span>
              <span className="auth-chip">Discount control</span>
              <span className="auth-chip">Stock takes</span>
            </div>
          </div>

          <div className="auth-hero-foot">
            <div className="auth-hero-footline">Secure staff sign-in</div>
          </div>
        </aside>

        <section className="auth-main" aria-label="Sign in">
          <div className="auth-main-head">
            <div className="auth-main-title">{mode === "bootstrap" ? "Create Admin" : "Sign In"}</div>
            <div className="auth-main-sub">{subtitle}</div>
          </div>

          {error ? <div className="banner" style={{ marginBottom: 12 }}>{error}</div> : null}

          {mode === "login" ? (
            <form onSubmit={submitLogin}>
              <div className="field">
                <label>Username</label>
                <div className="auth-input">
                  <UserIcon className="auth-input-icon" />
                  <input
                    className="input auth-input-control"
                    value={loginForm.username}
                    onChange={(e) => setLoginForm((f) => ({ ...f, username: e.target.value }))}
                    placeholder="e.g. admin"
                    autoComplete="username"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label>Password</label>
                <div className="auth-input">
                  <LockIcon className="auth-input-icon" />
                  <input
                    className="input auth-input-control"
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="Your password"
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              <div className="auth-actions">
                <button className="btn primary auth-primary" type="submit" disabled={busy}>
                  {busy ? "Signing in..." : "Sign In"}
                </button>
                {setupEnabled ? (
                  <button className="btn ghost auth-link" type="button" onClick={() => setMode("bootstrap")} disabled={busy}>
                    First-time setup
                  </button>
                ) : null}
              </div>
            </form>
          ) : (
            <form onSubmit={submitBootstrap}>
              <div className="field">
                <label>Admin Name</label>
                <input
                  className="input"
                  value={bootForm.name}
                  onChange={(e) => setBootForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Store Admin"
                  required
                  autoFocus
                />
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label>Username</label>
                <div className="auth-input">
                  <UserIcon className="auth-input-icon" />
                  <input
                    className="input auth-input-control"
                    value={bootForm.username}
                    onChange={(e) => setBootForm((f) => ({ ...f, username: e.target.value }))}
                    placeholder="e.g. admin"
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label>Password</label>
                <div className="auth-input">
                  <LockIcon className="auth-input-icon" />
                  <input
                    className="input auth-input-control"
                    type="password"
                    value={bootForm.password}
                    onChange={(e) => setBootForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>

              <div className="auth-actions">
                <button className="btn primary auth-primary" type="submit" disabled={busy}>
                  {busy ? "Creating..." : "Create Admin"}
                </button>
                <button className="btn ghost auth-link" type="button" onClick={() => setMode("login")} disabled={busy}>
                  Back to sign in
                </button>
              </div>

              <div className="auth-note">
                One-time only. After creating the admin, keep `ALLOW_BOOTSTRAP=false` in `backend/.env`.
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
