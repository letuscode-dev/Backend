# Database Migrations (T-ONE POS)

This backend uses simple SQL migrations stored in `backend/db/migrations/`.

## Run Migrations

1. Confirm your DB settings in `backend/.env`:
   - Production (recommended): `DATABASE_URL=mysql://USER:PASSWORD@HOST:PORT/DATABASE`
   - Local dev fallback: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (and `DB_PORT` optional)

2. Run:

```powershell
cd backend
npm run migrate
```

This will:
- Create the database if it doesn't exist (local dev fallback mode only).
- Create a `schema_migrations` table.
- Apply any new `*.sql` files in order.

## Check Status

```powershell
cd backend
npm run migrate:status
```

## Create A New Migration

```powershell
cd backend
npm run migrate:make -- add_sales_payment_method
```

Then edit the generated file in `backend/db/migrations/` and run `npm run migrate` again.

## One-Command Fresh Install (New Shop)

```powershell
cd backend
npm run fresh-install
```

This runs migrations and creates the first admin user (if one doesn't already exist). It will also set `ALLOW_BOOTSTRAP=false` in `backend/.env` after an admin exists.

## Notes

- Do not edit migration files after they have been applied. Create a new migration instead.
- The migrator ignores common "already exists" errors (`Duplicate column name`, `Duplicate key name`) so it can patch older DBs.
