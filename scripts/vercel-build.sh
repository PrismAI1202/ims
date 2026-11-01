#!/usr/bin/env bash
# Vercel build: generate the Prisma client, apply pending migrations on production deploys, then build the app.
# Migrations use a direct (non-pooled) connection because they take locks that a transaction pooler can break.
set -euo pipefail

npx prisma generate

if [ "${VERCEL_ENV:-}" = "production" ] || [ "${RUN_MIGRATIONS:-}" = "1" ]; then
  echo "Applying database migrations…"
  DATABASE_URL="${DATABASE_URL_UNPOOLED:-${DIRECT_URL:-$DATABASE_URL}}" npx prisma migrate deploy
else
  echo "Skipping migrations (VERCEL_ENV=${VERCEL_ENV:-unset}). Set RUN_MIGRATIONS=1 on a preview that has its own database."
fi

npx next build
