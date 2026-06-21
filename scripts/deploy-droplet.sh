#!/usr/bin/env bash
# Manual deploy (no push): compile LOCALLY and ship the binary. Mirrors
# .github/workflows/deploy.yml — the droplet only RUNS binaries (`bun --compile`
# OOMs the 1GB box), so we build here and scp the artifact, then atomic-swap with a
# smoke test + auto-rollback. Needs @absolutejs/absolute >= 0.19.0-beta.1077 (the
# compile pre-render free-port fix) installed locally.
#
#   renown:  DROPLET_IP=159.89.87.74 bash scripts/deploy-droplet.sh
#   docs:    DROPLET_IP=159.89.87.74 SERVICE_USER=docs REMOTE_DIR=/srv/docs \
#              LOCAL_SUBDIR=. PORT=3001 bash scripts/deploy-droplet.sh
set -euo pipefail

DROPLET_IP="${DROPLET_IP:?set DROPLET_IP}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/absolutejs_droplet}"
SERVICE_USER="${SERVICE_USER:-renown}"
REMOTE_DIR="${REMOTE_DIR:-/srv/renown/web}"   # where the binary + .env live on the droplet
LOCAL_SUBDIR="${LOCAL_SUBDIR:-web}"           # repo-relative dir to compile in (renown=web, docs=.)
PORT="${PORT:-3000}"                          # local port to smoke-test on the droplet
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$REPO_ROOT/$LOCAL_SUBDIR"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new root@$DROPLET_IP"
export PATH="$HOME/.bun/bin:$PATH"

echo "=== install deps ==="
( cd "$REPO_ROOT" && bun install )
[ "$LOCAL_SUBDIR" != "." ] && ( cd "$APP" && bun install ) || true

echo "=== pull droplet env (bake prod config from the live runtime .env) ==="
TMP_ENV="$(mktemp)"
$SSH "cat $REMOTE_DIR/.env" > "$TMP_ENV"
test -s "$TMP_ENV" || { echo "could not read $REMOTE_DIR/.env"; rm -f "$TMP_ENV"; exit 1; }

echo "=== compile locally (no PORT → absolute picks a free pre-render port) ==="
BIN="$(mktemp -u)/compiled-server"; mkdir -p "$(dirname "$BIN")"
BAK=""                                          # bake prod config: swap the pulled env in as .env
if [ -f "$APP/.env" ]; then BAK="$APP/.env.deploybak.$$"; cp -a "$APP/.env" "$BAK"; fi
cp "$TMP_ENV" "$APP/.env"; rm -f "$TMP_ENV"
trap '[ -n "$BAK" ] && mv -f "$BAK" "$APP/.env" 2>/dev/null || rm -f "$APP/.env" 2>/dev/null; true' EXIT
( cd "$APP" && bunx absolute compile --outfile "$BIN" )
test -f "$BIN" || { echo "compile produced no binary"; exit 1; }

echo "=== ship + atomic swap + smoke + rollback ==="
SHA="$(sha256sum "$BIN" | cut -c1-16)"
$SSH "cd $REMOTE_DIR && rm -f compiled-server.new"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$BIN" "root@$DROPLET_IP:$REMOTE_DIR/compiled-server.new"
rm -rf "$(dirname "$BIN")"
$SSH "SERVICE_USER=$SERVICE_USER REMOTE_DIR=$REMOTE_DIR PORT=$PORT SHA=$SHA bash -s" <<'REMOTE'
set -e
cd "$REMOTE_DIR"
GOT=$(sha256sum compiled-server.new | cut -c1-16)
[ "$GOT" = "$SHA" ] || { echo 'CHECKSUM MISMATCH — aborting'; rm -f compiled-server.new; exit 1; }
TS=$(date +%Y%m%d-%H%M%S)
[ -f compiled-server ] && cp -a compiled-server "compiled-server.bak-$TS" || true
systemctl stop "$SERVICE_USER"
mv compiled-server.new compiled-server
chown "$SERVICE_USER:$SERVICE_USER" compiled-server && chmod 755 compiled-server
systemctl start "$SERVICE_USER" && sleep 5
A=$(systemctl is-active "$SERVICE_USER"); C=$(curl -sS -m15 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT" || echo 000)
echo "active=$A app=$C (backup compiled-server.bak-$TS)"
if [ "$A" != active ] || [ "$C" != 200 ]; then
  echo '!!! SMOKE FAILED — rolling back !!!'
  [ -f "compiled-server.bak-$TS" ] && { systemctl stop "$SERVICE_USER"; cp -a "compiled-server.bak-$TS" compiled-server; systemctl start "$SERVICE_USER"; }
  echo "rolled back: active=$(systemctl is-active "$SERVICE_USER")"; exit 1
fi
{ ls -t compiled-server.bak-* 2>/dev/null | tail -n +3 | xargs -r rm -f; } || true
{ ls -dt /tmp/absolutejs-compiled-runtime-* 2>/dev/null | tail -n +3 | xargs -r rm -rf; } || true
echo "deploy ok"
REMOTE
echo "=== done → $SERVICE_USER ==="
