#!/usr/bin/env bash
# init-lnd.sh — Automatically create LND wallet and configure auto-unlock.
# Run once after first `docker compose up`. Idempotent (skips if wallet exists).
#
# Usage: bash scripts/init-lnd.sh [compose-file]
set -euo pipefail

COMPOSE_FILE="${1:-deploy/compose-production.yml}"
ENV_FILE="${2:-.env.local}"
NETWORK="${LND_NETWORK:-signet}"
LND_SERVICE="lnd"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

echo "=== LND wallet initialization ==="

# Check if LND is running
if ! dc ps --format '{{.Name}}' | grep -q "$LND_SERVICE"; then
  echo "Error: LND container not running. Start the stack first."
  exit 1
fi

# Check if wallet already exists (macaroon present = wallet created)
if dc exec -T "$LND_SERVICE" test -f "/root/.lnd/data/chain/bitcoin/${NETWORK}/admin.macaroon" 2>/dev/null; then
  echo "Wallet already exists — skipping creation."
  echo "Checking auto-unlock password file..."
  if dc exec -T "$LND_SERVICE" test -f "/root/.lnd/wallet_password" 2>/dev/null; then
    echo "Auto-unlock configured. Done."
  else
    echo "Warning: no wallet_password file. LND will require manual unlock on restart."
  fi
  exit 0
fi

# Wait for LND RPC to be ready (it serves RPC even without a wallet for create/unlock)
echo "Waiting for LND to be ready..."
for i in $(seq 1 60); do
  if dc exec -T "$LND_SERVICE" lncli --network="$NETWORK" state 2>&1 | grep -q "WAITING_TO_START\|NON_EXISTING\|RPC_ACTIVE\|SERVER_ACTIVE"; then
    echo "  LND ready (attempt $i)."
    break
  fi
  sleep 2
done

# Generate wallet password
WALLET_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
echo "Generated wallet password: $WALLET_PASS"

# Write password file into the LND container volume
dc exec -T "$LND_SERVICE" sh -c "echo '${WALLET_PASS}' > /root/.lnd/wallet_password && chmod 600 /root/.lnd/wallet_password"
echo "  Password file written to /root/.lnd/wallet_password"

# Create wallet via lncli create (pipe inputs: password, confirm, no existing seed, no passphrase)
echo "Creating wallet..."
SEED_OUTPUT=$(printf '%s\n%s\nn\nn\n' "$WALLET_PASS" "$WALLET_PASS" | \
  dc exec -T "$LND_SERVICE" lncli --network="$NETWORK" create 2>&1) || true

echo ""
echo "============================================================"
echo "LND WALLET SEED — SAVE THIS SECURELY, NEVER SHARE"
echo "============================================================"
echo "$SEED_OUTPUT" | grep -A 30 "cipher seed"
echo "============================================================"
echo ""
echo "Wallet password: $WALLET_PASS"
echo ""

# Wait for macaroon to appear (wallet is being initialized)
echo "Waiting for wallet initialization..."
for i in $(seq 1 30); do
  if dc exec -T "$LND_SERVICE" test -f "/root/.lnd/data/chain/bitcoin/${NETWORK}/admin.macaroon" 2>/dev/null; then
    echo "  Wallet ready (macaroon exists)."
    break
  fi
  sleep 2
done

echo ""
echo "=== LND wallet initialized ==="
echo "  Auto-unlock: configured (wallet_password file in LND volume)"
echo "  Next restart: LND will unlock automatically"
echo ""
echo "IMPORTANT: Save the seed phrase and wallet password somewhere safe."
echo "           They are NOT stored in this repo."
