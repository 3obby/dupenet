#!/usr/bin/env bash
# deploy.sh — One-shot server setup for founder stack.
# Run on a fresh Ubuntu 24.04 VPS.
# Usage: curl -sSL <raw-url> | bash   OR   scp + bash scripts/deploy.sh
set -euo pipefail

echo "=== ocdn founder stack deployment ==="

# ── 1. System update ─────────────────────────────────────────────
echo "[1/6] Updating system..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# ── 2. Install Docker ────────────────────────────────────────────
echo "[2/6] Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo "  Docker installed. You may need to log out/in for group to take effect."
else
  echo "  Docker already installed."
fi

# Ensure docker compose plugin
if ! docker compose version &>/dev/null; then
  sudo apt-get install -y -qq docker-compose-plugin
fi

# ── 3. Install git ───────────────────────────────────────────────
echo "[3/6] Installing git..."
sudo apt-get install -y -qq git

# ── 4. Clone repo ────────────────────────────────────────────────
echo "[4/6] Cloning repository..."
REPO_DIR="$HOME/ocdn"
if [ -d "$REPO_DIR" ]; then
  echo "  $REPO_DIR already exists, pulling latest..."
  cd "$REPO_DIR" && git pull
else
  git clone https://github.com/dupenet/dupenet.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

# ── 5. Generate keys ────────────────────────────────────────────
echo "[5/6] Generating Ed25519 keys..."
if [ -f .env.local ]; then
  echo "  .env.local already exists, skipping key generation."
else
  bash scripts/gen-keys.sh
  echo "  Keys generated → .env.local"
fi

# ── 6. Configure firewall ───────────────────────────────────────
echo "[6/6] Configuring firewall..."
if command -v ufw &>/dev/null; then
  sudo ufw allow 22/tcp    # SSH
  sudo ufw allow 80/tcp    # HTTP (Caddy redirect)
  sudo ufw allow 443/tcp   # HTTPS (Caddy)
  sudo ufw allow 9735/tcp  # Lightning P2P
  sudo ufw --force enable
  echo "  Firewall enabled: 22, 80, 443, 9735"
else
  echo "  ufw not found, skipping firewall setup."
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env.local — set PG_PASS to something strong"
echo "  2. Point ocdn.is A record → $(curl -s ifconfig.me || echo '<your-ip>')"
echo "  3. Start the stack:"
echo "     docker compose -f deploy/compose-production.yml --env-file .env.local up -d --build"
echo "  4. Create LND wallet (first time only):"
echo "     docker compose -f deploy/compose-production.yml exec lnd lncli --network=signet create"
echo "  5. Verify: curl https://ocdn.is/health"
echo ""
