#!/usr/bin/env bash
# Copy an existing installer-managed deployment's database and media volume
# into the new matgari.app deployment created by deploy-matgari-app.sh.
#
# Run on the Linux VPS as root, after deploy-matgari-app.sh completed:
#   sudo bash migrate-matgari-app.sh
#   sudo bash migrate-matgari-app.sh --from-domain old.example.com
# For a site deployed by the GitHub workflow (no saved setup state), pass its
# environment file and Compose project instead:
#   sudo bash migrate-matgari-app.sh --from-env /opt/matjary/backend/.env --from-project <project>
#
# The old website's database and media volume are only read, never modified.
# The matgari.app database and media volume are replaced with the copies.
set +x
set -Eeuo pipefail
umask 077

TARGET_DOMAIN='matgari.app'
STATE_ROOT='/var/lib/matjary-setup'
FROM_DOMAIN=''
FROM_ENV=''
FROM_PROJECT=''
FROM_DB=''
DUMP=''
FINISHED=0
TARGET_TOUCHED=0
STOPPED_OLD=()

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
confirm() {
  local answer
  printf '\n%s\n' "$1"
  read -r -p "Type $2 to continue: " answer
  [[ "$answer" == "$2" ]] || die 'Canceled; confirmation did not match.'
}
env_get() {
  [[ -f "$1" ]] || return 0
  awk -v key="$2" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$1"
}
project_of() {
  printf 'matjary-%s' "$(printf '%s' "$1" | sha256sum | cut -c1-12)"
}
compose_project_env() {
  local value
  value=$(env_get "$1" SETUP_PROJECT)
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    project_of "$2"
  fi
}
container_of() {
  local flags=(-q)
  [[ ${3:-} != all ]] || flags=(-a -q)
  docker ps "${flags[@]}" \
    --filter "label=com.docker.compose.project=$1" \
    --filter "label=com.docker.compose.service=$2"
}
stop_old_service() {
  local id
  id=$(container_of "$OLD_PROJECT" "$1")
  [[ -z "$id" ]] || { docker stop --time 60 "$id" >/dev/null; STOPPED_OLD+=("$id"); printf 'Stopped old %s.\n' "$1"; }
}

# Restore the old website whenever this script exits before finishing. `die`
# uses exit, which does not raise ERR, so cleanup must hang off EXIT.
on_exit() {
  local status=$?
  trap - EXIT
  if (( FINISHED == 0 )); then
    printf '\nMigration stopped. matgari.app stays offline and may be incomplete; the old website was not deleted.\n' >&2
    [[ -z "$DUMP" || ! -f "$DUMP" ]] || printf 'Database dump kept at %s\n' "$DUMP" >&2
    if (( TARGET_TOUCHED == 1 )); then
      dc_new stop api worker >/dev/null 2>&1 || true
    fi
    local id
    for id in "${STOPPED_OLD[@]+"${STOPPED_OLD[@]}"}"; do
      docker start "$id" >/dev/null 2>&1 || true
    done
  fi
  exit "$status"
}
trap on_exit EXIT

