#!/usr/bin/env bash
# ==============================================================================
# AI ECG Analyzer — Automated Linux VPS Deployment Script
# Target OS: Ubuntu 22.04 / 24.04 LTS or Debian 12
# Usage:
#   ./deploy/scripts/deploy-linux.sh [optional.domain.com]
# ==============================================================================

set -euo pipefail

DOMAIN="${1:-_}"
APP_DIR="/var/www/ecg-ai"
NGINX_CONF="/etc/nginx/sites-available/ecg-ai"

echo "=== [1/6] Installing Node.js 22 LTS, Nginx, Certbot & UFW ==="
sudo apt-get update -y
sudo apt-get install -y curl git nginx ufw certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "=== [2/6] Building production frontend & preparing data directory ==="
cd "$APP_DIR"
if [ ! -f "$APP_DIR/.env" ]; then
    echo "WARNING: $APP_DIR/.env not found! Copying template from .env.production.example..."
    cp "$APP_DIR/.env.production.example" "$APP_DIR/.env"
    echo "Please edit $APP_DIR/.env with your GEMINI_API_KEY, JWT_SECRET, and MIDTRANS keys."
fi

npm ci --include=dev
npm run build

mkdir -p "$APP_DIR/data"
sudo chown -R www-data:www-data "$APP_DIR/data"
sudo chmod 750 "$APP_DIR/data"
if [ -f "$APP_DIR/.env" ]; then
    sudo chown root:www-data "$APP_DIR/.env"
    sudo chmod 640 "$APP_DIR/.env"
fi

echo "=== [3/6] Registering & starting systemd service (ecg-ai.service) ==="
sudo cp deploy/systemd/ecg-ai.service /etc/systemd/system/ecg-ai.service
sudo systemctl daemon-reload
sudo systemctl enable ecg-ai
sudo systemctl restart ecg-ai

echo "=== [4/6] Configuring Nginx reverse proxy ==="
sudo cp deploy/nginx/ecg-ai-linux.conf "$NGINX_CONF"
if [ "$DOMAIN" != "_" ]; then
    sudo sed -i "s/server_name _;/server_name $DOMAIN;/g" "$NGINX_CONF"
fi
sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ecg-ai
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl reload nginx || sudo systemctl restart nginx

echo "=== [5/6] Hardening UFW Firewall ==="
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
# Keep internal Node.js port 3000 isolated from external network
sudo ufw deny 3000/tcp || true
sudo ufw --force enable

echo "=== [6/6] Running Health Smoke Tests ==="
sleep 2
curl -fsS http://127.0.0.1:3000/api/health && echo ""
curl -fsS http://127.0.0.1/api/health && echo ""

echo "=================================================================="
echo "Deployment Completed Successfully!"
if [ "$DOMAIN" != "_" ]; then
    echo "Enable free HTTPS/SSL with Let's Encrypt by running:"
    echo "  sudo certbot --nginx -d $DOMAIN --redirect"
else
    echo "To enable HTTPS/SSL with a domain later, update server_name in"
    echo "$NGINX_CONF and run: sudo certbot --nginx -d yourdomain.com --redirect"
fi
echo "=================================================================="
