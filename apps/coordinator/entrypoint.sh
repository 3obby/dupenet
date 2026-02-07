#!/bin/sh
# Coordinator entrypoint — apply schema then start server.
# Only one coordinator should run db push (avoids race-y startup noise).
set -e

echo "[coordinator] applying Prisma schema (db push)..."
npx prisma db push --skip-generate --schema=apps/coordinator/prisma/schema.prisma 2>&1

echo "[coordinator] schema applied — starting server"
exec node apps/coordinator/dist/server.js