while (( $# )); do
  case "$1" in
    --from-domain) (( $# >= 2 )) && [[ -n "$2" ]] || die 'Missing value for --from-domain'; FROM_DOMAIN=${2,,}; shift 2 ;;
    --from-env) (( $# >= 2 )) && [[ -n "$2" ]] || die 'Missing value for --from-env'; FROM_ENV=$2; shift 2 ;;
    --from-project) (( $# >= 2 )) && [[ -n "$2" ]] || die 'Missing value for --from-project'; FROM_PROJECT=$2; shift 2 ;;
    --from-db) (( $# >= 2 )) && [[ -n "$2" ]] || die 'Missing value for --from-db'; FROM_DB=$2; shift 2 ;;
    --help|-h) sed -n '2,14p' "$0"; exit 0 ;;
    *) die "Unknown option: $1 (use --help)" ;;
  esac
done

[[ $(uname -s) == Linux ]] || die 'Run this on the Linux VPS, not Windows.'
(( EUID == 0 )) || die "Run with sudo bash $0"
[[ -t 0 ]] || die 'An interactive terminal is required.'
[[ ! -L "$STATE_ROOT" ]] || die 'Deployment state cannot be a symlink.'
command -v docker python3 >/dev/null 2>&1 || die 'Docker and Python 3 are required.'

# Locate the saved deployments (one private environment file per domain).
mapfile -t env_files < <(find "$STATE_ROOT" -mindepth 2 -maxdepth 2 -name production.env -type f 2>/dev/null)
NEW_ENV='' OLD_ENV='' OLD_DOMAIN=''
for file in "${env_files[@]}"; do
  [[ ! -L "$file" ]] || die 'Saved environment files cannot be symlinks.'
  [[ $(stat -c %u "$file") == 0 ]] || die 'Saved environment files must be owned by root.'
  domain=$(env_get "$file" SETUP_DOMAIN)
  if [[ -z "$domain" ]]; then
    # Older state files still identify their deployment by the app origin.
    domain=$(env_get "$file" APP_ORIGIN)
    domain=${domain#https://}; domain=${domain#http://}; domain=${domain%%/*}
  fi
  if [[ "$domain" == "$TARGET_DOMAIN" ]]; then
    [[ -z "$NEW_ENV" ]] || die 'More than one saved deployment exists for the target domain.'
    NEW_ENV=$file
  elif [[ -n "$FROM_ENV" ]]; then
    # An explicit source environment file is used instead of saved state.
    continue
  elif [[ -n "$FROM_DOMAIN" ]]; then
    [[ "$domain" != "$FROM_DOMAIN" ]] || { OLD_ENV=$file; OLD_DOMAIN=$domain; }
  elif [[ -z "$OLD_ENV" ]]; then
    OLD_ENV=$file; OLD_DOMAIN=$domain
  else
    die "More than one existing deployment found. Choose the source with --from-domain (for example --from-domain $domain)."
  fi
done
if [[ -n "$FROM_ENV" ]]; then
  [[ -f "$FROM_ENV" && ! -L "$FROM_ENV" && -r "$FROM_ENV" ]] || die 'The --from-env file is not a readable regular file.'
  OLD_ENV=$FROM_ENV
  [[ -n "$OLD_DOMAIN" ]] || OLD_DOMAIN=$FROM_DOMAIN
  if [[ -z "$OLD_DOMAIN" ]]; then
    origin=$(env_get "$OLD_ENV" APP_ORIGIN)
    OLD_DOMAIN=${origin#https://}; OLD_DOMAIN=${OLD_DOMAIN#http://}; OLD_DOMAIN=${OLD_DOMAIN%%/*}
  fi
fi
[[ -n "$NEW_ENV" ]] || die "No saved deployment for $TARGET_DOMAIN. Run deploy-matgari-app.sh first."
[[ -n "$OLD_ENV" ]] || die 'No other installer-managed deployment was found. Pass --from-env and --from-project for a CI-deployed site, or migrate manually.'
[[ -n "$OLD_DOMAIN" ]] || die 'Cannot determine the source deployment domain.'
[[ "$OLD_DOMAIN" != "$TARGET_DOMAIN" ]] || die 'The source and target domains must differ.'

NEW_STATE=${NEW_ENV%/production.env}
NEW_PROJECT=$(compose_project_env "$NEW_ENV" "$TARGET_DOMAIN")
if [[ -n "$FROM_PROJECT" ]]; then
  OLD_PROJECT=$FROM_PROJECT
else
  OLD_PROJECT=$(compose_project_env "$OLD_ENV" "$OLD_DOMAIN")
fi
NEW_REPO=$(env_get "$NEW_ENV" SETUP_REPO_DIR)
NEW_DB=$(env_get "$NEW_ENV" MYSQL_DATABASE); NEW_DB=${NEW_DB:-matjary}
OLD_DB=$(env_get "$OLD_ENV" MYSQL_DATABASE)
[[ -z "$FROM_DB" ]] || OLD_DB=$FROM_DB
OLD_DB=${OLD_DB:-matjary}
NEW_PORT=$(env_get "$NEW_ENV" API_PORT)
NEW_WEB_ROOT=$(env_get "$NEW_ENV" SETUP_WEB_ROOT)
[[ "$NEW_PROJECT" =~ ^matjary-[0-9a-f]{12}$ ]] || die 'Unexpected saved project name; restore the deployment configuration.'
[[ "$OLD_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die 'The source Compose project name is invalid.'
[[ "$NEW_DB" =~ ^[a-zA-Z0-9_]+$ && "$OLD_DB" =~ ^[a-zA-Z0-9_]+$ ]] || die 'Unexpected database name in the saved environment.'
[[ -n "$NEW_REPO" && -f "$NEW_REPO/backend/infra/compose.yaml" ]] || die 'The saved matgari.app repository path is invalid.'
[[ "$NEW_PORT" =~ ^[1-9][0-9]{3,4}$ ]] || die 'The saved matgari.app API port is missing.'
[[ "$NEW_WEB_ROOT" == /* && -d "$NEW_WEB_ROOT/stores" ]] || die 'The saved matgari.app document root is invalid.'
[[ -f "$NEW_STATE/compose.setup.yaml" ]] || die 'The saved matgari.app Compose overlay is missing; rerun its setup.'
[[ $(env_get "$NEW_ENV" STORAGE_PROVIDER) == local ]] || die 'This migration only supports the target deployment on local media storage.'
old_provider=$(env_get "$OLD_ENV" STORAGE_PROVIDER)
[[ -z "$old_provider" || "$old_provider" == local ]] || die 'The source deployment is not using local media storage.'
[[ "$NEW_PROJECT" != "$OLD_PROJECT" ]] || die 'The source and target projects must differ.'
for volume in "${OLD_PROJECT}_media-data" "${NEW_PROJECT}_media-data"; do
  docker volume inspect "$volume" >/dev/null 2>&1 || die "Volume $volume is missing. Finish the new setup before migrating."
done

NEW_MYSQL=$(container_of "$NEW_PROJECT" mysql all)
NEW_REDIS=$(container_of "$NEW_PROJECT" redis all)
NEW_API=$(container_of "$NEW_PROJECT" api all)
NEW_WORKER=$(container_of "$NEW_PROJECT" worker all)
[[ -n "$NEW_MYSQL" && -n "$NEW_REDIS" && -n "$NEW_API" && -n "$NEW_WORKER" ]] || die 'The matgari.app containers are missing; finish its setup first.'

# Stop the target applications so nothing writes while its database and media
# are replaced. Its MySQL/Redis stay up.
unset MYSQL_PASSWORD MYSQL_ROOT_PASSWORD MYSQL_USER MYSQL_DATABASE MYSQL_HOST MYSQL_PORT \
  REDIS_PASSWORD REDIS_HOST REDIS_PORT APP_ORIGIN GOOGLE_CLIENT_ID ADMIN_EMAILS NODE_ENV \
  RELEASE_TAG STORAGE_PROVIDER STORAGE_LOCAL_DIR SHARE_SHELL_TOKEN SETUP_PROJECT API_PORT
# The overlay resolves the share-shell bind mount and image name from these
# variables, exactly as setup-vps.sh exports them before invoking Compose.
export APP_ENV_FILE="$NEW_ENV" WEB_ROOT="$NEW_WEB_ROOT" SETUP_PROJECT="$NEW_PROJECT"
dc_new() {
  docker compose --project-name "$NEW_PROJECT" --env-file "$NEW_ENV" \
    -f "$NEW_REPO/backend/infra/compose.yaml" \
    -f "$NEW_REPO/backend/infra/compose.production.yaml" \
    -f "$NEW_STATE/compose.setup.yaml" --profile app "$@"
}
printf '\nMigration plan\n  From: %s (project %s, database %s)\n  To:   %s (project %s, database %s)\n' \
  "$OLD_DOMAIN" "$OLD_PROJECT" "$OLD_DB" "$TARGET_DOMAIN" "$NEW_PROJECT" "$NEW_DB"
printf '\nThe old website will be briefly offline while its database and media are copied.\n'
printf 'The new %s database and media volume will be overwritten by the copies;\n' "$TARGET_DOMAIN"
printf 'anything already created on the new site will be lost. The old data is not modified.\n'
confirm 'Back up both databases and the old media volume off-server before continuing. Each user signs in again (sessions are not copied), and pending engagement events in Redis are not copied.' 'migrate'

printf '\nStopping the new %s applications...\n' "$TARGET_DOMAIN"
dc_new stop api worker >/dev/null
TARGET_TOUCHED=1

# The old MySQL must be running to produce a consistent snapshot. Starting it
# does not mutate data; API and worker stay stopped so no upload can race the copy.
OLD_MYSQL=$(container_of "$OLD_PROJECT" mysql)
if [[ -z "$OLD_MYSQL" ]]; then
  OLD_MYSQL=$(container_of "$OLD_PROJECT" mysql all)
  [[ -n "$OLD_MYSQL" ]] || die 'The old MySQL container is missing. Restore the old deployment first.'
  docker start "$OLD_MYSQL" >/dev/null
  for _ in {1..30}; do
    docker exec "$OLD_MYSQL" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping --silent' >/dev/null 2>&1 && break
    sleep 2
  done
  docker exec "$OLD_MYSQL" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping --silent' >/dev/null 2>&1 \
    || die 'The old MySQL did not become ready.'
fi

printf '\nStopping the old applications so uploads and processing pause...\n'
stop_old_service api
stop_old_service worker

printf '\nDumping the old database...\n'
DUMP=$(mktemp "$STATE_ROOT/.migration-dump.XXXXXXXX.sql")
docker exec "$OLD_MYSQL" sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --single-transaction --quick --skip-lock-tables --no-tablespaces --routines --triggers --default-character-set=utf8mb4 --set-gtid-purged=OFF "$1"' \
  sh "$OLD_DB" > "$DUMP"
[[ -s "$DUMP" ]] || die 'The database dump is empty.'
table_count=$(grep -c '^CREATE TABLE' "$DUMP" || true)
[[ "$table_count" -gt 0 ]] || die 'The database dump contains no tables.'
grep -q 'INSERT INTO `schema_migrations`' "$DUMP" || die 'The dump has no migration ledger; refusing to import an unknown schema.'
printf 'Dumped %s tables.\n' "$table_count"

printf '\nCopying the media volume (%s -> %s)...\n' "$OLD_PROJECT" "$NEW_PROJECT"
helper_image=$(docker inspect -f '{{.Config.Image}}' "$NEW_API")
docker run --rm --user 0:0 --entrypoint sh \
  -v "${OLD_PROJECT}_media-data:/from:ro" \
  -v "${NEW_PROJECT}_media-data:/to" \
  "$helper_image" -c 'cp -a /from/. /to/ && printf "Copied files: %s\n" "$(find /to -type f | wc -l)"'

printf '\nReplacing the %s database with the dump...\n' "$TARGET_DOMAIN"
old_charset='' old_collation=''
read -r old_charset old_collation < <(docker exec "$OLD_MYSQL" sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -N -B "$1" -e "SELECT @@character_set_database, @@collation_database"' sh "$OLD_DB" | tr '\t' ' ')
[[ "$old_charset" =~ ^[a-zA-Z0-9_]+$ && "$old_collation" =~ ^[a-zA-Z0-9_]+$ ]] || die 'Unrecognized source database character set.'
docker exec "$NEW_MYSQL" sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -e "DROP DATABASE IF EXISTS \`$1\`; CREATE DATABASE \`$1\` CHARACTER SET $2 COLLATE $3;"' \
  sh "$NEW_DB" "$old_charset" "$old_collation"
docker exec -i "$NEW_MYSQL" sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --default-character-set=utf8mb4 "$1"' \
  sh "$NEW_DB" < "$DUMP"
printf 'Imported the dump.\n'

# The fresh deployment may have issued its own sessions/carts against the
# empty database. User and cart IDs in those keys could point at different
# migrated rows, so drop them before the restored data is served.
printf '\nClearing stale sessions and carts in the new Redis...\n'
docker exec "$NEW_REDIS" sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli FLUSHALL' >/dev/null

printf '\nRunning migrations for the current code on the restored database...\n'
dc_new run --rm --no-deps api node dist/apps/migrations/main.js
ledger=$(docker exec "$NEW_MYSQL" sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -N -B "$1" -e "SELECT COUNT(*) FROM schema_migrations"' sh "$NEW_DB")
printf 'Schema migration ledger now holds %s entries.\n' "$ledger"

printf '\nStarting the %s applications and waiting for readiness...\n' "$TARGET_DOMAIN"
dc_new up -d --wait --wait-timeout 180 api worker
NEW_API=$(container_of "$NEW_PROJECT" api)
docker exec "$NEW_API" node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
printf 'API and worker are ready.\n'

printf '\nPublishing storefront share previews for the restored stores...\n'
SHARE_SHELL_TOKEN=$(env_get "$NEW_ENV" SHARE_SHELL_TOKEN)
if [[ -n "$SHARE_SHELL_TOKEN" ]]; then
  SHARE_SHELL_TOKEN="$SHARE_SHELL_TOKEN" python3 - "$NEW_PORT" <<'PY'
import json
import os
import sys
import urllib.request
request = urllib.request.Request(
    'http://127.0.0.1:' + sys.argv[1] + '/api/v1/seo/share-shells/refresh',
    method='POST',
    headers={'X-Share-Shell-Token': os.environ['SHARE_SHELL_TOKEN']},
)
try:
    with urllib.request.urlopen(request, timeout=180) as response:
        pages = json.loads(response.read() or b'{}').get('pages', 0)
    print('Published ' + str(pages) + ' share preview pages.')
except Exception:
    print('WARNING: share previews could not refresh now; the API retries in the background.')
PY
fi

printf '\nRestarting the old applications...\n'
for id in "${STOPPED_OLD[@]+"${STOPPED_OLD[@]}"}"; do
  docker start "$id" >/dev/null
done
STOPPED_OLD=()
FINISHED=1

# Keep the dump until every verification passed, then remove it.
if ! rm -f -- "$DUMP"; then
  printf 'WARNING: remove the database dump manually: %s\n' "$DUMP" >&2
fi
DUMP=''

printf '\nMigration finished.\n'
printf '  New site:  https://%s\n' "$TARGET_DOMAIN"
printf '  Old site:  https://%s (unchanged, still running)\n' "$OLD_DOMAIN"
printf '\nVerify on %s: sign in (existing sessions are in the old Redis and do not carry over),\n' "$TARGET_DOMAIN"
printf 'open a shop and a post, and load several uploaded images and videos.\n'
printf 'Keep the old deployment until the new one is fully verified; then DNS, the Google origin, and the CloudPanel site decide which domain serves traffic.\n'
