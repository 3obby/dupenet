#!/usr/bin/env bash
# backup.sh — Postgres dump + LND static channel backup.
# Run via cron: 0 */6 * * * /home/ocdn/ocdn/scripts/backup.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
COMPOSE_FILE="${COMPOSE_FILE:-$HOME/ocdn/deploy/compose-production.yml}"
KEEP_DAYS="${KEEP_DAYS:-14}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."

# ── Postgres dump ────────────────────────────────────────────────
PG_FILE="$BACKUP_DIR/pg_${TIMESTAMP}.sql.gz"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${PG_USER:-ocdn}" "${PG_DB:-ocdn}" \
  | gzip > "$PG_FILE"
echo "  Postgres → $PG_FILE ($(du -h "$PG_FILE" | cut -f1))"

# ── LND Static Channel Backup (SCB) ─────────────────────────────
SCB_FILE="$BACKUP_DIR/lnd_scb_${TIMESTAMP}.bak"
docker compose -f "$COMPOSE_FILE" exec -T lnd \
  lncli --network=signet exportchanbackup --all \
  > "$SCB_FILE" 2>/dev/null || echo "  Warning: LND SCB export failed (no channels?)"
if [ -s "$SCB_FILE" ]; then
  echo "  LND SCB → $SCB_FILE"
else
  rm -f "$SCB_FILE"
  echo "  LND SCB skipped (empty/no channels)"
fi

# ── LND wallet backup (tls.cert + admin.macaroon) ───────────────
LND_CREDS="$BACKUP_DIR/lnd_creds_${TIMESTAMP}.tar.gz"
docker compose -f "$COMPOSE_FILE" exec -T lnd \
  tar czf - /root/.lnd/tls.cert /root/.lnd/data/chain/bitcoin/signet/admin.macaroon \
  > "$LND_CREDS" 2>/dev/null || echo "  Warning: LND creds backup failed"
if [ -s "$LND_CREDS" ]; then
  echo "  LND creds → $LND_CREDS"
else
  rm -f "$LND_CREDS"
fi

# ── Prune old backups ───────────────────────────────────────────
PRUNED=$(find "$BACKUP_DIR" -name "*.gz" -o -name "*.bak" | \
  xargs ls -t 2>/dev/null | tail -n +$((KEEP_DAYS * 4 + 1)) | wc -l)
find "$BACKUP_DIR" -name "*.gz" -mtime +$KEEP_DAYS -delete
find "$BACKUP_DIR" -name "*.bak" -mtime +$KEEP_DAYS -delete
echo "  Pruned backups older than ${KEEP_DAYS} days"

echo "[$(date)] Backup complete."
