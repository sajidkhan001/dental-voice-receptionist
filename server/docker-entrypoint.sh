#!/bin/sh
# docker-entrypoint.sh — auto-generate secrets on first boot, run migrations, then start server

set -e

SECRETS_FILE="/app/data/secrets.env"

# Auto-generate ENCRYPTION_KEY and JWT_SECRET on first boot
if [ ! -f "$SECRETS_FILE" ]; then
  echo "[entrypoint] First boot — generating ENCRYPTION_KEY and JWT_SECRET..."
  mkdir -p /app/data
  ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  printf "ENCRYPTION_KEY=%s\nJWT_SECRET=%s\n" "$ENCRYPTION_KEY" "$JWT_SECRET" > "$SECRETS_FILE"
  echo "[entrypoint] Secrets written to $SECRETS_FILE"
fi

# Source generated secrets (override blank env vars with generated values)
. "$SECRETS_FILE"
export ENCRYPTION_KEY
export JWT_SECRET

echo "[entrypoint] Running database migrations..."
npx tsx cli/migrate.ts 2>/dev/null || npx tsx -e "
  const { runMigrations, closePool } = require('./lib/db');
  runMigrations().then(closePool).catch(e => { console.error(e); process.exit(1); });
" || echo "[entrypoint] Migration via tsx failed — will retry at server startup"

echo "[entrypoint] Starting server..."
exec npx tsx index.ts
