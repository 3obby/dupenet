#!/usr/bin/env bash
# Fund both LND nodes (alice + bob) and open a channel between them.
# Run after docker compose up (once services are healthy).
#
# Usage: ./scripts/fund-lnd.sh [compose-file]
#
# What it does:
#   1. Mine 101 blocks to fund alice (gateway LND)
#   2. Mine 101 blocks to fund bob (client LND)
#   3. Connect bob → alice
#   4. Open a channel bob → alice (1M sats)
#   5. Mine 6 blocks to confirm channel

set -euo pipefail

COMPOSE_FILE="${1:-deploy/compose-founder.yml}"

# Helper: run lncli on a specific LND service
alice() { docker compose -f "$COMPOSE_FILE" exec -T lnd lncli --network=regtest "$@"; }
bob()   { docker compose -f "$COMPOSE_FILE" exec -T lnd-bob lncli --network=regtest "$@"; }
btc()   { docker compose -f "$COMPOSE_FILE" exec -T bitcoind bitcoin-cli -regtest -rpcuser=rpc -rpcpassword=rpc "$@"; }
mine()  { btc generatetoaddress "$1" "$2" >/dev/null; }

echo "═══ funding LND nodes (regtest) ═══"

# ── Wait for both LND nodes ─────────────────────────────────────
for svc in lnd lnd-bob; do
  echo "[1] waiting for $svc..."
  for i in $(seq 1 30); do
    if docker compose -f "$COMPOSE_FILE" exec -T "$svc" lncli --network=regtest getinfo >/dev/null 2>&1; then
      echo "    $svc ready"
      break
    fi
    [ "$i" -eq 30 ] && { echo "ERROR: $svc not ready"; exit 1; }
    sleep 2
  done
done

# ── Fund alice ──────────────────────────────────────────────────
echo "[2] funding alice..."
ALICE_ADDR=$(alice newaddress p2wkh | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).address)")
mine 101 "$ALICE_ADDR"
sleep 2
echo "    alice balance: $(alice walletbalance | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).confirmed_balance)") sats"

# ── Fund bob ────────────────────────────────────────────────────
echo "[3] funding bob..."
BOB_ADDR=$(bob newaddress p2wkh | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).address)")
mine 101 "$BOB_ADDR"
sleep 2
echo "    bob balance: $(bob walletbalance | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).confirmed_balance)") sats"

# ── Connect bob → alice ─────────────────────────────────────────
echo "[4] connecting bob → alice..."
ALICE_PUBKEY=$(alice getinfo | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).identity_pubkey)")
echo "    alice pubkey: ${ALICE_PUBKEY:0:20}..."
bob connect "${ALICE_PUBKEY}@lnd:9735" 2>/dev/null || echo "    (already connected)"

# ── Open channel bob → alice (1M sats) ──────────────────────────
echo "[5] opening channel bob → alice (1000000 sats)..."
CHAN_RESULT=$(bob openchannel --node_key "$ALICE_PUBKEY" --local_amt 1000000 --push_amt 0 2>&1) || true
echo "    $CHAN_RESULT" | head -2

# Mine 6 blocks to confirm the channel
echo "[6] mining 6 blocks to confirm channel..."
mine 6 "$ALICE_ADDR"
sleep 3

# Verify channel is active
echo "[7] checking channel status..."
ACTIVE=$(bob listchannels | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.channels?.length||0))")
echo "    active channels: $ACTIVE"

if [ "$ACTIVE" -ge 1 ]; then
  echo ""
  echo "═══ LND funded + channel open ═══"
  echo "  alice (gateway): funded, receiving"
  echo "  bob (client):    funded, 1M sat channel → alice"
  echo ""
else
  echo ""
  echo "⚠ channel may still be pending — wait and retry"
fi
