#!/usr/bin/env bash
# One-command domain move: demo.chatrix.vip -> matgari.app.
#
# It creates the new matgari.app deployment when it is missing, then copies
# the old deployment's database and media into it. The old website keeps its
# own data and stays online, so nothing is deleted or renamed.
#
# Prerequisites (panel/account steps a script must not guess):
#   - DNS: an A record for matgari.app points at this VPS.
#   - CloudPanel: website matgari.app exists with site user matgari and a
#     working Let's Encrypt certificate.
#   - Google Auth Platform: https://matgari.app is an authorized JavaScript
#     origin for the web client you enter in the wizard.
#
# Usage on the VPS:
#   sudo bash move-to-matgari-app.sh
#
# Keep setup-vps.sh, deploy-matgari-app.sh, and migrate-matgari-app.sh in the
# same directory as this file.
set +x
set -Eeuo pipefail
umask 077

OLD_DOMAIN='demo.chatrix.vip'
TARGET_DOMAIN='matgari.app'
STATE_ROOT='/var/lib/matjary-setup'
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
env_get() {
  [[ -f "$1" ]] || return 0
  awk -v key="$2" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$1"
}
origin_domain() {
  local value=$1
  value=${value#https://}; value=${value#http://}
  printf '%s' "${value%%/*}"
}
state_env() {
  local file domain
  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    domain=$(env_get "$file" SETUP_DOMAIN)
    [[ -n "$domain" ]] || domain=$(origin_domain "$(env_get "$file" APP_ORIGIN)")
    [[ "$domain" != "$1" ]] || { printf '%s' "$file"; return 0; }
  done < <(find "$STATE_ROOT" -mindepth 2 -maxdepth 2 -name production.env -type f 2>/dev/null)
  return 0
}
pick_port() {
  local port
  for port in $(seq 3100 3199); do
    # Never reuse the old deployment's port: it is restarted after the copy
    # even when it happens to be stopped right now.
    [[ "$OLD_RESERVED_PORTS" != *" $port "* ]] || continue
    if ! ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .; then
      printf '%s' "$port"
      return 0
    fi
  done
  return 1
}

[[ $(uname -s) == Linux ]] || die 'Run this on the Linux VPS, not Windows.'
(( EUID == 0 )) || die "Run with sudo bash $0"
[[ -t 0 ]] || die 'An interactive terminal is required.'
command -v docker python3 ss >/dev/null 2>&1 || die 'Docker, Python 3, and iproute2 (ss) are required.'
for script in setup-vps.sh deploy-matgari-app.sh migrate-matgari-app.sh; do
  [[ -f "$SCRIPT_DIR/$script" && ! -L "$SCRIPT_DIR/$script" ]] || die "Missing $script next to this file in $SCRIPT_DIR."
done

# Refuse to start unless the target website already exists in the panel: that
# is what provides the HTTPS vhost, certificate, and document root.
if [[ ! -f "/etc/nginx/sites-enabled/$TARGET_DOMAIN.conf" ]] \
  && ! grep -Rqs "server_name.*$TARGET_DOMAIN" /etc/nginx/sites-enabled 2>/dev/null; then
  die "Create the CloudPanel website $TARGET_DOMAIN first (site user matgari, Static Site, document root /home/matgari/htdocs/$TARGET_DOMAIN), issue its Let's Encrypt certificate, point DNS at this VPS, then rerun this command."
fi

# Find the old deployment: installer-managed state first, then the layout the
# GitHub deployment workflow uses (/opt/matjary/backend/.env + Compose project).
MODE=''
OLD_ENV=$(state_env "$OLD_DOMAIN")
OLD_PROJECT=''
if [[ -n "$OLD_ENV" ]]; then
  MODE=installer
  OLD_PROJECT=$(env_get "$OLD_ENV" SETUP_PROJECT)
  [[ -n "$OLD_PROJECT" ]] || OLD_PROJECT="matjary-$(printf '%s' "$OLD_DOMAIN" | sha256sum | cut -c1-12)"
else
  ci_env='/opt/matjary/backend/.env'
  [[ -f "$ci_env" && ! -L "$ci_env" ]] || die "No saved deployment for $OLD_DOMAIN was found (neither $STATE_ROOT state nor $ci_env). Inspect with: find $STATE_ROOT -name production.env -exec grep -H '^SETUP_DOMAIN=' {} \\;"
  [[ "$(origin_domain "$(env_get "$ci_env" APP_ORIGIN)")" == "$OLD_DOMAIN" ]] \
    || die "Neither the saved deployments nor $ci_env describe $OLD_DOMAIN. Inspect the old site's domain before migrating."
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    origin=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null | sed -n 's/^APP_ORIGIN=//p' | head -n1 || true)
    [[ "$(origin_domain "$origin")" == "$OLD_DOMAIN" ]] || continue
    OLD_PROJECT=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$container")
    [[ -z "$OLD_PROJECT" ]] || break
  done < <(docker ps -aq --filter label=com.docker.compose.service=api)
  [[ -n "$OLD_PROJECT" ]] || die "Found $ci_env but no running or stopped API container whose APP_ORIGIN is $OLD_DOMAIN."
  OLD_ENV=$ci_env
  MODE=ci
