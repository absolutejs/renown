#!/usr/bin/env bash
# Manual deploy of Renown to the absolutejs droplet from this machine. Mirrors the
# GitHub Actions pipeline (.github/workflows/deploy.yml) for when you want to ship
# without a push: rsync source → compile on the droplet → atomic swap + smoke +
# auto-rollback. The compiled binary is self-contained (assets embedded); systemd
# runs $APP_DIR/web/compiled-server. Idempotent. Run AFTER bootstrap-droplet.sh.
#
#   DROPLET_IP=159.89.87.74 ENV_FILE=web/.env.prod bash scripts/deploy-droplet.sh
set -euo pipefail

DROPLET_IP="${DROPLET_IP:?set DROPLET_IP}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/absolutejs_droplet}"
SERVICE_USER="${SERVICE_USER:-renown}"
APP_DIR="${APP_DIR:-/srv/$SERVICE_USER}"
APP_SUBDIR="${APP_SUBDIR:-web}"
PORT="${PORT:-3000}"
ENV_FILE="${ENV_FILE:-web/.env.prod}"      # local env shipped as <workdir>/.env
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="$APP_DIR/$APP_SUBDIR"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new root@$DROPLET_IP"

echo "=== rsync working tree → $DROPLET_IP:$APP_DIR ==="
rsync -az \
  --exclude='.git' --exclude='node_modules' --exclude='web/node_modules' \
  --exclude='web/dist' --exclude='web/build' --exclude='.env' --exclude='web/.env' \
  --exclude='web/.env.prod' --exclude='.env.prod' --exclude='.playwright-mcp' --exclude='*.log' \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
  "$REPO_ROOT/" "root@$DROPLET_IP:$APP_DIR/"

echo "=== ship env → $WORKDIR/.env ==="
scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$REPO_ROOT/$ENV_FILE" "root@$DROPLET_IP:$WORKDIR/.env"
$SSH "chown -R $SERVICE_USER:$SERVICE_USER $APP_DIR"

echo "=== install + compile → compiled-server.new (as $SERVICE_USER) ==="
$SSH "sudo -u $SERVICE_USER -H bash -lc 'export PATH=\$HOME/.bun/bin:\$PATH; cd $APP_DIR && bun install && cd $APP_SUBDIR && bun install && bunx absolute compile --outfile $WORKDIR/compiled-server.new && test -f $WORKDIR/compiled-server.new'"

echo "=== atomic swap + smoke + rollback ==="
$SSH "bash -s" <<REMOTE
set -e
cd "$WORKDIR"
TS=\$(date +%Y%m%d-%H%M%S)
[ -f compiled-server ] && cp -a compiled-server "compiled-server.bak-\$TS" || true
systemctl stop $SERVICE_USER
mv compiled-server.new compiled-server
chown $SERVICE_USER:$SERVICE_USER compiled-server && chmod 755 compiled-server
systemctl start $SERVICE_USER && sleep 5
A=\$(systemctl is-active $SERVICE_USER)
C=\$(curl -sS -m 15 -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT || echo 000)
echo "active=\$A  app=\$C"
if [ "\$A" != active ] || [ "\$C" != 200 ]; then
  echo '!!! SMOKE FAILED — rolling back !!!'
  if [ -f "compiled-server.bak-\$TS" ]; then systemctl stop $SERVICE_USER; cp -a "compiled-server.bak-\$TS" compiled-server; systemctl start $SERVICE_USER; sleep 4; fi
  echo "rolled back: active=\$(systemctl is-active $SERVICE_USER)"; exit 1
fi
# Keep the 2 most recent backups; drop the AbsoluteJS /tmp runtime extracts except newest 2.
ls -t compiled-server.bak-* 2>/dev/null | tail -n +3 | xargs -r rm -f
ls -dt /tmp/absolutejs-compiled-runtime-* 2>/dev/null | tail -n +3 | xargs -r rm -rf
echo "deploy ok"
REMOTE
echo "=== done ==="
