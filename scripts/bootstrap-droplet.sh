#!/usr/bin/env bash
# Bootstrap an absolutejs droplet to host an AbsoluteJS app behind nginx + Let's Encrypt.
# Idempotent — safe to re-run. Parametrized so the SAME droplet can host multiple apps
# (renown now, docs later): re-run with different DOMAIN/SERVICE_USER/PORT for each.
#
# Run as root on the droplet:
#   DOMAIN=renown.absolutejs.com SERVICE_USER=renown PORT=3000 bash bootstrap-droplet.sh
set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN, e.g. renown.absolutejs.com}"
SERVICE_USER="${SERVICE_USER:?set SERVICE_USER, e.g. renown}"
APP_DIR="${APP_DIR:-/srv/$SERVICE_USER}"
APP_SUBDIR="${APP_SUBDIR:-web}"          # the AbsoluteJS app lives in <repo>/web
PORT="${PORT:-3000}"                      # local port the Bun server listens on
LE_EMAIL="${LE_EMAIL:-l@nagy.vc}"
WORKDIR="$APP_DIR/$APP_SUBDIR"

echo "=== bootstrap $DOMAIN (user=$SERVICE_USER dir=$APP_DIR port=$PORT) ==="

# 1. Base packages (shared across all apps; apt is idempotent)
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg unzip rsync ufw nginx certbot python3-certbot-nginx git build-essential htop

# 2. Swap (1GB droplet builds AbsoluteJS/React — give it headroom so bun build won't OOM)
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 3. Firewall: SSH + HTTP + HTTPS only
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 4. Non-root service user owning this app's dir
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$SERVICE_USER"
fi
mkdir -p "$WORKDIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

# 5. Bun for the service user
sudo -u "$SERVICE_USER" -H bash -lc 'command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash'
BUN="/home/$SERVICE_USER/.bun/bin/bun"

# 6. WebSocket upgrade map (global, written once; harmless to overwrite)
cat >/etc/nginx/conf.d/websocket-map.conf <<'WSMAP'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
WSMAP

# 7. nginx reverse proxy for THIS domain → local Bun port. Long timeouts for SSE
#    (renown's reactive hub pushes leaderboard/unlock events over SSE).
cat >/etc/nginx/sites-available/"$SERVICE_USER" <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 1d;
        proxy_send_timeout 1d;
        proxy_buffering off;
    }
}
NGX
ln -sf /etc/nginx/sites-available/"$SERVICE_USER" /etc/nginx/sites-enabled/"$SERVICE_USER"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# 8. systemd unit: run the compiled standalone binary ($WORKDIR/compiled-server),
#    produced by `absolute compile` and shipped by the deploy (CI or deploy-droplet.sh).
#    Bun auto-loads <workdir>/.env, so secrets live in $WORKDIR/.env (never in git).
#    The binary is absent until the first deploy — the unit just fails-and-retries
#    until then, which is fine (bootstrap only prepares the box).
cat >/etc/systemd/system/"$SERVICE_USER".service <<UNIT
[Unit]
Description=$SERVICE_USER (AbsoluteJS / compiled bun binary)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$WORKDIR
ExecStart=$WORKDIR/compiled-server
Restart=on-failure
RestartSec=3s
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SERVICE_USER"

# 9. TLS — only if $DOMAIN already resolves to THIS box (certbot HTTP-01 needs that).
#    Re-run this script after the DNS A record is live to issue the cert.
MYIP="$(curl -sf https://api.ipify.org || true)"
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ -n "$MYIP" ] && [ "$RESOLVED" = "$MYIP" ]; then
  if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    certbot --nginx --non-interactive --agree-tos -m "$LE_EMAIL" -d "$DOMAIN" --redirect
  else
    echo "cert already present for $DOMAIN"
  fi
else
  echo "!! $DOMAIN resolves to '${RESOLVED:-nothing}', not me ($MYIP) — skipping certbot."
  echo "   Add the DNS A record, then re-run this script to issue the cert."
fi

echo "=== bootstrap done for $DOMAIN ==="
