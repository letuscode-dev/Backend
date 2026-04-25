import { useEffect, useMemo, useState } from "react";
import { createUser, deleteUser, listUsers, updateUser } from "../api/users.js";
import { PencilIcon, PlusIcon, TrashIcon } from "../components/icons/Icons.jsx";
import Modal from "../components/ui/Modal.jsx";
import {
  BT_PRINTER_ADDRESS_KEY,
  connectPrinter,
  disconnectPrinter,
  isNativeAndroid,
  listPairedPrinters,
  printText,
  requestBluetoothPermission,
} from "../native/bluetoothEscpos.js";

function formatDateTimeParts(isoLike) {
  try {
    const d = new Date(isoLike);
    const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }).format(d);
    const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(d);
    return { date, time };
  } catch {
    return { date: String(isoLike), time: "" };
  }
}

export default function SettingsPage({ theme, onToggleTheme, search, onSearchChange, me, onLogout }) {
  const apiBase = (import.meta.env.VITE_API_BASE_URL || "").trim() || "(using /api proxy)";
  const androidNative = isNativeAndroid();
  const isAdmin = useMemo(() => String(me?.role || "").toLowerCase() === "admin", [me]);

  const [users, setUsers] = useState(null);
  const [usersError, setUsersError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({ name: "", username: "", password: "", role: "cashier", canDiscount: false });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [btPrinters, setBtPrinters] = useState(null);
  const [btPrinterAddress, setBtPrinterAddress] = useState(() => {
    try {
      return localStorage.getItem(BT_PRINTER_ADDRESS_KEY) || "";
    } catch {
      return "";
    }
  });
  const [btBusy, setBtBusy] = useState(false);
  const [btError, setBtError] = useState("");

  useEffect(() => {
    if (!isAdmin) {
      setUsers([]);
      setUsersError("");
      return;
    }

    const controller = new AbortController();

    listUsers({ signal: controller.signal })
      .then((data) => {
        setUsersError("");
        setUsers(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setUsersError(err?.message || "Failed to load users");
        setUsers([]);
      });

    return () => controller.abort();
  }, [isAdmin]);

  const loadPairedPrinters = () => {
    if (!androidNative) return;
    setBtError("");
    setBtBusy(true);

    requestBluetoothPermission()
      .then(() => listPairedPrinters())
      .then((res) => setBtPrinters(Array.isArray(res?.devices) ? res.devices : []))
      .catch((err) => setBtError(err?.message || "Failed to load paired printers"))
      .finally(() => setBtBusy(false));
  };

  const savePrinterAddress = (address) => {
    setBtPrinterAddress(address);
    try {
      if (!address) localStorage.removeItem(BT_PRINTER_ADDRESS_KEY);
      else localStorage.setItem(BT_PRINTER_ADDRESS_KEY, address);
    } catch {
      // ignore
    }
  };

  const testBluetoothPrint = async () => {
    setBtError("");
    if (!androidNative) return;
    if (!btPrinterAddress) {
      setBtError("Select a Bluetooth printer first.");
      return;
    }

    setBtBusy(true);
    try {
      await requestBluetoothPermission();
      await connectPrinter(btPrinterAddress);
      await printText(
        ["T-ONE", "Bluetooth Test Print", new Date().toLocaleString(), "", "If you can read this, printing works.", ""].join("\n") +
          "\n",
        { feedLines: 5 }
      );
    } catch (err) {
      setBtError(err?.message || "Failed to print");
    } finally {
      try {
        await disconnectPrinter();
      } catch {
        // ignore
      }
      setBtBusy(false);
    }
  };

  const filteredUsers = useMemo(() => {
    if (!Array.isArray(users)) return [];
    const q = String(search || "").trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      return (
        String(u.name || "").toLowerCase().includes(q) ||
        String(u.username || "").toLowerCase().includes(q) ||
        String(u.role || "").toLowerCase().includes(q) ||
        String(u.id || "").toLowerCase().includes(q)
      );
    });
  }, [users, search]);

  const openAddUser = () => {
    setFormError("");
    setEditingUser(null);
    setForm({ name: "", username: "", password: "", role: "cashier", canDiscount: false });
    setUserModalOpen(true);
  };

  const openEditUser = (u) => {
    setFormError("");
    setEditingUser(u);
    setForm({
      name: String(u.name || ""),
      username: String(u.username || ""),
      password: "",
      role: String(u.role || "cashier"),
      canDiscount: Boolean(u.canDiscount),
    });
    setUserModalOpen(true);
  };

  const saveUser = (e) => {
    e.preventDefault();
    setFormError("");

    const name = form.name.trim();
    const username = String(form.username || "")
      .trim()
      .toLowerCase();
    const password = String(form.password || "");
    const role = String(form.role || "").trim().toLowerCase();
    const canDiscount = role === "admin" ? true : Boolean(form.canDiscount);
    if (!name) return setFormError("Name is required.");
    if (!username) return setFormError("Username is required.");
    if (username.length < 3 || username.length > 40) return setFormError("Username must be 3-40 characters.");
    if (!/^[a-z0-9._-]+$/.test(username)) {
      return setFormError("Username may only contain a-z, 0-9, dot (.), underscore (_), and dash (-).");
    }
    if (role !== "admin" && role !== "cashier") return setFormError("Role must be admin or cashier.");
    if (!editingUser && password.length < 6) return setFormError("Password must be at least 6 characters.");
    if (editingUser && password && password.length < 6) return setFormError("Password must be at least 6 characters.");

    setSaving(true);

    const payload = { name, username, role, canDiscount, ...(password ? { password } : null) };
    const op = editingUser ? updateUser(editingUser.id, payload) : createUser(payload);
    op
      .then((saved) => {
        setUsers((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          if (editingUser) {
            return list.map((u) => (u.id === editingUser.id ? { ...u, ...saved } : u));
          }
          return [{ ...saved }, ...list];
        });
        setUserModalOpen(false);
      })
      .catch((err) => setFormError(err?.message || "Failed to save user"))
      .finally(() => setSaving(false));
  };

  const removeUser = (id) => {
    setUsersError("");
    if (!window.confirm("Delete this user?")) return;

    setBusyId(id);
    deleteUser(id)
      .then(() => {
        setUsers((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          return list.filter((u) => u.id !== id);
        });
      })
      .catch((err) => setUsersError(err?.message || "Failed to delete user"))
      .finally(() => setBusyId(null));
  };

  return (
    <section className="page">
      <div className="page-header">
        <div className="page-title">
          <h1>Settings</h1>
          <p>Personalize the dashboard for your store.</p>
        </div>
      </div>

      <div className="grid">
        <div className="card col-6">
          <div className="card-header">
            <h3>Account</h3>
          </div>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
            Signed in as <strong>{me?.name || "-"}</strong>
            {me?.username ? ` (@${me.username})` : ""} — <strong>{String(me?.role || "").toLowerCase() || "-"}</strong>
          </p>
          <div className="field-row">
            <button className="btn" type="button" onClick={onLogout}>
              Log out
            </button>
          </div>
        </div>

        <div className="card col-6">
          <div className="card-header">
            <h3>Appearance</h3>
          </div>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
            Switch between light and dark mode.
          </p>
          <div className="field-row">
            <button className="btn primary" type="button" onClick={onToggleTheme}>
              Toggle Theme (currently {theme})
            </button>
          </div>
        </div>

        <div className="card col-6">
          <div className="card-header">
            <h3>API</h3>
          </div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            <strong>VITE_API_BASE_URL</strong>: {apiBase}
          </p>
        </div>

        <div className="card col-6">
          <div className="card-header">
            <h3>Printing</h3>
          </div>
          {androidNative ? (
            <>
              <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
                Pair your 58mm ESC/POS printer in Android Bluetooth settings first. Then select it here for one-tap receipt printing.
              </p>

              {btError ? <div className="banner" style={{ marginBottom: 12 }}>{btError}</div> : null}

              <div className="field-row" style={{ alignItems: "flex-end" }}>
                <div className="field" style={{ flex: "1 1 320px", minWidth: 240 }}>
                  <label>Bluetooth Printer (paired)</label>
                  <select
                    className="input"
                    value={btPrinterAddress}
                    onChange={(e) => savePrinterAddress(e.target.value)}
                    disabled={btBusy}
                  >
                    <option value="">Select a printer...</option>
                    {(btPrinters || []).map((d) => (
                      <option key={d.address} value={d.address}>
                        {(d.name || "Printer").trim()} ({d.address})
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn" type="button" onClick={loadPairedPrinters} disabled={btBusy}>
                  {btBusy ? "Loading..." : "Refresh"}
                </button>
              </div>

              <div className="field-row" style={{ marginTop: 12 }}>
                <button className="btn primary" type="button" onClick={testBluetoothPrint} disabled={btBusy || !btPrinterAddress}>
                  {btBusy ? "Printing..." : "Test Print"}
                </button>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
              On web/Windows, receipts print via the browser print dialog. On the Android app, you can enable direct Bluetooth ESC/POS printing.
            </p>
          )}
        </div>

        {isAdmin ? (
          <div className="card col-12">
            <div className="card-header">
              <h3>Users</h3>
              <button className="btn primary" type="button" onClick={openAddUser}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <PlusIcon className="nav-icon" />
                  Add User
                </span>
              </button>
            </div>

            <div className="field-row" style={{ marginBottom: 12 }}>
              <div className="field" style={{ minWidth: 260, flex: "1 1 320px" }}>
                <label>Search Users</label>
                <input
                  className="input"
                  value={search}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  placeholder="Search by name, username, role, or id..."
                />
              </div>
            </div>

            {usersError ? <div className="banner" style={{ marginBottom: 12 }}>{usersError}</div> : null}

            <div className="table-wrap" aria-label="Users table">
              <table className="table table-plain table-wide">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Discounts</th>
                  <th>Created</th>
                  <th style={{ width: 140 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users === null ? (
                  <tr>
                    <td colSpan={5}>Loading users...</td>
                  </tr>
                ) : filteredUsers.length > 0 ? (
                  filteredUsers.map((u) => {
                    const dt = u.createdAt ? formatDateTimeParts(u.createdAt) : null;
                    return (
                      <tr key={u.id}>
                      <td>
                        <strong style={{ letterSpacing: -0.2 }}>{u.name}</strong>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>
                          {u.username ? `@${u.username}` : "-"}
                          {"  "}#{u.id}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${u.role === "admin" ? "ok" : ""}`}>{u.role}</span>
                      </td>
                      <td>
                        {u.role === "admin" ? (
                          <span className="badge ok">Allowed</span>
                        ) : u.canDiscount ? (
                          <span className="badge ok">Allowed</span>
                        ) : (
                          <span className="badge">Locked</span>
                        )}
                      </td>
                      <td>
                        {dt ? (
                          <>
                            <div className="cell-main">{dt.date}</div>
                            {dt.time ? <div className="cell-sub">{dt.time}</div> : null}
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <span className="row-actions">
                          <button className="icon-btn sm" type="button" onClick={() => openEditUser(u)} aria-label="Edit">
                            <PencilIcon className="nav-icon" />
                          </button>
                          <button
                            className="icon-btn sm"
                            type="button"
                            onClick={() => removeUser(u.id)}
                            aria-label="Delete"
                            disabled={busyId === u.id}
                          >
                            <TrashIcon className="nav-icon" />
                          </button>
                        </span>
                      </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5}>No users found.</td>
                  </tr>
                )}
              </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="card col-12">
            <div className="card-header">
              <h3>Users</h3>
            </div>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
              Only admins can create and manage user accounts.
            </p>
          </div>
        )}

        <div className="card col-12">
          <div className="card-header">
            <h3>Store</h3>
          </div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            Add store profile, tax rates, receipt branding, and roles/permissions here.
          </p>
        </div>
      </div>

      <Modal
        open={userModalOpen}
        title={editingUser ? "Edit User" : "Add User"}
        subtitle="Create staff accounts for cashiers and admins."
        onClose={() => setUserModalOpen(false)}
      >
        <form onSubmit={saveUser}>
          {formError ? <div className="banner" style={{ marginBottom: 12 }}>{formError}</div> : null}

          <div className="field-row">
            <div className="field" style={{ flex: "1 1 240px" }}>
              <label>Name</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Tanya"
                autoFocus
                required
              />
            </div>

            <div className="field" style={{ flex: "1 1 240px" }}>
              <label>Username</label>
              <input
                className="input"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="e.g. tanya"
                autoComplete="username"
                required
              />
            </div>

            <div className="field" style={{ flex: "0 0 200px" }}>
              <label>Role</label>
              <select
                className="input"
                value={form.role}
                onChange={(e) => {
                  const nextRole = e.target.value;
                  setForm((f) => ({
                    ...f,
                    role: nextRole,
                    canDiscount: nextRole === "admin" ? true : Boolean(f.canDiscount),
                  }));
                }}
              >
                <option value="cashier">cashier</option>
                <option value="admin">admin</option>
              </select>
            </div>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>{editingUser ? "New Password (optional)" : "Password"}</label>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={editingUser ? "Leave blank to keep current password" : "At least 6 characters"}
              autoComplete="new-password"
              required={!editingUser}
            />
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>Discount Permission</label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "var(--text-2)",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <input
                type="checkbox"
                checked={form.role === "admin" ? true : Boolean(form.canDiscount)}
                disabled={form.role === "admin"}
                onChange={(e) => setForm((f) => ({ ...f, canDiscount: e.target.checked }))}
              />
              Allow manual price override (discounts) at checkout
            </label>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
              Admins always have this permission. For cashiers, enable it here to allow discounts.
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn ghost" type="button" onClick={() => setUserModalOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
