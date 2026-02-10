#!/usr/bin/env bash
# init-lnd.sh — Automatically create LND wallet via REST API + configure auto-unlock.
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
  if ! grep -q "LND_WALLET_PW_FILE" "$ENV_FILE" 2>/dev/null; then
    if dc exec -T "$LND_SERVICE" test -f "/root/.lnd/wallet_password" 2>/dev/null; then
      echo "LND_WALLET_PW_FILE=/root/.lnd/wallet_password" >> "$ENV_FILE"
      echo "  Added LND_WALLET_PW_FILE to $ENV_FILE."
    fi
  fi
  echo "Done."
  exit 0
fi

# Ensure LND is running without wallet-unlock-password-file
echo "Starting LND for wallet creation..."
grep -v "LND_WALLET_PW_FILE" "$ENV_FILE" > "${ENV_FILE}.tmp" 2>/dev/null && mv "${ENV_FILE}.tmp" "$ENV_FILE" || true
dc up -d "$LND_SERVICE"

# Wait for LND REST API to be reachable (it serves /v1/state even without wallet)
echo "Waiting for LND REST API..."
for i in $(seq 1 90); do
  STATE=$(dc exec -T "$LND_SERVICE" \
    wget -q -O - --no-check-certificate https://localhost:8080/v1/state 2>/dev/null || true)
  if echo "$STATE" | grep -q "NON_EXISTING\|WAITING"; then
    echo "  LND REST API ready (attempt $i)."
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "Error: LND REST API did not become ready."
    echo "  Last: $STATE"
    dc logs --tail=10 "$LND_SERVICE"
    exit 1
  fi
  sleep 2
done

# Generate wallet password
WALLET_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
WALLET_PASS_B64=$(echo -n "$WALLET_PASS" | base64)

# Create wallet via REST API (POST /v1/genseed then POST /v1/initwallet)
echo "Generating seed..."
SEED_RESP=$(dc exec -T "$LND_SERVICE" \
  wget -q -O - --no-check-certificate --post-data='{}' \
  https://localhost:8080/v1/genseed 2>/dev/null)

# Extract mnemonic words from JSON
MNEMONIC=$(echo "$SEED_RESP" | grep -o '"cipher_seed_mnemonic":\[[^]]*\]' | \
  sed 's/"cipher_seed_mnemonic":\[//;s/\]//;s/"//g;s/,/ /g')

if [ -z "$MNEMONIC" ]; then
  echo "Error: Failed to generate seed."
  echo "Response: $SEED_RESP"
  exit 1
fi

# Build JSON array from mnemonic
MNEMONIC_JSON=$(echo "$SEED_RESP" | grep -o '"cipher_seed_mnemonic":\[[^]]*\]' | \
  sed 's/"cipher_seed_mnemonic"://')

echo "Creating wallet..."
INIT_RESP=$(dc exec -T "$LND_SERVICE" \
  wget -q -O - --no-check-certificate \
  --header='Content-Type: application/json' \
  --post-data="{\"wallet_password\":\"${WALLET_PASS_B64}\",\"cipher_seed_mnemonic\":${MNEMONIC_JSON}}" \
  https://localhost:8080/v1/initwallet 2>/dev/null) || true

# Write password file into LND volume
dc exec -T "$LND_SERVICE" sh -c "echo '${WALLET_PASS}' > /root/.lnd/wallet_password && chmod 600 /root/.lnd/wallet_password"

echo ""
echo "============================================================"
echo "LND WALLET CREATED — SAVE THIS SECURELY"
echo "============================================================"
echo ""
echo "Wallet password: $WALLET_PASS"
echo ""
echo "Seed phrase:"
echo "  $MNEMONIC"
echo ""
echo "============================================================"

# Wait for macaroon
echo "Waiting for wallet to initialize..."
for i in $(seq 1 30); do
  if dc exec -T "$LND_SERVICE" test -f "/root/.lnd/data/chain/bitcoin/${NETWORK}/admin.macaroon" 2>/dev/null; then
    echo "  Wallet initialized."
    break
  fi
  sleep 2
done

# Enable auto-unlock for future restarts
echo "LND_WALLET_PW_FILE=/root/.lnd/wallet_password" >> "$ENV_FILE"

# Restart full stack with auto-unlock
echo "Restarting stack with auto-unlock..."
dc up -d

echo ""
echo "=== Done ==="
echo "  LND wallet created with auto-unlock."
echo "  SAVE the seed phrase and password above."
