#!/usr/bin/env bash
# monitor.sh — Lightweight monitoring for dupenet founder/host stacks.
# Checks: service health, LND balance, disk usage.
# Returns exit 0 = healthy, exit 1 = degraded (with details on stdout).
#
# Usage:
#   ./scripts/monitor.sh                    # check https://ocdn.is
#   ENDPOINT=http://localhost:3102 ./scripts/monitor.sh  # local dev
#
# Cron example (every 5 min, alert on failure):
#   */5 * * * * /home/ocdn/ocdn/scripts/monitor.sh >> /home/ocdn/logs/monitor.log 2>&1 || echo "ALERT: dupenet degraded" | mail -s "dupenet alert" ops@example.com
#
set -euo pipefail

ENDPOINT="${ENDPOINT:-https://ocdn.is}"
DISK_WARN_PCT="${DISK_WARN_PCT:-85}"
LND_MIN_SATS="${LND_MIN_SATS:-10000}"
TIMEOUT="${TIMEOUT:-10}"

ISSUES=()
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[$TS] dupenet monitor — $ENDPOINT"

# ── 1. Gateway health ──────────────────────────────────────────
GW_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$ENDPOINT/health" 2>/dev/null || echo "000")
if [ "$GW_STATUS" = "200" ]; then
  echo "  gateway:     OK"
else
  echo "  gateway:     FAIL (HTTP $GW_STATUS)"
  ISSUES+=("gateway_down")
fi

# ── 2. Coordinator health ─────────────────────────────────────
# /status is on coordinator via Caddy — gives deep health info
STATUS_JSON=$(curl -sf --max-time "$TIMEOUT" "$ENDPOINT/status" 2>/dev/null || echo "")
if [ -n "$STATUS_JSON" ]; then
  echo "  coordinator: OK"

  # Parse key fields (jq-free: use grep/sed for minimal deps)
  UPTIME=$(echo "$STATUS_JSON" | grep -o '"uptime_human":"[^"]*"' | head -1 | cut -d'"' -f4)
  EPOCH=$(echo "$STATUS_JSON" | grep -o '"current":[0-9]*' | head -1 | cut -d: -f2)
  EVENTS=$(echo "$STATUS_JSON" | grep -o '"events":[0-9]*' | head -1 | cut -d: -f2)
  TOTAL_HOSTS=$(echo "$STATUS_JSON" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)
  POOL_BALANCE=$(echo "$STATUS_JSON" | grep -o '"total_balance_sats":[0-9]*' | head -1 | cut -d: -f2)
  BEHIND=$(echo "$STATUS_JSON" | grep -o '"behind":[0-9]*' | head -1 | cut -d: -f2)

  echo "  uptime:      ${UPTIME:-?}"
  echo "  epoch:       ${EPOCH:-?} (behind: ${BEHIND:-0})"
  echo "  events:      ${EVENTS:-?}"
  echo "  hosts:       ${TOTAL_HOSTS:-0}"
  echo "  pool_total:  ${POOL_BALANCE:-0} sats"

  # Check epoch settlement lag
  if [ -n "$BEHIND" ] && [ "$BEHIND" -gt 2 ] 2>/dev/null; then
    echo "  WARNING: epoch settlement lagging by $BEHIND epochs"
    ISSUES+=("epoch_lag_$BEHIND")
  fi

  # ── 3. LND balance ────────────────────────────────────────────
  LND_STATUS=$(echo "$STATUS_JSON" | grep -o '"status":"[^"]*"' | tail -1 | cut -d'"' -f4)
  if [ "$LND_STATUS" = "ok" ]; then
    ONCHAIN=$(echo "$STATUS_JSON" | grep -o '"onchain_confirmed_sats":[0-9]*' | head -1 | cut -d: -f2)
    CHANNEL_LOCAL=$(echo "$STATUS_JSON" | grep -o '"channel_local_sats":[0-9]*' | head -1 | cut -d: -f2)
    ACTIVE_CHANNELS=$(echo "$STATUS_JSON" | grep -o '"active_channels":[0-9]*' | head -1 | cut -d: -f2)
    TOTAL_SATS=$(( ${ONCHAIN:-0} + ${CHANNEL_LOCAL:-0} ))
    echo "  lnd:         OK (onchain=${ONCHAIN:-0}, channels=${CHANNEL_LOCAL:-0}, active=${ACTIVE_CHANNELS:-0})"

    if [ "$TOTAL_SATS" -lt "$LND_MIN_SATS" ] 2>/dev/null; then
      echo "  WARNING: LND balance low (${TOTAL_SATS} < ${LND_MIN_SATS})"
      ISSUES+=("lnd_low_balance")
    fi
  elif [ "$LND_STATUS" = "not_configured" ]; then
    echo "  lnd:         not configured (dev mode)"
  else
    echo "  lnd:         DEGRADED ($LND_STATUS)"
    ISSUES+=("lnd_degraded")
  fi
else
  echo "  coordinator: FAIL (no /status response)"
  ISSUES+=("coordinator_down")
fi

# ── 4. Disk usage ──────────────────────────────────────────────
# Works on both macOS and Linux
DISK_PCT=$(df -P / | tail -1 | awk '{print $5}' | tr -d '%')
if [ -n "$DISK_PCT" ]; then
  echo "  disk:        ${DISK_PCT}% used"
  if [ "$DISK_PCT" -ge "$DISK_WARN_PCT" ] 2>/dev/null; then
    echo "  WARNING: disk usage high (${DISK_PCT}% >= ${DISK_WARN_PCT}%)"
    ISSUES+=("disk_high")
  fi
fi

# ── 5. Docker containers (if running on host) ─────────────────
if command -v docker &>/dev/null; then
  COMPOSE_FILE="${COMPOSE_FILE:-$HOME/ocdn/deploy/compose-production.yml}"
  if [ -f "$COMPOSE_FILE" ]; then
    UNHEALTHY=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null | grep -c '"unhealthy"\|"exited"' || true)
    RUNNING=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null | grep -c '"running"\|"healthy"' || true)
    echo "  containers:  ${RUNNING} running, ${UNHEALTHY} unhealthy"
    if [ "$UNHEALTHY" -gt 0 ] 2>/dev/null; then
      ISSUES+=("containers_unhealthy")
    fi
  fi
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
if [ ${#ISSUES[@]} -eq 0 ]; then
  echo "[$TS] STATUS: HEALTHY"
  exit 0
else
  echo "[$TS] STATUS: DEGRADED — issues: ${ISSUES[*]}"
  exit 1
fi
