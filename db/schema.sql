-- T-ONE POS schema helpers (MySQL)
-- Prefer `cd backend && npm run migrate` (see backend/db/MIGRATIONS.md).
-- This file is a snapshot you can still run manually in phpMyAdmin if needed.

-- If you used a different DB name, change it here to match `backend/.env` (DB_NAME).
CREATE DATABASE IF NOT EXISTS boutique_pos;
USE boutique_pos;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  cost_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  username VARCHAR(40) NULL,
  password_hash VARCHAR(255) NULL,
  role ENUM('admin','cashier') NOT NULL DEFAULT 'cashier',
  can_discount TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  refresh_token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL DEFAULT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL DEFAULT NULL,
  user_agent VARCHAR(255) NULL,
  ip VARCHAR(45) NULL,
  UNIQUE KEY uq_auth_sessions_refresh_hash (refresh_token_hash),
  KEY idx_auth_sessions_user_id (user_id),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cashier_id INT NULL,
  customer_name VARCHAR(255) NULL,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  client_sale_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sales_client_sale_id (client_sale_id),
  CONSTRAINT fk_sales_cashier FOREIGN KEY (cashier_id) REFERENCES users(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id INT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  qty INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id) REFERENCES sales(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_name VARCHAR(255) NULL,
  status ENUM('draft','received','cancelled') NOT NULL DEFAULT 'draft',
  note VARCHAR(500) NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  qty INT NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_purchase_items_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stocktake_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  note VARCHAR(500) NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_by INT NULL,
  closed_at TIMESTAMP NULL DEFAULT NULL,
  from_at DATETIME NULL,
  to_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS stocktake_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  expected_stock INT NOT NULL DEFAULT 0,
  counted_stock INT NULL,
  snapshot_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  snapshot_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stocktake_item (session_id, product_id),
  CONSTRAINT fk_stocktake_items_session FOREIGN KEY (session_id) REFERENCES stocktake_sessions(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shifts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cashier_id INT NOT NULL,
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL DEFAULT NULL,
  opening_float DECIMAL(10,2) NOT NULL DEFAULT 0,
  closing_cash DECIMAL(10,2) NULL,
  sales_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  expected_cash DECIMAL(10,2) NOT NULL DEFAULT 0,
  variance DECIMAL(10,2) NULL
);

-- Optional indexes (run once):
-- CREATE INDEX idx_sales_created_at ON sales(created_at);
-- CREATE INDEX idx_sale_items_sale_id ON sale_items(sale_id);
-- CREATE INDEX idx_purchase_created_at ON purchases(created_at);
-- CREATE INDEX idx_purchase_items_purchase_id ON purchase_items(purchase_id);
-- CREATE INDEX idx_stocktake_sessions_created_at ON stocktake_sessions(created_at);
-- CREATE INDEX idx_stocktake_items_session_id ON stocktake_items(session_id);
-- CREATE INDEX idx_shifts_cashier_id ON shifts(cashier_id);

-- If you created tables before adding `can_discount`, run this once:
-- ALTER TABLE users ADD COLUMN can_discount TINYINT(1) NOT NULL DEFAULT 0;

-- If you created tables before adding auth, run these once:
-- ALTER TABLE users ADD COLUMN username VARCHAR(40) NULL;
-- ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL;
-- CREATE UNIQUE INDEX uq_users_username ON users (username);
-- CREATE TABLE auth_sessions (
--   id INT AUTO_INCREMENT PRIMARY KEY,
--   user_id INT NOT NULL,
--   refresh_token_hash CHAR(64) NOT NULL,
--   created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   last_used_at TIMESTAMP NULL DEFAULT NULL,
--   expires_at DATETIME NOT NULL,
--   revoked_at DATETIME NULL DEFAULT NULL,
--   user_agent VARCHAR(255) NULL,
--   ip VARCHAR(45) NULL,
--   UNIQUE KEY uq_auth_sessions_refresh_hash (refresh_token_hash),
--   KEY idx_auth_sessions_user_id (user_id),
--   CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
--     ON UPDATE CASCADE
--     ON DELETE CASCADE
-- );

-- If you created tables before adding cost tracking, run these once:
-- ALTER TABLE products ADD COLUMN cost_price DECIMAL(10,2) NOT NULL DEFAULT 0;
-- ALTER TABLE sale_items ADD COLUMN unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Optional backfill (approximate): apply current product cost to old sale lines that have 0 unit_cost.
-- UPDATE sale_items si
-- JOIN products p ON p.id = si.product_id
-- SET si.unit_cost = p.cost_price
-- WHERE si.unit_cost = 0;
