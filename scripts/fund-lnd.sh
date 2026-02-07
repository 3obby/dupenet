#!/usr/bin/env bash
# Fund the regtest LND wallet.
# Run after docker compose up (once services are healthy).
#
# Usage: ./scripts/fund-lnd.sh
#
# What it does:
#   1. Create LND wallet (if needed — noseedbackup mode auto-creates)
#   2. Get a new LND address
#   3. Mine 101 blocks to that address (coinbase maturity)
#   4. Print LND balance

set -euo pipefail

COMPOSE_FILE="${1:-deploy/compose-founder.yml}"

echo "── funding LND on regtest ──"

# Wait for LND to be ready
echo "[1/4] waiting for LND..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T lnd lncli --network=regtest getinfo >/dev/null 2>&1; then
    echo "       LND ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: LND not ready after 30 attempts"
    exit 1
  fi
  sleep 2
done

# Get a new address from LND
echo "[2/4] generating LND address..."
ADDR=$(docker compose -f "$COMPOSE_FILE" exec -T lnd lncli --network=regtest newaddress p2wkh | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).address)")
echo "       address: $ADDR"

# Mine 101 blocks to that address (coinbase maturity = 100 blocks)
echo "[3/4] mining 101 blocks..."
docker compose -f "$COMPOSE_FILE" exec -T bitcoind bitcoin-cli \
  -regtest -rpcuser=rpc -rpcpassword=rpc \
  generatetoaddress 101 "$ADDR" >/dev/null

# Give LND a moment to sync the blocks
sleep 3

# Check balance
echo "[4/4] checking LND balance..."
BALANCE=$(docker compose -f "$COMPOSE_FILE" exec -T lnd lncli --network=regtest walletbalance)
echo "$BALANCE"

echo ""
echo "── LND funded and ready ──"
