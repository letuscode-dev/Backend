const db = require("../config/db");

function query(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

function parseId(idRaw) {
  const id = Number.parseInt(String(idRaw), 10);
  return Number.isFinite(id) ? id : null;
}

function normalizeRole(roleRaw) {
  const role = String(roleRaw || "cashier").trim().toLowerCase();
  if (role === "admin" || role === "cashier") return role;
  return null;
}

function normalizeUsername(usernameRaw) {
  const username = String(usernameRaw || "")
    .trim()
    .toLowerCase();
  if (!username) return null;
  if (username.length < 3 || username.length > 40) return null;
  if (!/^[a-z0-9._-]+$/.test(username)) return null;
  return username;
}

exports.getUsers = async (req, res) => {
  try {
    const rows = await query(
      "SELECT id, name, username, role, can_discount AS canDiscount, created_at AS createdAt FROM users ORDER BY id DESC",
      []
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const role = normalizeRole(req.body?.role);
    const canDiscount =
      role === "admin"
        ? 1
        : req.body?.canDiscount === true || req.body?.canDiscount === 1
        ? 1
        : 0;

    if (!name) return res.status(400).json({ error: "Name is required" });
    if (!username) {
      return res.status(400).json({ error: "Username must be 3-40 chars (a-z, 0-9, ., _, -)" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    if (!role) return res.status(400).json({ error: "Role must be admin or cashier" });

    const bcrypt = require("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      "INSERT INTO users (name, username, password_hash, role, can_discount) VALUES (?, ?, ?, ?, ?)",
      [name, username, passwordHash, role, canDiscount]
    );

    return res.status(201).json({
      id: result.insertId,
      name,
      username,
      role,
      canDiscount,
    });
  } catch (err) {
    console.error(err);
    const mysqlDuplicate = err && err.code === "ER_DUP_ENTRY";
    if (mysqlDuplicate) return res.status(409).json({ error: "Username already exists" });
    return res.status(500).json({ error: err.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ error: "Invalid user id" });

    const name = String(req.body?.name || "").trim();
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const role = normalizeRole(req.body?.role);
    const canDiscount =
      role === "admin"
        ? 1
        : req.body?.canDiscount === true || req.body?.canDiscount === 1
        ? 1
        : 0;

    if (!name) return res.status(400).json({ error: "Name is required" });
    if (!username) {
      return res.status(400).json({ error: "Username must be 3-40 chars (a-z, 0-9, ., _, -)" });
    }
    if (!role) return res.status(400).json({ error: "Role must be admin or cashier" });

    const updates = ["name = ?", "username = ?", "role = ?", "can_discount = ?"];
    const params = [name, username, role, canDiscount];

    if (password && password.length >= 6) {
      const bcrypt = require("bcryptjs");
      const passwordHash = await bcrypt.hash(password, 12);
      updates.push("password_hash = ?");
      params.push(passwordHash);
    } else if (password) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    params.push(id);
    const result = await query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ id, name, username, role, canDiscount });
  } catch (err) {
    console.error(err);
    const mysqlDuplicate = err && err.code === "ER_DUP_ENTRY";
    if (mysqlDuplicate) return res.status(409).json({ error: "Username already exists" });
    return res.status(500).json({ error: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return res.status(400).json({ error: "Invalid user id" });

    if (req.user && Number(req.user.id) === Number(id)) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    const result = await query("DELETE FROM users WHERE id = ?", [id]);

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ success: true, id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
