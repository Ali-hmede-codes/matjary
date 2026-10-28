#!/usr/bin/env bash
# One-file installer for an existing CloudPanel/static Nginx HTTPS site.
# Run with Bash, not sh. No host Node.js, public database ports, or S3 required.
set +x
set -Eeuo pipefail
umask 077

usage() {
  cat <<'HELP'
Matjary VPS setup (Ubuntu 24.04, or Linux with Docker already installed)

  sudo bash setup-vps.sh --domain demo.example.com --site-user example

Optional: --repo-dir /home/example/matjary
          --web-root /home/example/htdocs/demo.example.com
          --port 3100
          --update     (pull the current branch's upstream before rebuilding)
          --help
          --self-test  (validation only; no deployment or Docker required)

Create the website/user, DNS, and HTTPS certificate in CloudPanel first.
The wizard asks for your Google web client ID and administrator email.
Authorize https://YOUR-DOMAIN in Google's Authorized JavaScript origins.
Never enter a Google password, client secret, or CloudPanel password.

The script can clone the public Matjary repository if needed. It builds and
starts isolated containers, runs migrations, and publishes the frontend.
It prints Nginx location blocks to paste into ONLY this site's HTTPS Vhost.
It never edits/reloads host Nginx, upgrades the OS, resets databases, or
removes volumes. Docker installation is separately confirmed if necessary.

For an existing deployment, pull and refresh with:
  sudo bash update-vps.sh --domain demo.example.com
This uses saved settings and requires a clean Git checkout with an upstream.
Local commits, diverged history, and uncommitted files are never overwritten.
Back up MySQL and media first: migrations can change the schema.
A failed/interrupted migration blocks automatic retries until investigated.
HELP
}

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
confirm() {
  local answer
  printf '\n%s\n' "$1"
  read -r -p "Type $2 to continue: " answer
  [[ "$answer" == "$2" ]] || die 'Canceled; confirmation did not match.'
}
prompt() {
  local variable=$1 label=$2 fallback=$3 answer
  read -r -p "$label${fallback:+ [$fallback]}: " answer
  printf -v "$variable" '%s' "${answer:-$fallback}"
}
valid_domain() {
  local label
  [[ ${#1} -le 253 && "$1" == *.* && "$1" != *..* && "$1" != *. ]] || return 1
  local -a labels
  IFS=. read -r -a labels <<< "$1"
  for label in "${labels[@]}"; do
    [[ ${#label} -le 63 && "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1
  done
  [[ ! "$1" =~ ^[0-9.]+$ ]]
}
valid_user() { [[ "$1" =~ ^[a-z_][a-z0-9_-]{0,31}$ && "$1" != root ]]; }
valid_port() { [[ "$1" =~ ^[1-9][0-9]{3,4}$ ]] && (( $1 >= 1024 && $1 <= 65535 )); }
valid_path() { [[ "$1" =~ ^/[a-zA-Z0-9_./-]+$ && "$1" != / ]]; }
within() { [[ "$1" == "$2" || "$1" == "$2/"* ]]; }
valid_google() { [[ "$1" =~ ^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$ ]]; }
valid_email() { [[ "$1" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; }

# Dotenv is data, never sourced/evaluated as a root shell script.
env_get() {
  [[ -f "$ENV_FILE" ]] || return 0
  awk -v key="$1" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$ENV_FILE"
}
write_environment() {
  python3 - "$@" <<'PY'
import os
import secrets
import sys
import tempfile
from pathlib import Path

PASSWORDS = ('MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'REDIS_PASSWORD')

def render(template, current, updates):
    text = template if current is None else current
    values = dict(line.split('=', 1) for line in text.splitlines()
                  if '=' in line and not line.lstrip().startswith('#'))
    updates = dict(updates)
    for key in PASSWORDS:
        if current is None:
            updates[key] = secrets.token_hex(32)
        elif not values.get(key, '').strip():
            raise ValueError('Existing deployment credentials are incomplete; restore the private environment backup.')
    # Existing deployments gain the share-shell hook secret on the next setup.
    if not values.get('SHARE_SHELL_TOKEN', '').strip():
        updates['SHARE_SHELL_TOKEN'] = secrets.token_hex(32)
    if current is not None and values.get('STORAGE_PROVIDER') != 'local':
        raise ValueError('This installer only manages local media deployments.')
    lines = []
    for line in text.splitlines():
        key = line.split('=', 1)[0]
        if key in updates:
            line = key + '=' + updates.pop(key)
        lines.append(line)
    lines.extend(key + '=' + value for key, value in updates.items())
    return '\n'.join(lines) + '\n'

if sys.argv[1:] == ['--self-test']:
    template = '# preserved comment\nSTORAGE_PROVIDER=local\n' + ''.join(k + '=\n' for k in PASSWORDS)
    first = render(template, None, {'APP_ORIGIN': 'https://demo.example.com'})
    second = render(template, first, {'API_PORT': '3101'})
    for key in PASSWORDS:
        original = next(line for line in first.splitlines() if line.startswith(key + '='))
        assert len(original.split('=', 1)[1]) == 64
        assert original in second.splitlines()
    assert '# preserved comment' in second
    assert second.count('API_PORT=') == 1
    try:
        render(template, template, {})
    except ValueError:
        pass
    else:
        raise AssertionError('Missing existing secrets must not be regenerated')
    print('Environment preservation tests passed.')
    sys.exit(0)

path, template = map(Path, sys.argv[1:3])
updates = {
    'NODE_ENV': 'production',
    'APP_ORIGIN': 'https://' + os.environ['DOMAIN'],
    'API_PORT': os.environ['API_PORT'],
    'GOOGLE_CLIENT_ID': os.environ['GOOGLE_CLIENT_ID'],
    'ADMIN_EMAILS': os.environ['ADMIN_EMAIL'],
    'SETUP_DOMAIN': os.environ['DOMAIN'],
    'SETUP_PROJECT': os.environ['SETUP_PROJECT'],
    'SETUP_SITE_USER': os.environ['SITE_USER'],
    'SETUP_REPO_DIR': os.environ['REPO_DIR'],
    'SETUP_WEB_ROOT': os.environ['WEB_ROOT'],
    'RELEASE_TAG': os.environ['RELEASE_TAG'],
}
if os.environ.get('PROXY_CIDR'):
    updates['TRUST_PROXY_CIDRS'] = os.environ['PROXY_CIDR']
try:
    text = render(template.read_text(), path.read_text() if path.exists() else None, updates)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as output:
        os.chmod(output.name, 0o600)
        output.write(text)
        temporary = output.name
    os.replace(temporary, path)
except ValueError as error:
    sys.exit(str(error))
PY
}

render_overlay() {
  cat <<'YAML'
services:
  mysql:
    ports: !reset []
    mem_limit: 1536m
    cpus: 1
  redis:
    ports: !reset []
  api:
    image: ${SETUP_PROJECT}-api:${RELEASE_TAG}
    environment:
      MYSQL_POOL_SIZE: 5
    volumes:
      - type: bind
        source: ${WEB_ROOT}/stores
        target: /srv/share
  worker:
    image: ${SETUP_PROJECT}-worker:${RELEASE_TAG}
    cpus: 1
    environment:
      MYSQL_POOL_SIZE: 5
      MEDIA_WORKER_CONCURRENCY: 1
YAML
}
render_nginx() {
  cat <<NGINX
# Paste into this domain's HTTPS server block in CloudPanel's Vhost editor.
# Keep CloudPanel's root, SSL, ACME, logging, and security settings.
# Add/replace these locations; never paste duplicate location blocks.
# On subsequent runs with the same port, existing matching blocks can stay.
# CloudPanel document root: $WEB_ROOT
#
# STEP 1 (once per server): published photos and videos are immutable URLs, so
# Nginx can serve them from its own cache instead of asking the API for every
# visitor. Add ONE line inside the http { } block of /etc/nginx/nginx.conf,
# create the directory first, then reload Nginx:
#   install -d -o www-data -g www-data /var/cache/nginx/matjary-media
#   proxy_cache_path /var/cache/nginx/matjary-media levels=1:2 keys_zone=matjary_media:32m max_size=4g inactive=1d use_temp_path=off;
# Private/owner responses are "private, no-store" and are never stored; only
# published variants carry "public, max-age=...".
#
# STEP 2: add these locations to the site's HTTPS server block.
location = /api/v1/internal/metrics { return 404; }
location ^~ /api/v1/internal/metrics/ { return 404; }

# Media bytes: let good caches absorb repeat views. Range requests (video
# seeking) bypass the cache so partial responses are never stored.
location ^~ /api/v1/uploads/ {
    proxy_pass http://127.0.0.1:$API_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Connection "";
    proxy_cache matjary_media;
    proxy_cache_key "\$request_method\$host\$request_uri";
    proxy_cache_lock on;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    proxy_cache_bypass \$http_range;
    proxy_no_cache \$http_range;
    proxy_connect_timeout 10s;
    proxy_read_timeout 330s;
    proxy_send_timeout 330s;
}

location ^~ /api/ {
    proxy_pass http://127.0.0.1:$API_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Connection "";
    # Feed JSON is text; compressing it keeps the first screen small.
    gzip on;
    gzip_types application/json;
    gzip_min_length 1024;
    client_max_body_size 200m;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_cache off;
    proxy_connect_timeout 10s;
    proxy_read_timeout 330s;
    proxy_send_timeout 330s;
}

location = /index.html {
    expires -1;
    try_files \$uri =404;
}

# Branding files keep their names between releases. Browsers must revalidate
# them so a replaced logo, favicon, or manifest cannot keep showing the previous
# icon; the built HTML also appends a content stamp to each URL. Keep this block
# above CloudPanel's broad static-asset location, if one exists.
location ~* ^/(?:logo\.png|favicon(?:-96x96)?\.(?:ico|png|svg)|apple-touch-icon\.png|web-app-manifest-[0-9]+x[0-9]+\.png|site\.webmanifest)\$ {
    expires -1;
    try_files \$uri =404;
}

# Social crawlers never run the SPA. Send only those user agents to the API's
# Open Graph document so shared shop/category/product/post links show real
# titles and images; browsers and search engine renderers keep the React app.
location ^~ /stores/ {
    error_page 418 = @matjary_share;
    if (\$http_user_agent ~* "(facebookexternalhit|facebookbot|meta-externalagent|WhatsApp|Twitterbot|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|vkShare|SkypeUriPreview|Iframely|Embedly|redditbot|Mastodon|Misskey)") {
        return 418;
    }
    try_files \$uri \$uri/ /index.html;
}

# Posts without a shop use the platform path; the same crawler rule answers
# them from the API's Open Graph document.
location ^~ /post/ {
    error_page 418 = @matjary_share;
    if (\$http_user_agent ~* "(facebookexternalhit|facebookbot|meta-externalagent|WhatsApp|Twitterbot|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|vkShare|SkypeUriPreview|Iframely|Embedly|redditbot|Mastodon|Misskey)") {
        return 418;
    }
    try_files \$uri \$uri/ /index.html;
}

location @matjary_share {
    proxy_pass http://127.0.0.1:$API_PORT/api/v1/seo/share\$request_uri;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Connection "";
    proxy_connect_timeout 10s;
    proxy_read_timeout 30s;
}

location / {
    try_files \$uri \$uri/ /index.html;
}
NGINX
}
repo_git() {
  runuser -u "$SITE_USER" -- env GIT_TERMINAL_PROMPT=0 git -C "$REPO_DIR" "$@"
}
update_repository() {
  local branch remote ref previous target status
  [[ $(repo_git rev-parse --show-toplevel) == "$REPO_DIR" ]] || die 'The saved repository must be the Git checkout root.'
  status=$(repo_git status --porcelain --untracked-files=normal) || die 'Cannot check the server checkout.'
  [[ -z "$status" ]] || die 'The server checkout has local changes. Preserve or resolve them manually before updating.'
  branch=$(repo_git symbolic-ref --quiet --short HEAD) || die 'Detached HEAD cannot be updated automatically. Select the intended tracking branch manually.'
  remote=$(repo_git config --get "branch.$branch.remote") || die 'The current branch has no upstream remote.'
  ref=$(repo_git config --get "branch.$branch.merge") || die 'The current branch has no upstream branch.'
  [[ -n "$remote" && "$remote" != . && "$remote" != -* && "$ref" == refs/heads/* ]] || die 'The upstream must be a branch on a configured remote.'
  repo_git check-ref-format "$ref" || die 'The upstream branch is invalid.'
  previous=$(repo_git rev-parse --verify HEAD) || die 'Cannot identify the current revision.'
  printf '\nFetching updates for branch %s...\n' "$branch"
  repo_git fetch --no-tags -- "$remote" "$ref" || die "Git fetch failed. Check the remote and the site user's Git access; the running website was not restarted."
  target=$(repo_git rev-parse --verify 'FETCH_HEAD^{commit}') || die 'Cannot identify the fetched revision.'
  repo_git merge-base --is-ancestor "$previous" "$target" || die 'The server has local commits or diverged history. Resolve this manually; no reset or forced update was performed.'
  # Merge exactly the fetched commit, without creating a merge commit or stashing files.
  repo_git merge --ff-only --no-edit "$target" || die 'Fast-forward failed. Preserve the checkout and resolve Git errors manually.'
  [[ $(repo_git rev-parse --verify HEAD) == "$target" ]] || die 'The checkout does not match the fetched revision.'
  status=$(repo_git status --porcelain --untracked-files=normal) || die 'Cannot verify the updated checkout.'
  [[ -z "$status" ]] || die 'The checkout changed during the update; deployment stopped.'
  printf '\nRepository ready at %s (previously %s). Rebuilding the website.\n' "$target" "$previous"
}
self_test_update() {
  local scenario output expected
  for scenario in success current dirty status-failed detached no-upstream local-upstream invalid-ref fetch-failed diverged merge-failed; do
    expected=1
    [[ "$scenario" != success && "$scenario" != current ]] || expected=0
    if output=$(
      REPO_DIR=/home/demo/matjary
      merged=0
      repo_git() {
        case "$1" in
          rev-parse)
            if [[ "$2" == --show-toplevel ]]; then printf '%s\n' "$REPO_DIR"
            elif [[ "$3" == 'FETCH_HEAD^{commit}' || "$merged" == 1 || "$scenario" == current ]]; then printf 'new-commit\n'
            else printf 'old-commit\n'; fi ;;
          status)
            [[ "$scenario" != status-failed ]] || return 1
            [[ "$scenario" != dirty ]] || printf ' M frontend/src/App.tsx\n' ;;
          symbolic-ref) [[ "$scenario" != detached ]] || return 1; printf 'main\n' ;;
          config)
            [[ "$scenario" != no-upstream ]] || return 1
            if [[ "$3" == branch.main.remote ]]; then
              if [[ "$scenario" == local-upstream ]]; then printf '.\n'; else printf 'origin\n'; fi
            else printf 'refs/heads/main\n'; fi ;;
          check-ref-format) [[ "$scenario" != invalid-ref ]] ;;
          fetch)
            [[ "$2 $3 $4 $5" == '--no-tags -- origin refs/heads/main' && "$scenario" != fetch-failed ]] ;;
          merge-base) [[ "$scenario" != diverged ]] ;;
          merge)
            [[ "$2 $3 $4" == '--ff-only --no-edit new-commit' && "$scenario" != merge-failed ]] || return 1
            merged=1
            printf 'TEST_MERGED\n' ;;
          *) exit 99 ;;
        esac
      }
      update_repository 2>&1 || exit 1
    ); then
      [[ "$expected" == 0 && "$output" == *TEST_MERGED* ]] || die "Unsafe update accepted: $scenario"
    else
      [[ "$expected" == 1 && "$output" != *TEST_MERGED* ]] || die "Update regression: $scenario"
    fi
  done
  printf 'Git update safety tests passed. No real checkout or deployment changed.\n'
}
self_test() {
  valid_domain demo.example.com || die 'Domain validation failed.'
  valid_domain xn--bcher-kva.example || die 'Punycode validation failed.'
  local value
  for value in 'https://example.com' 'example.com/path' 'a..com' '-bad.com' 'example.com;' '127.0.0.1'; do
    if valid_domain "$value"; then die 'Unsafe domain accepted.'; fi
  done
  valid_user chatrix-demo && valid_port 3100 && valid_path /home/demo/matjary || die 'Valid input rejected.'
  for value in 80 65536 03100 '3100;id'; do
    if valid_port "$value"; then die 'Unsafe port accepted.'; fi
  done
  if valid_user root || valid_path '/tmp/a b' || valid_path '/tmp/a;id'; then die 'Unsafe input accepted.'; fi
  within /home/demo/site/repo /home/demo/site || die 'Path containment failed.'
  if within /home/demo/site2 /home/demo/site; then die 'Sibling path rejected.'; fi
  valid_google 123-example.apps.googleusercontent.com && valid_email admin@example.com || die 'Auth validation failed.'
  local API_PORT=3100 WEB_ROOT=/home/demo/htdocs/example.com nginx overlay
  nginx=$(render_nginx)
  overlay=$(render_overlay)
  [[ "$nginx" == *'proxy_pass http://127.0.0.1:3100;'* ]] || die 'Proxy URI must not be rewritten.'
  [[ "$nginx" == *'X-Forwarded-For $remote_addr;'* && "$overlay" == *'ports: !reset []'* ]] || die 'Isolation checks failed.'
  write_environment --self-test
  self_test_update
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    local root
    root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
    if [[ -f "$root/backend/infra/compose.yaml" ]]; then
      # Synthetic values only; this check never reads the application's .env.
      export MYSQL_PASSWORD=setup-test-only MYSQL_ROOT_PASSWORD=setup-test-root
      export REDIS_PASSWORD=setup-test-redis APP_ORIGIN=https://demo.example.com
      export GOOGLE_CLIENT_ID=123-test.apps.googleusercontent.com
      export APP_ENV_FILE="$root/backend/.env.example" API_PORT=3100
      export SETUP_PROJECT=matjary-self-test RELEASE_TAG=check STORAGE_PROVIDER=local
      render_overlay | docker compose --project-name matjary-self-test \
        --env-file "$root/backend/.env.example" -f "$root/backend/infra/compose.yaml" \
        -f "$root/backend/infra/compose.production.yaml" -f - --profile app \
        config --format json --no-env-resolution | python3 -c '
import json, sys
services = json.load(sys.stdin)["services"]
assert not services["mysql"].get("ports")
assert not services["redis"].get("ports")
assert not services["worker"].get("ports")
ports = services["api"]["ports"]
assert len(ports) == 1 and ports[0]["host_ip"] == "127.0.0.1"
assert str(ports[0]["published"]) == "3100" and ports[0]["target"] == 3000
assert services["api"]["image"] == "matjary-self-test-api:check"
print("Compose merge and private port checks passed.")
'
    fi
  fi
  printf 'Input, proxy, and isolation checks passed. No deployment performed.\n'
}

DOMAIN='' SITE_USER='' REPO_DIR='' WEB_ROOT='' API_PORT=''
UPDATE=0 UPDATE_RESUMED=0
while (( $# )); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --self-test) self_test; exit 0 ;;
    --update) UPDATE=1; shift ;;
    --domain|--site-user|--repo-dir|--web-root|--port)
      (( $# >= 2 )) || die "Missing value for $1"
      case "$1" in
        --domain) DOMAIN=$2 ;;
        --site-user) SITE_USER=$2 ;;
        --repo-dir) REPO_DIR=$2 ;;
        --web-root) WEB_ROOT=$2 ;;
        --port) API_PORT=$2 ;;
      esac
      shift 2 ;;
    *) die "Unknown option: $1 (use --help)" ;;
  esac
done

[[ $(uname -s) == Linux ]] || die 'Run this installer on the Linux VPS, not Windows.'
(( EUID == 0 )) || die 'Run with sudo bash setup-vps.sh.'
[[ -t 0 ]] || die 'An interactive terminal is required for setup confirmations.'
trap 'printf "\nSetup stopped at line %s. Existing volumes and credentials were kept. Do not reset the database or blindly retry failed migrations.\n" "$LINENO" >&2' ERR

[[ -n "$DOMAIN" ]] || prompt DOMAIN 'HTTPS domain, without https:// or a path' ''
DOMAIN=${DOMAIN,,}
valid_domain "$DOMAIN" || die 'Enter a valid DNS hostname (use punycode for internationalized domains).'
PROJECT="matjary-$(printf '%s' "$DOMAIN" | sha256sum | cut -c1-12)"
STATE="/var/lib/matjary-setup/$PROJECT"
ENV_FILE="$STATE/production.env"
[[ ! -L /var/lib/matjary-setup && ! -L "$STATE" ]] || die 'Deployment state cannot be a symlink.'
if (( UPDATE )); then
  [[ -f "$ENV_FILE" ]] || die 'No saved deployment for this domain. Run setup-vps.sh first, or check the domain spelling.'
fi
for directory in /var/lib/matjary-setup "$STATE"; do
  [[ ! -e "$directory" || $(stat -c %u "$directory") == 0 ]] || die 'Existing deployment state must be owned by root.'
done
install -d -m 0700 -o root -g root /var/lib/matjary-setup "$STATE"
if [[ -n "${MATJARY_UPDATE_LOCK:-}" ]]; then
  # Keep the same open lock across exec so setup cannot race another update.
  [[ "$MATJARY_UPDATE_LOCK" == "$STATE/setup.lock" && /proc/self/fd/9 -ef "$STATE/setup.lock" ]] || die 'Invalid update lock handoff.'
  UPDATE_RESUMED=1
else
  exec 9> "$STATE/setup.lock"
fi
flock -n 9 || die 'Another setup or update for this domain is already running.'
unset MATJARY_UPDATE_LOCK
[[ ! -e "$STATE/migration.pending" ]] || die "An earlier migration needs investigation. Inspect the database and $STATE/migration.pending before any retry. After verified recovery, archive that marker manually."
[[ ! -L "$ENV_FILE" ]] || die 'The private environment file cannot be a symlink.'

# Keep deployment identity stable; changing domains is a separate migration.
if [[ -f "$ENV_FILE" ]]; then
  [[ $(stat -c %u "$ENV_FILE") == 0 ]] || die 'The deployment environment must be owned by root.'
  chmod 0600 "$ENV_FILE"
  [[ $(env_get SETUP_DOMAIN) == "$DOMAIN" ]] || die 'Deployment domain mismatch.'
  for variable in SITE_USER REPO_DIR WEB_ROOT API_PORT; do
    key="SETUP_$variable"
    [[ "$variable" != API_PORT ]] || key=API_PORT
    saved=$(env_get "$key")
    [[ -n "$saved" ]] || die "Missing saved $variable; restore the deployment configuration."
    [[ -z "${!variable}" || "${!variable}" == "$saved" ]] || die "$variable differs from the saved deployment. Do not change deployment identity accidentally."
    printf -v "$variable" '%s' "$saved"
  done
fi

[[ -n "$SITE_USER" ]] || prompt SITE_USER 'Existing CloudPanel/Nginx site username' ''
valid_user "$SITE_USER" || die 'Use an existing non-root site username.'
id "$SITE_USER" >/dev/null 2>&1 || die 'Create the site/user in CloudPanel first.'
SITE_UID=$(id -u "$SITE_USER")
SITE_GID=$(id -g "$SITE_USER")
(( SITE_UID != 0 )) || die 'The site user cannot have UID 0.'
USER_HOME=$(getent passwd "$SITE_USER" | cut -d: -f6)
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
if [[ -z "$REPO_DIR" ]]; then
  default_repo="$USER_HOME/matjary"
  [[ ! -f "$SCRIPT_DIR/backend/package.json" ]] || default_repo=$SCRIPT_DIR
  prompt REPO_DIR 'Private repository directory' "$default_repo"
fi
[[ -n "$WEB_ROOT" ]] || prompt WEB_ROOT 'Existing website document root' "$USER_HOME/htdocs/$DOMAIN"
[[ -n "$API_PORT" ]] || prompt API_PORT 'Private API host port' 3100
valid_path "$REPO_DIR" && valid_path "$WEB_ROOT" && valid_path "$USER_HOME" || die 'Use absolute paths without spaces or special characters.'
valid_port "$API_PORT" || die 'Choose an API port between 1024 and 65535, without leading zeros.'
REPO_DIR=$(realpath -m -- "$REPO_DIR")
WEB_ROOT=$(realpath -e -- "$WEB_ROOT")
[[ -d "$WEB_ROOT" ]] || die 'The website document root must already exist.'
if within "$REPO_DIR" "$WEB_ROOT" || within "$WEB_ROOT" "$REPO_DIR" || within "$STATE" "$WEB_ROOT"; then
  die 'Repository, private deployment state, and public document root must be separate.'
fi
runuser -u "$SITE_USER" -- test -w "$WEB_ROOT" || die 'The site user must be able to write its document root.'
if [[ -e "$WEB_ROOT/.matjary-setup" ]]; then
  [[ $(runuser -u "$SITE_USER" -- cat "$WEB_ROOT/.matjary-setup") == "$PROJECT" ]] || die 'This document root belongs to a different deployment.'
fi

printf '\nDomain: https://%s\nSite user: %s\nRepository: %s\nPublic frontend: %s\nAPI: 127.0.0.1:%s\nPrivate configuration: %s\n' \
  "$DOMAIN" "$SITE_USER" "$REPO_DIR" "$WEB_ROOT" "$API_PORT" "$STATE"
printf '\nMySQL and Redis stay inside Docker with NO host ports. One media job runs at a time.\n'
printf 'Runtime memory limits total about 4.75 GiB; builds also need headroom. Other apps still share CPU/disk.\n'
free -h
printf '\nOnly this website frontend will be replaced. Existing database/media volumes are preserved.\n'
if (( ! UPDATE_RESUMED )); then
  if (( UPDATE )); then
    printf 'This will pull the current branch\x27s upstream and execute its deployment script. Only deploy trusted, reviewed updates.\n'
  fi
  confirm 'Confirm this is the intended demo website, HTTPS is configured, and you have current VPS/database/media backups. Updates may briefly interrupt Matjary.' "$DOMAIN"
fi

# The API prerenders one storefront shell per shop, section, and product into
# this directory. It runs as UID 1000 (node); only this subtree is writable.
install -d -o 1000 -g 1000 -m 0755 "$WEB_ROOT/stores"

# Install only missing prerequisites, never replace an existing Docker distribution.
packages=()
for command in git python3; do
  command -v "$command" >/dev/null 2>&1 || packages+=("$command")
done
if ! command -v docker >/dev/null 2>&1; then
  packages+=(docker.io docker-compose-v2 docker-buildx)
else
  docker compose version >/dev/null 2>&1 || die 'Docker exists but its Compose plugin is missing. Install the matching plugin for your Docker distribution first.'
  docker buildx version >/dev/null 2>&1 || die 'Docker exists but Buildx is missing. Install its matching plugin first.'
fi
if (( ${#packages[@]} )); then
  # This is trusted OS metadata, not application configuration.
  source /etc/os-release
  [[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || die 'Automatic package installation supports Ubuntu 24.04 only. Install Git, Python 3, Docker, Compose, and Buildx for your distribution, then rerun.'
  confirm 'Missing packages will be installed. Docker adds networking/firewall rules; existing sites must be backed up.' INSTALL
  apt-get update
  apt-get -s --no-remove install "${packages[@]}"
  confirm 'Review the package preview above. Continue only if it is appropriate for this shared VPS.' INSTALL
  NEEDRESTART_MODE=l apt-get install -y --no-remove "${packages[@]}"
  systemctl enable --now docker
fi
docker info >/dev/null 2>&1 || die 'Docker is not running. Start it and rerun.'
compose_version=$(docker compose version --short)
compose_version=${compose_version#v}
[[ $(printf '%s\n' 2.24.4 "$compose_version" | sort -V | head -n1) == 2.24.4 ]] || die 'Docker Compose 2.24.4 or newer is required for private port overrides.'

# Inherited shell variables must not override the private Compose environment.
while IFS= read -r variable; do
  case "$variable" in
    MYSQL_*|REDIS_*|S3_*|STORAGE_*|MEDIA_*|APP_*|GOOGLE_CLIENT_ID|ADMIN_EMAILS|NODE_ENV|RELEASE_TAG|COMPOSE_*|SHARE_SHELL_*) unset "$variable" ;;
  esac
done < <(compgen -e)
export SETUP_PROJECT="$PROJECT" COMPOSE_PARALLEL_LIMIT=1

existing=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}}')
volumes=$(docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}')
[[ -f "$ENV_FILE" || ( -z "$existing" && -z "$volumes" ) ]] || die 'Existing containers/volumes have no saved credentials. Restore the private environment backup; do not generate replacement passwords.'
owned_ports=$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=api --format '{{.Ports}}')
if [[ "$owned_ports" != *"127.0.0.1:$API_PORT->3000/tcp"* ]]; then
  all_ports=$(docker ps --format '{{.Ports}}')
  if [[ -n $(ss -H -ltn "sport = :$API_PORT") || "$all_ports" == *":$API_PORT->"* ]]; then
    die "Port $API_PORT is already in use. Choose another port with --port for a new deployment."
  fi
fi

if (( UPDATE )); then
  update_repository
  [[ -f "$REPO_DIR/setup-vps.sh" && ! -L "$REPO_DIR/setup-vps.sh" ]] || die 'The updated repository has no regular setup-vps.sh.'
  export MATJARY_UPDATE_LOCK="$STATE/setup.lock"
  # Reload the fetched installer, including any updated build/migration behavior.
  exec bash "$REPO_DIR/setup-vps.sh" --domain "$DOMAIN"
fi

if [[ ! -d "$REPO_DIR" ]]; then
  runuser -u "$SITE_USER" -- env GIT_TERMINAL_PROMPT=0 git clone \
    https://github.com/Ali-hmede-codes/matjary.git "$REPO_DIR"
fi
for required in backend/package.json backend/.env.example backend/infra/compose.yaml backend/infra/compose.production.yaml frontend/package-lock.json; do
  [[ -f "$REPO_DIR/$required" ]] || die "Missing $required in the repository. Existing directories are never overwritten by cloning."
done
# The script intentionally never pulls over local changes or pushes commits.
GOOGLE_CLIENT_ID=$(env_get GOOGLE_CLIENT_ID)
ADMIN_EMAIL=$(env_get ADMIN_EMAILS)
if [[ -z "$GOOGLE_CLIENT_ID" ]]; then
  printf '\nGoogle Auth Platform: use a Web application client; authorize https://%s\n' "$DOMAIN"
  prompt GOOGLE_CLIENT_ID 'Google web client ID (not a secret/password)' ''
fi
valid_google "$GOOGLE_CLIENT_ID" || die 'A valid Google web client ID is required for production login.'
[[ -n "$ADMIN_EMAIL" ]] || prompt ADMIN_EMAIL 'Your verified Google email for administrator access' ''
valid_email "$ADMIN_EMAIL" || die 'Enter one valid administrator email address.'
ADMIN_EMAIL=${ADMIN_EMAIL,,}
RELEASE_TAG="setup-$(date -u +%Y%m%d%H%M%S)-$RANDOM"
PROXY_CIDR=''
export DOMAIN SITE_USER REPO_DIR WEB_ROOT API_PORT GOOGLE_CLIENT_ID ADMIN_EMAIL RELEASE_TAG PROXY_CIDR
export APP_ENV_FILE="$ENV_FILE"
write_environment "$ENV_FILE" "$REPO_DIR/backend/.env.example"
render_overlay > "$STATE/compose.setup.yaml"
render_nginx > "$STATE/cloudpanel.locations.conf"
cd -- "$REPO_DIR/backend"
dc() {
  docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" \
    -f "$REPO_DIR/backend/infra/compose.yaml" \
    -f "$REPO_DIR/backend/infra/compose.production.yaml" \
    -f "$STATE/compose.setup.yaml" --profile app "$@"
}
dc config --quiet

printf '\nBuilding the frontend in an isolated Node.js container...\n'
BUILD_DIR=$(runuser -u "$SITE_USER" -- mktemp -d "$USER_HOME/.matjary-frontend.XXXXXXXX")
docker run --rm --init --user "$SITE_UID:$SITE_GID" --cpus 1 --memory 2g --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges:true --env HOME=/tmp \
  --mount "type=bind,src=$REPO_DIR/frontend,dst=/source,readonly" \
  --mount "type=bind,src=$BUILD_DIR,dst=/output" \
  node:22-slim sh -ec '
    umask 022
    mkdir /tmp/frontend
    cp /source/package.json /source/package-lock.json /source/index.html /source/tsconfig.json /source/vite.config.ts /tmp/frontend/
    cp -R /source/src /source/public /tmp/frontend/
    cd /tmp/frontend
    npm ci --no-audit --no-fund
    npm run build
    cp -R dist/. /output/
  '
[[ -s "$BUILD_DIR/index.html" ]] || die 'Frontend build did not produce index.html.'
printf '\nBuilding backend images sequentially before interrupting any existing Matjary instance...\n'
dc build api
dc build worker

printf '\nStarting private MySQL and Redis...\n'
dc up -d --wait --wait-timeout 180 mysql redis
# Host Nginx reaches a published Docker port through this bridge gateway.
# Trust only that address, never every client or an entire private address range.
PROXY_CIDR=$(docker network inspect "${PROJECT}_default" --format '{{(index .IPAM.Config 0).Gateway}}')
python3 - "$PROXY_CIDR" <<'PY'
import ipaddress
import sys
address = ipaddress.ip_address(sys.argv[1])
if address.version != 4 or not address.is_private:
    sys.exit('Expected a private IPv4 Docker bridge gateway; configure the actual proxy address manually.')
PY
PROXY_CIDR="$PROXY_CIDR/32"
write_environment "$ENV_FILE" "$REPO_DIR/backend/.env.example"
dc config --quiet

printf '\nStopping only this deployment\x27s API/worker and applying migrations...\n'
dc stop api worker
printf 'Migration started at %s for %s\n' "$(date -u +%FT%TZ)" "$RELEASE_TAG" > "$STATE/migration.pending"
if ! dc run --rm --no-deps api node dist/apps/migrations/main.js; then
  die "Migration failed. API/worker remain stopped. Preserve logs, inspect schema and migration ledger, and investigate $STATE/migration.pending. Do not blindly rerun or reset data."
fi
mv -- "$STATE/migration.pending" "$STATE/migration.last-success"
dc up -d --wait --wait-timeout 180 api worker
dc exec -T api node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
dc exec -T worker node -e "const fs=require('node:fs');const age=Date.now()-Number(fs.readFileSync(process.env.WORKER_HEARTBEAT_FILE,'utf8'));process.exit(age>=0&&age<30000?0:1)"

printf '\nPublishing the built frontend as the site user...\n'
if [[ -f "$WEB_ROOT/index.html" ]]; then
  runuser -u "$SITE_USER" -- cp -- "$WEB_ROOT/index.html" "$BUILD_DIR.previous-index.html"
fi
# Publish assets before index.html and retain old hashed assets for open tabs.
shopt -s dotglob nullglob
for item in "$BUILD_DIR"/*; do
  [[ $(basename -- "$item") != index.html ]] || continue
  runuser -u "$SITE_USER" -- sh -c 'umask 022; cp -R -- "$1" "$2"' sh "$item" "$WEB_ROOT/"
done
runuser -u "$SITE_USER" -- sh -c '
  umask 022
  install -m 0644 "$1/index.html" "$2/.matjary-index-next"
  mv -f -- "$2/.matjary-index-next" "$2/index.html"
  printf "%s\n" "$3" > "$2/.matjary-setup"
' sh "$BUILD_DIR" "$WEB_ROOT" "$PROJECT"

printf '\nBackend and worker health checks passed. Frontend files are published.\n'
# Give the API its own copy of the built index.html inside the writable share
# mount; the rest of the web root is never exposed to the container. The rename
# keeps a refresh from reading a half-written template.
install -m 0644 -o 1000 -g 1000 "$WEB_ROOT/index.html" "$WEB_ROOT/stores/.matjary-template.next"
mv -f "$WEB_ROOT/stores/.matjary-template.next" "$WEB_ROOT/stores/.matjary-template.html"
SHARE_SHELL_TOKEN=$(env_get SHARE_SHELL_TOKEN)
if [[ -n "$SHARE_SHELL_TOKEN" ]]; then
  printf '\nPublishing storefront share previews...\n'
  SHARE_SHELL_TOKEN="$SHARE_SHELL_TOKEN" python3 - "$API_PORT" <<'PY'
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
printf '\nFINAL CLOUDPANEL STEP (host Nginx has NOT been changed):\n'
printf 'Open %s > Vhost. In the HTTPS server block, apply the following locations.\n' "$DOMAIN"
printf 'Add/replace locations without duplicates; keep SSL/ACME/root/security settings. Save through CloudPanel.\n'
printf 'Preview metadata is prerendered into %s/stores, so this location is optional; it answers crawlers from the API instead.\n' "$WEB_ROOT"
printf 'If these matching locations are already installed, no Vhost change is necessary.\n\n'
cat "$STATE/cloudpanel.locations.conf"
printf '\nVerify social previews with a crawler user agent (use a real shop and post slug):\n'
printf '  curl -s -A "WhatsApp/2.0" https://%s/stores/YOUR-SHOP-SLUG | grep -E "og:title|og:image"\n' "$DOMAIN"
printf '  curl -s -A "WhatsApp/2.0" https://%s/stores/YOUR-SHOP-SLUG/post/YOUR-POST-SLUG | grep -E "og:title|og:image"\n' "$DOMAIN"
printf 'A shop or post title means the crawler locations are active. If the site HTML comes back, the locations above are missing.\n'
printf 'WhatsApp and Facebook cache previews, so re-share with a changed query (?v=2) or use their sharing debugger after fixing the Vhost.\n'
printf '\nThen verify:\n  https://%s/api/v1/health/ready\n  https://%s/\n  https://%s/api/v1/auth/login\n  https://%s/api/v1/admin\n' "$DOMAIN" "$DOMAIN" "$DOMAIN" "$DOMAIN"
printf '\nCredentials remain private in %s; never paste that file or expanded Compose configuration.\n' "$ENV_FILE"
printf 'Persistent volumes: %s_mysql-data, %s_redis-data, %s_media-data. Back them up.\n' "$PROJECT" "$PROJECT" "$PROJECT"
printf 'Nginx snippet: %s/cloudpanel.locations.conf\n' "$STATE"
printf 'Frontend build/previous index retained at %s (and .previous-index.html when present).\n' "$BUILD_DIR"
printf 'To pull and refresh later: sudo bash %s/update-vps.sh --domain %s\n' "$REPO_DIR" "$DOMAIN"
