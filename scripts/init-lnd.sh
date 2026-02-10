#!/usr/bin/env bash
# init-lnd.sh — Automatically create LND wallet and configure auto-unlock.
# Run once after first `docker compose up`. Idempotent (skips if wallet exists).
#
# Usage: bash scripts/init-lnd.sh [compose-file] [env-file]
set -euo pipefail

COMPOSE_FILE="${1:-deploy/compose-production.yml}"
ENV_FILE="${2:-.env.local}"
NETWORK="${LND_NETWORK:-signet}"
LND_SERVICE="lnd"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

echo "=== LND wallet initialization ==="

# Check if wallet already exists (macaroon present = wallet created)
if dc exec -T "$LND_SERVICE" test -f "/root/.lnd/data/chain/bitcoin/${NETWORK}/admin.macaroon" 2>/dev/null; then
  echo "Wallet already exists — skipping creation."
  # Ensure auto-unlock is configured
  if dc exec -T "$LND_SERVICE" test -f "/root/.lnd/wallet_password" 2>/dev/null; then
    if ! grep -q "LND_WALLET_PW_FILE" "$ENV_FILE" 2>/dev/null; then
      echo "LND_WALLET_PW_FILE=/root/.lnd/wallet_password" >> "$ENV_FILE"
      echo "  Added LND_WALLET_PW_FILE to $ENV_FILE. Restart LND to enable auto-unlock."
    fi
    echo "Auto-unlock configured. Done."
  else
    echo "Warning: no wallet_password file. LND will require manual unlock on restart."
  fi
  exit 0
fi

# Ensure LND is running (without wallet-unlock-password-file for first boot)
echo "Starting LND for wallet creation..."
# Remove LND_WALLET_PW_FILE if set (so LND starts without it)
if grep -q "LND_WALLET_PW_FILE" "$ENV_FILE" 2>/dev/null; then
  grep -v "LND_WALLET_PW_FILE" "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
fi
dc up -d "$LND_SERVICE"

# Wait for LND RPC to be ready
echo "Waiting for LND to accept RPC..."
for i in $(seq 1 90); do
  STATE=$(dc exec -T "$LND_SERVICE" lncli --network="$NETWORK" state 2>&1 || true)
  if echo "$STATE" | grep -q "NON_EXISTING\|WAITING_TO_START"; then
    echo "  LND ready for wallet creation (attempt $i)."
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "Error: LND did not become ready in time."
    echo "Last output: $STATE"
    exit 1
  fi
  sleep 2
done

# Generate wallet password
WALLET_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)

# Write password file into the LND container volume
dc exec -T "$LND_SERVICE" sh -c "echo '${WALLET_PASS}' > /root/.lnd/wallet_password && chmod 600 /root/.lnd/wallet_password"
echo "  Password file written."

# Create wallet — pipe: password, confirm, no existing seed, no passphrase, confirm empty
echo "Creating wallet..."
SEED_OUTPUT=$(printf '%s\n%s\nn\n\n' "$WALLET_PASS" "$WALLET_PASS" | \
  dc exec -T "$LND_SERVICE" lncli --network="$NETWORK" create 2>&1) || true

echo ""
echo "============================================================"
echo "LND WALLET CREATED"
echo "============================================================"
echo ""
echo "Wallet password: $WALLET_PASS"
echo ""
echo "$SEED_OUTPUT"
echo ""
echo "============================================================"
echo "SAVE THE SEED PHRASE AND PASSWORD ABOVE — NEVER SHARE THEM"
echo "============================================================"

# Enable auto-unlock for future restarts
echo "LND_WALLET_PW_FILE=/root/.lnd/wallet_password" >> "$ENV_FILE"
echo ""
echo "  Auto-unlock enabled in $ENV_FILE"

# Wait for macaroon to appear
echo "Waiting for wallet to initialize..."
for i in $(seq 1 30); do
  if dc exec -T "$LND_SERVICE" test -f "/root/.lnd/data/chain/bitcoin/${NETWORK}/admin.macaroon" 2>/dev/null; then
    echo "  Wallet initialized (macaroon exists)."
    break
  fi
  sleep 2
done

# Restart LND with auto-unlock, then bring up dependent services
echo "Restarting stack with auto-unlock..."
dc up -d

echo ""
echo "=== Done. Stack starting with LND auto-unlock. ==="
echo "  Run: docker compose -f $COMPOSE_FILE logs -f"
