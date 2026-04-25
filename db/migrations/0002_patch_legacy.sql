-- 0002_patch_legacy.sql
-- Patch older databases created before auth/discount/cost tracking existed.
-- This file is allowed to be "best effort" (the migrator ignores duplicate column/index errors).

ALTER TABLE users ADD COLUMN username VARCHAR(40) NULL;
ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN can_discount TINYINT(1) NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX uq_users_username ON users (username);

ALTER TABLE products ADD COLUMN cost_price DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0;