fi
docker volume inspect "${OLD_PROJECT}_media-data" >/dev/null 2>&1 \
  || die "The old media volume ${OLD_PROJECT}_media-data is missing; inspect the old deployment before migrating."
OLD_API_CONTAINER=$(docker ps -aq \
  --filter "label=com.docker.compose.project=$OLD_PROJECT" \
  --filter label=com.docker.compose.service=api | head -n1)
OLD_CONTAINER_PORT=''
[[ -z "$OLD_API_CONTAINER" ]] || OLD_CONTAINER_PORT=$(docker inspect -f \
  '{{with (index .HostConfig.PortBindings "3000/tcp")}}{{range .}}{{.HostPort}}{{end}}{{end}}' \
  "$OLD_API_CONTAINER" 2>/dev/null || true)
OLD_RESERVED_PORTS=" $(env_get "$OLD_ENV" API_PORT) $OLD_CONTAINER_PORT "

printf '\nMoving data\n  From: %s (project %s)\n  To:   %s\n' "$OLD_DOMAIN" "$OLD_PROJECT" "$TARGET_DOMAIN"

# Create matgari.app only when it does not exist yet. setup-vps.sh prompts for
# the Google client ID and administrator email; reuse the old values printed
# below after adding the new origin in Google Auth Platform.
TARGET_ENV=$(state_env "$TARGET_DOMAIN")
if [[ -z "$TARGET_ENV" ]]; then
  printf '\nA free API port will be chosen automatically so the old site keeps running.\n'
  NEW_PORT=$(pick_port) || die 'No free API port was found between 3100 and 3199.'
  printf 'Reuse these wizard answers:\n'
  printf '  Google client ID: %s\n' "$(env_get "$OLD_ENV" GOOGLE_CLIENT_ID)"
  printf '  Admin email:      %s\n' "$(env_get "$OLD_ENV" ADMIN_EMAILS)"
  printf '  API port:         %s (already selected)\n' "$NEW_PORT"
  bash "$SCRIPT_DIR/deploy-matgari-app.sh" --port "$NEW_PORT"
  TARGET_ENV=$(state_env "$TARGET_DOMAIN")
  [[ -n "$TARGET_ENV" ]] || die 'The matgari.app setup did not save its deployment; review the output above before retrying.'
else
  printf '\nmatgari.app is already deployed; skipping the setup step.\n'
fi

printf '\nCopying the old database and media into matgari.app...\n'
if [[ "$MODE" == installer ]]; then
  bash "$SCRIPT_DIR/migrate-matgari-app.sh" --from-domain "$OLD_DOMAIN"
else
  bash "$SCRIPT_DIR/migrate-matgari-app.sh" --from-env "$OLD_ENV" --from-project "$OLD_PROJECT"
fi

NEW_PROJECT=$(env_get "$TARGET_ENV" SETUP_PROJECT)
[[ -n "$NEW_PROJECT" ]] || NEW_PROJECT="matjary-$(printf '%s' "$TARGET_DOMAIN" | sha256sum | cut -c1-12)"
printf '\nDomain move finished.\n'
printf '  New site: https://%s\n' "$TARGET_DOMAIN"
printf '  Old site: https://%s (unchanged, still running)\n' "$OLD_DOMAIN"
target_vhost="/etc/nginx/sites-enabled/$TARGET_DOMAIN.conf"
if [[ ! -f "$target_vhost" ]]; then
  target_vhost=$(grep -Rls "server_name.*$TARGET_DOMAIN" /etc/nginx/sites-enabled 2>/dev/null | head -n1 || true)
fi
if [[ -z "$target_vhost" ]] || ! grep -q 'api/v1/uploads/' "$target_vhost" 2>/dev/null; then
  printf '\nFINAL NGINX STEP: paste the locations from\n  %s/%s/cloudpanel.locations.conf\n' "$STATE_ROOT" "$NEW_PROJECT"
  printf 'into the %s HTTPS vhost in CloudPanel, then save and reload Nginx.\n' "$TARGET_DOMAIN"
fi
printf '\nVerify: sign in at https://%s/api/v1/auth/login, open a shop and a post,\n' "$TARGET_DOMAIN"
printf 'and load uploaded photos and videos. Add https://%s to the Google client origins if login is refused.\n' "$TARGET_DOMAIN"
