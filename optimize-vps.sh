#!/usr/bin/env bash
# Network and request-throughput tuning for the Matjary VPS.
#
#   sudo bash optimize-vps.sh              apply the tuning (asks for confirmation)
#   sudo bash optimize-vps.sh --dry-run    print the exact changes, touch nothing
#   sudo bash optimize-vps.sh --speed-test measure the link without changing it
#   sudo bash optimize-vps.sh --revert     restore the previous configuration
#   bash optimize-vps.sh --self-test       validate the renderers (no root needed)
#
# This removes local bottlenecks so the VPS can use the bandwidth it already
# pays for: congestion control, socket buffers, Nginx worker and cache limits,
# and the CPU governor. It cannot raise the provider's port speed, transfer
# allowance, or fair-use policy. Every modified file is backed up first, and a
# failed "nginx -t" rolls the whole change back automatically.
set +x
set -Eeuo pipefail
umask 077

usage() {
  cat <<'HELP'
Matjary VPS throughput tuning (Ubuntu 24.04 + CloudPanel Nginx + Docker)

  sudo bash optimize-vps.sh              apply, after typing TUNE
  sudo bash optimize-vps.sh --dry-run    print the changes only
  sudo bash optimize-vps.sh --revert     restore the last applied backup
  sudo bash optimize-vps.sh --speed-test measure interface and bandwidth
  bash optimize-vps.sh --self-test       validate renderers, change nothing

What apply changes:
  1. /etc/sysctl.d/99-matjary-network-tuning.conf
     BBR congestion control with fq queueing, 16 MiB socket buffers, larger
     accept backlog, wider ephemeral port range, TCP Fast Open, and a lower
     swappiness on hosts with enough memory.
  2. /etc/nginx/nginx.conf (a marked block, other settings untouched)
     worker_processes auto, 16384 worker connections, 65535 file descriptors,
     open-file cache for static assets, gzip level 5, and a shared media cache
     zone so published photos/videos leave the API process.
  3. A performance CPU governor where the VM exposes one, persisted through a
     small systemd oneshot unit.

The Nginx media cache starts working only once the published-media location
blocks printed by setup-vps.sh exist in this site's HTTPS vhost.

Never changed: databases, volumes, containers, application .env, TLS, firewall.
HELP
}

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
confirm() {
  local answer
  printf '\n%s\n' "$1"
  read -r -p "Type $2 to continue: " answer
  [[ "$answer" == "$2" ]] || die 'Canceled; confirmation did not match.'
}

NGINX_CONF=/etc/nginx/nginx.conf
SYSCTL_FILE=/etc/sysctl.d/99-matjary-network-tuning.conf
CACHE_DIR=/var/cache/nginx/matjary-media
BACKUP_ROOT=/var/backups/matjary-tuning
GOVERNOR_SCRIPT=/usr/local/sbin/matjary-cpu-governor
GOVERNOR_UNIT=/etc/systemd/system/matjary-cpu-governor.service
WORKER_CONNECTIONS=16384
WORKER_RLIMIT=65535
MARK_BEGIN='# BEGIN matjary-tuning (managed by optimize-vps.sh)'

TMP_ROOT=${TMPDIR:-/tmp}
TMP_ROOT=${TMP_ROOT%/}
TMP_DIR=''
BACKUP_DIR=''
MANIFEST=''
MEM_GIB=0
CONGESTION=''
QDISC=''
MEDIA_CACHE_SIZE=4g
MEDIA_CACHE_ZONE=0
NGINX_PRESENT=0
WORKER_USER=''
WORKER_GROUP=''
ROLLED_BACK=0

cleanup() {
  [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]] || return 0
  # Refuse to delete anything that is not our own mktemp directory.
  case "$TMP_DIR" in
    "$TMP_ROOT"/matjary-tuning.*) rm -rf -- "$TMP_DIR" ;;
  esac
}
trap cleanup EXIT

managed_path() {
  case "$1" in
    "$SYSCTL_FILE"|"$NGINX_CONF"|"$GOVERNOR_SCRIPT"|"$GOVERNOR_UNIT") return 0 ;;
    *) return 1 ;;
  esac
}

sysctl_value() {
  { sysctl -n "$1" 2>/dev/null || true; } | tr -s '[:space:]' ' '
}

check_sysctl() {
  local key=$1 expected=$2 actual
  actual=$(sysctl_value "$key")
  if [[ "$actual" == "$expected" ]]; then
    printf '    %-30s %s\n' "$key" "$actual"
    return 0
  fi
  printf '    %-30s %s (wanted %s)\n' "$key" "$actual" "$expected"
  return 1
}

nginx_value() {
  awk -v key="$1" '$1 == key { gsub(/;$/, "", $2); print $2; exit }' "$NGINX_CONF" 2>/dev/null || true
}

render_sysctl() {
  cat <<'SYSCTL'
# Managed by optimize-vps.sh. Values apply at boot; the live kernel was also
# updated by the run that created this file. Remove this file and reboot to
# return to distribution defaults.
SYSCTL
  if [[ -n "$QDISC" ]]; then
    cat <<'SYSCTL'
# fq paces packets for BBR and keeps queueing delay low under load.
net.core.default_qdisc = fq
SYSCTL
  fi
  if [[ -n "$CONGESTION" ]]; then
    cat <<SYSCTL
# BBR keeps throughput on lossy or long-distance links better than cubic.
net.ipv4.tcp_congestion_control = $CONGESTION
SYSCTL
  fi
  cat <<'SYSCTL'
# Socket buffers sized for a 1 Gbit/s port with ~100 ms round trips. Only
# sockets that need the window grow into these maxima.
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 131072 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
# Keep windows growing after idle and let both sides use TCP Fast Open.
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5
# Accept visitor bursts instead of dropping SYNs.
net.core.somaxconn = 8192
net.ipv4.tcp_max_syn_backlog = 8192
net.core.netdev_max_backlog = 16384
# More loopback/proxy sockets and faster reuse of closed connections.
net.ipv4.ip_local_port_range = 10240 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
SYSCTL
  if (( MEM_GIB >= 6 )); then
    cat <<'SYSCTL'
# Keep hot caches resident; containers already have hard memory limits.
vm.swappiness = 10
vm.vfs_cache_pressure = 50
SYSCTL
  fi
}

# HTTP-context directives for the marked block in nginx.conf. Duplicating a
# value CloudPanel already sets is allowed by Nginx and simply wins here.
render_http_tuning() {
  cat <<'NGINX'
# Connection handling and static-file caching for a busy showcase site.
sendfile on;
tcp_nopush on;
tcp_nodelay on;
keepalive_timeout 65s;
keepalive_requests 10000;
reset_timedout_connection on;
client_body_buffer_size 128k;
client_header_buffer_size 8k;
large_client_header_buffers 4 16k;
output_buffers 4 64k;
server_names_hash_bucket_size 128;
open_file_cache max=20000 inactive=60s;
open_file_cache_valid 60s;
open_file_cache_min_uses 2;
open_file_cache_errors on;
gzip on;
gzip_vary on;
gzip_comp_level 5;
NGINX
  if (( MEDIA_CACHE_ZONE == 1 )); then
    printf '# proxy_cache_path for matjary_media is already defined elsewhere.\n'
  else
    printf 'proxy_cache_path %s levels=1:2 keys_zone=matjary_media:64m max_size=%s inactive=2d use_temp_path=off;\n' \
      "$CACHE_DIR" "$MEDIA_CACHE_SIZE"
  fi
}

# Rewrite nginx.conf in place-preserving form: only the main-context limits,
# the events block, and one marked http block change. Running it twice on its
# own output produces byte-identical text, so repeated tuning is safe.
render_nginx_conf() {
  local source=$1 target=$2 http_file=$3 connections=$4 rlimit=$5
  python3 - "$source" "$target" "$http_file" "$connections" "$rlimit" "${MARK_BEGIN%% (*}" <<'PY'
import re
import sys

source, target, http_file, connections, rlimit, mark_begin = sys.argv[1:7]
text = open(source, encoding='utf-8').read()
original = text

if not re.search(r'(?m)^[ \t]*http[ \t]*\{', text):
    sys.exit('nginx.conf has no http { } block')

text, replaced = re.subn(
    r'(?m)^([ \t]*)worker_processes[ \t]+[^;]+;',
    r'\1worker_processes auto;',
    text,
    count=1,
)
if replaced == 0:
    text = 'worker_processes auto;\n' + text

rlimit_line = 'worker_rlimit_nofile %s;' % rlimit
text, replaced = re.subn(
    r'(?m)^([ \t]*)worker_rlimit_nofile[ \t]+[^;]+;',
    r'\1' + rlimit_line,
    text,
    count=1,
)
if replaced == 0:
    anchor = re.search(r'(?m)^[ \t]*worker_processes[^\n]*\n', text)
    text = text[:anchor.end()] + rlimit_line + '\n' + text[anchor.end():]

events = (
    'events {\n'
    '    worker_connections %s;\n'
    '    multi_accept on;\n'
    '    use epoll;\n'
    '}' % connections
)
if re.search(r'(?m)^[ \t]*events[ \t]*\{[^}]*\}', text):
    text = re.sub(r'(?m)^[ \t]*events[ \t]*\{[^}]*\}', events, text, count=1)
else:
    anchor = re.search(r'(?m)^[ \t]*http[ \t]*\{', text)
    text = text[:anchor.start()] + events + '\n\n' + text[anchor.start():]

body = open(http_file, encoding='utf-8').read().strip().splitlines()
block = [mark_begin, *body, '# END matjary-tuning']
indented = '\n'.join('    ' + row if row else '' for row in block)
existing = re.compile(
    r'(?ms)^[ \t]*# BEGIN matjary-tuning[^\n]*\n.*?^[ \t]*# END matjary-tuning\n?'
)
if existing.search(text):
    text = existing.sub(indented + '\n', text, count=1)
else:
    anchor = re.search(r'(?m)^[ \t]*http[ \t]*\{[^\n]*\n', text)
    text = text[:anchor.end()] + indented + '\n' + text[anchor.end():]

with open(target, 'w', encoding='utf-8', newline='\n') as output:
    output.write(text)
print('changed' if text != original else 'unchanged')
PY
}

# True when the media cache zone is defined outside our marked block, so a
# second run does not duplicate proxy_cache_path and break "nginx -t".
zone_exists() {
  local conf=$1
  [[ -r "$conf" ]] || return 1
  python3 - "$conf" <<'PY'
import re
import sys

text = open(sys.argv[1], encoding='utf-8').read()
text = re.sub(
    r'(?ms)^[ \t]*# BEGIN matjary-tuning[^\n]*\n.*?^[ \t]*# END matjary-tuning\n?',
    '',
    text,
)
sys.exit(0 if 'keys_zone=matjary_media' in text else 1)
PY
}

detect_tcp() {
  local available
  available=$(cat /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null || true)
  # A dry run must not load modules or touch kernel state.
  if (( EUID == 0 && ! DRY_RUN )); then
    if ! grep -qw bbr <<< "$available"; then
      modprobe tcp_bbr >/dev/null 2>&1 || true
      available=$(cat /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null || true)
    fi
    modprobe sch_fq >/dev/null 2>&1 || true
  fi
  CONGESTION=''
  if grep -qw bbr <<< "$available"; then
    CONGESTION=bbr
  fi
  QDISC=''
  if [[ -e /proc/sys/net/core/default_qdisc ]]; then
    QDISC=fq
  fi
}

detect_system() {
  MEM_GIB=$(awk '/^MemTotal:/ { printf "%.0f", $2 / 1048576 }' /proc/meminfo 2>/dev/null || printf '0')
  [[ -n "$MEM_GIB" ]] || MEM_GIB=0
  detect_tcp
  NGINX_PRESENT=0
  if command -v nginx >/dev/null 2>&1 && [[ -r "$NGINX_CONF" ]]; then
    NGINX_PRESENT=1
    # CloudPanel always uses a real file, but resolve a symlinked config so the
    # backup and the edit always target the same inode.
    local resolved
    resolved=$(readlink -f -- "$NGINX_CONF" 2>/dev/null || true)
    if [[ -n "$resolved" ]]; then
      NGINX_CONF=$resolved
    fi
    WORKER_USER=$(nginx_value user)
    if [[ -z "$WORKER_USER" ]] || ! id "$WORKER_USER" >/dev/null 2>&1; then
      if id www-data >/dev/null 2>&1; then
        WORKER_USER=www-data
      elif id nobody >/dev/null 2>&1; then
        WORKER_USER=nobody
      else
        WORKER_USER=root
      fi
    fi
    WORKER_GROUP=$(id -gn "$WORKER_USER")
    local free_gb
    free_gb=$(df -Pk /var 2>/dev/null | awk 'NR == 2 { printf "%.0f", $4 / 1048576 }' || true)
    [[ -n "$free_gb" ]] || free_gb=0
    if (( free_gb < 10 )); then
      MEDIA_CACHE_SIZE=1g
    else
      MEDIA_CACHE_SIZE=4g
    fi
    MEDIA_CACHE_ZONE=0
    if zone_exists "$NGINX_CONF" || grep -rqs 'keys_zone=matjary_media' \
      /etc/nginx/conf.d /etc/nginx/sites-enabled /etc/nginx/snippets 2>/dev/null; then
      MEDIA_CACHE_ZONE=1
    fi
  fi
}

show_plan() {
  printf '\nMatjary VPS throughput tuning\n\n'
  printf '  System   %s %s, %s vCPU, %s GiB RAM, %s GiB free on /\n' \
    "$(uname -s)" "$(uname -r)" "$(nproc 2>/dev/null || printf '?')" \
    "$MEM_GIB" "$(df -Pk / | awk 'NR == 2 { printf "%.0f", $4 / 1048576 }')"
  if (( NGINX_PRESENT )); then
    local connections rlimit
    connections=$(nginx_value worker_connections || true)
    rlimit=$(nginx_value worker_rlimit_nofile || true)
    printf '  Nginx    worker_connections %s, worker_rlimit_nofile %s, worker user %s\n' \
      "${connections:-default}" "${rlimit:-unset}" "$WORKER_USER"
  else
    printf '  Nginx    not detected; only kernel settings will change\n'
  fi
  printf '  TCP      %s congestion control, %s queueing\n' \
    "$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || printf '?')" \
    "$(sysctl -n net.core.default_qdisc 2>/dev/null || printf '?')"
  printf '\nPlanned changes\n'
  printf '  Kernel   BBR + fq, 16 MiB buffers, 8192 accept backlog, TCP Fast Open\n'
  printf '           in %s\n' "$SYSCTL_FILE"
  if (( NGINX_PRESENT )); then
    printf '  Nginx    worker_processes auto, %s connections, %s file descriptors\n' \
      "$WORKER_CONNECTIONS" "$WORKER_RLIMIT"
    printf '           open-file cache, gzip 5, media cache zone (%s)\n' "$MEDIA_CACHE_SIZE"
  fi
  if command -v systemctl >/dev/null 2>&1 && governor_available; then
    printf '  CPU      performance governor, persisted with matjary-cpu-governor.service\n'
  fi
}

print_changes() {
  printf '\n--- %s ---\n' "$SYSCTL_FILE"
  render_sysctl
  if (( NGINX_PRESENT )); then
    printf '\n--- http block added to %s ---\n' "$NGINX_CONF"
    render_http_tuning
    printf '\n--- main context ---\n'
    printf 'worker_processes auto;\nworker_rlimit_nofile %s;\nevents {\n    worker_connections %s;\n    multi_accept on;\n    use epoll;\n}\n' \
      "$WORKER_RLIMIT" "$WORKER_CONNECTIONS"
  fi
  printf '\n--- CPU governor ---\n'
  if command -v systemctl >/dev/null 2>&1 && governor_available; then
    printf '%s\n%s\n' "$GOVERNOR_SCRIPT" "$GOVERNOR_UNIT"
  else
    printf 'not applicable on this VM\n'
  fi
}

governor_available() {
  local file
  for file in /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_available_governors; do
    [[ -r "$file" ]] || continue
    if grep -qw performance "$file"; then
      return 0
    fi
  done
  return 1
}

backup_file() {
  local path=$1 name
  name=$(basename -- "$path")
  if [[ -e "$path" || -L "$path" ]]; then
    cp -a -- "$path" "$BACKUP_DIR/$name"
    printf 'restore\t%s\t%s\n' "$path" "$name" >> "$MANIFEST"
  else
    printf 'delete\t%s\t-\n' "$path" >> "$MANIFEST"
  fi
}

apply_sysctl() {
  render_sysctl > "$TMP_DIR/sysctl.conf"
  install -m 0644 "$TMP_DIR/sysctl.conf" "$SYSCTL_FILE.next"
  mv -f -- "$SYSCTL_FILE.next" "$SYSCTL_FILE"
  # Some virtualized kernels reject individual keys; verification below
  # reports exactly which ones took effect instead of aborting midway.
  sysctl -q -p "$SYSCTL_FILE" >/dev/null 2>&1 || true
  apply_qdisc_live
}

# fq only applies to newly created qdiscs, so replace the live root qdisc.
# Multi-queue (mq) and noqueue devices are left alone on purpose.
apply_qdisc_live() {
  (( EUID == 0 )) || return 0
  [[ "$QDISC" == fq ]] || return 0
  command -v tc >/dev/null 2>&1 || return 0
  local iface current
  iface=$(ip route get 1.1.1.1 2>/dev/null |
    awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }' || true)
  [[ -n "$iface" ]] || return 0
  current=$(tc qdisc show dev "$iface" 2>/dev/null | awk 'NR == 1 { print $2 }' || true)
  case "$current" in
    fq|mq|noqueue) return 0 ;;
  esac
  tc qdisc replace dev "$iface" root fq >/dev/null 2>&1 || true
}

apply_nginx() {
  (( NGINX_PRESENT )) || return 0
  if (( MEDIA_CACHE_ZONE == 0 )); then
    install -d -m 0700 "$CACHE_DIR"
    # Only the top directory is fixed up: Nginx creates the level directories
    # itself and already owns them after the first write.
    chown "$WORKER_USER":"$WORKER_GROUP" "$CACHE_DIR" 2>/dev/null || true
  fi
  render_http_tuning > "$TMP_DIR/http.conf"
  if ! render_nginx_conf "$NGINX_CONF" "$TMP_DIR/nginx.conf.new" \
    "$TMP_DIR/http.conf" "$WORKER_CONNECTIONS" "$WORKER_RLIMIT" >/dev/null; then
    rollback
    die 'nginx.conf could not be rewritten; nothing was kept.'
  fi
  install -m 0644 "$TMP_DIR/nginx.conf.new" "$NGINX_CONF.next"
  mv -f -- "$NGINX_CONF.next" "$NGINX_CONF"
  if ! nginx -t > "$TMP_DIR/nginx-test.log" 2>&1; then
    cat "$TMP_DIR/nginx-test.log" >&2
    rollback
    die 'nginx -t rejected the tuned configuration; the previous files were restored.'
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
    systemctl reload nginx || {
      rollback
      die 'Nginx reload failed; the previous configuration was restored.'
    }
  fi
}

apply_governor() {
  command -v systemctl >/dev/null 2>&1 || return 0
  governor_available || return 0
  local file needed=0
  for file in /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_governor; do
    [[ -w "$file" ]] || continue
    if [[ "$(cat "$file" 2>/dev/null || true)" != performance ]]; then
      needed=1
    fi
  done
  if (( ! needed )); then
    printf '\nCPU governor is already "performance"; no unit installed.\n'
    return 0
  fi
  backup_file "$GOVERNOR_SCRIPT"
  backup_file "$GOVERNOR_UNIT"
  cat > "$TMP_DIR/matjary-cpu-governor" <<'SH'
#!/bin/sh
# Re-apply the performance governor after boot; request handling and media
# encoding on this host benefit from keeping clocks high.
for file in /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_governor; do
  [ -w "$file" ] || continue
  grep -qw performance "${file%scaling_governor}scaling_available_governors" 2>/dev/null || continue
  printf '%s\n' performance > "$file" 2>/dev/null || true
done
SH
  install -m 0755 "$TMP_DIR/matjary-cpu-governor" "$GOVERNOR_SCRIPT"
  cat > "$TMP_DIR/matjary-cpu-governor.service" <<'UNIT'
[Unit]
Description=Set the CPU frequency governor to performance for Matjary
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/matjary-cpu-governor

[Install]
WantedBy=multi-user.target
UNIT
  install -m 0644 "$TMP_DIR/matjary-cpu-governor.service" "$GOVERNOR_UNIT"
  systemctl daemon-reload || true
  systemctl enable --now matjary-cpu-governor >/dev/null 2>&1 || true
  printf '\nCPU governor set to performance; matjary-cpu-governor.service re-applies it at boot.\n'
}

rollback() {
  local action path name
  (( ROLLED_BACK )) && return 0
  ROLLED_BACK=1
  # A unit enabled by this run must be disabled before its file disappears,
  # otherwise systemd keeps a broken enable symlink for the next boot.
  if [[ -n "$MANIFEST" && -f "$MANIFEST" ]] &&
    grep -qF "$GOVERNOR_UNIT" "$MANIFEST" && command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now matjary-cpu-governor >/dev/null 2>&1 || true
  fi
  if [[ -n "$MANIFEST" && -f "$MANIFEST" ]]; then
    while IFS=$'\t' read -r action path name; do
      managed_path "$path" || continue
      case "$action" in
        restore) cp -a -- "$BACKUP_DIR/$name" "$path" ;;
        delete) rm -f -- "$path" ;;
      esac
    done < "$MANIFEST"
  fi
  sysctl -q --system >/dev/null 2>&1 || true
  if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1 &&
    command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
    systemctl reload nginx >/dev/null 2>&1 || true
  fi
  command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload >/dev/null 2>&1 || true
}

verify() {
  local bad=0
  printf '\nVerification\n  Kernel\n'
  if [[ -n "$CONGESTION" ]]; then
    check_sysctl net.ipv4.tcp_congestion_control "$CONGESTION" || bad=1
  else
    printf '    %-30s %s\n' net.ipv4.tcp_congestion_control 'BBR unavailable in this kernel'
  fi
  if [[ -n "$QDISC" ]]; then
    check_sysctl net.core.default_qdisc "$QDISC" || bad=1
  fi
  check_sysctl net.core.somaxconn 8192 || bad=1
  check_sysctl net.ipv4.tcp_rmem '4096 131072 16777216' || bad=1
  if (( MEM_GIB >= 6 )); then
    check_sysctl vm.swappiness 10 || bad=1
  fi
  if (( NGINX_PRESENT )); then
    printf '  Nginx\n'
    if grep -q "worker_connections $WORKER_CONNECTIONS;" "$NGINX_CONF"; then
      printf '    %-30s %s\n' worker_connections "$WORKER_CONNECTIONS"
    else
      printf '    %-30s %s\n' worker_connections 'not applied'
      bad=1
    fi
    if nginx -t >/dev/null 2>&1; then
      printf '    %-30s %s\n' 'nginx -t' ok
    else
      printf '    %-30s %s\n' 'nginx -t' failed
      bad=1
    fi
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
      printf '    %-30s %s\n' 'nginx service' active
    else
      printf '    %-30s %s\n' 'nginx service' 'not active'
      bad=1
    fi
    if (( MEDIA_CACHE_ZONE == 0 )); then
      if [[ -d "$CACHE_DIR" ]]; then
        printf '    %-30s %s\n' 'media cache directory' "$CACHE_DIR"
      else
        printf '    %-30s %s\n' 'media cache directory' missing
        bad=1
      fi
    fi
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled --quiet matjary-cpu-governor 2>/dev/null; then
    printf '  CPU\n    %-30s %s\n' 'matjary-cpu-governor' enabled
  fi
  return "$bad"
}

apply() {
  detect_system
  show_plan
  if (( ! DRY_RUN )); then
    confirm 'Apply these changes to the running host now? Backups go to /var/backups/matjary-tuning.' TUNE
  fi
  if (( DRY_RUN )); then
    print_changes
    printf '\nDry run only; no file or kernel value was changed.\n'
    return 0
  fi

  # Never blame the tuning for a configuration that was already broken.
  if (( NGINX_PRESENT )) && ! nginx -t >/dev/null 2>&1; then
    die 'The current Nginx configuration is already invalid; fix "nginx -t" before tuning.'
  fi

  TMP_DIR=$(mktemp -d "$TMP_ROOT/matjary-tuning.XXXXXX")
  BACKUP_DIR=$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)
  MANIFEST=$BACKUP_DIR/manifest.tsv
  install -d -m 0700 "$BACKUP_ROOT" "$BACKUP_DIR"
  ln -sfn -- "$BACKUP_DIR" "$BACKUP_ROOT/latest"
  : > "$MANIFEST"

  backup_file "$SYSCTL_FILE"
  if (( NGINX_PRESENT )); then
    backup_file "$NGINX_CONF"
  fi

  # Any unexpected failure after this point restores the backed-up files.
  trap 'rollback' ERR

  printf '\nApplying kernel network settings...\n'
  apply_sysctl
  printf 'Applying Nginx connection and cache limits...\n'
  apply_nginx
  apply_governor
  trap - ERR

  if verify; then
    printf '\nAll checks passed. Backup kept at %s\n' "$BACKUP_DIR"
  else
    printf '\nSome values could not be applied; see the list above.\n'
    printf 'Backup kept at %s; undo with: sudo bash %s --revert\n' "$BACKUP_DIR" "$0"
  fi
  cat <<'NEXT'

Next steps
  - The media cache serves published photos and videos only after the
    /api/v1/uploads/ location blocks from setup-vps.sh exist in this site's
    HTTPS vhost. Without them every byte still goes through the API.
  - Keep MEDIA_PUBLIC_CACHE_SECONDS above zero so browsers revalidate less.
  - Enable HTTP/3 for the site in CloudPanel when the panel offers it.
  - Undo later with: sudo bash optimize-vps.sh --revert
  - Re-measure with: sudo bash optimize-vps.sh --speed-test
NEXT
}

revert() {
  [[ -d "$BACKUP_ROOT/latest" || -L "$BACKUP_ROOT/latest" ]] ||
    die 'No backup found under /var/backups/matjary-tuning.'
  local dir
  dir=$(readlink -f -- "$BACKUP_ROOT/latest") ||
    die 'The latest backup link is unreadable.'
  case "$dir" in
    "$BACKUP_ROOT"/*) ;;
    *) die 'The latest backup link points outside /var/backups/matjary-tuning.' ;;
  esac
  [[ -f "$dir/manifest.tsv" ]] || die 'The latest backup has no manifest.'
  BACKUP_DIR=$dir
  MANIFEST=$dir/manifest.tsv
  printf '\nRestoring files recorded in %s\n' "$MANIFEST"
  confirm 'Remove the tuning and restore the previous configuration?' REVERT
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now matjary-cpu-governor >/dev/null 2>&1 || true
  fi
  rollback
  printf '\nPrevious configuration restored.\n'
  printf 'Kernel network values return to their boot defaults after a reboot; the\n'
  printf 'restored sysctl files apply now through "sysctl --system".\n'
  printf 'The backup directory was kept at %s\n' "$BACKUP_DIR"
}

speed_test() {
  command -v curl >/dev/null 2>&1 || die 'curl is required for --speed-test.'
  local iface='' link='' result speed elapsed
  printf '\nNetwork probe\n'
  if command -v ip >/dev/null 2>&1; then
    iface=$(ip route get 1.1.1.1 2>/dev/null |
      awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }' || true)
  fi
  printf '  Interface   %s\n' "${iface:-unknown}"
  if [[ -n "$iface" ]] && command -v ethtool >/dev/null 2>&1; then
    link=$(ethtool "$iface" 2>/dev/null | awk -F': ' '/Speed:/ { print $2; exit }')
    [[ -n "$link" ]] && printf '  Link speed  %s\n' "$link"
  fi
  printf '  TCP         %s / %s\n' \
    "$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || printf '?')" \
    "$(sysctl -n net.core.default_qdisc 2>/dev/null || printf '?')"
  printf '  Probing download (100 MB)...\n'
  result=$(curl -fsSL --max-time 120 -o /dev/null -w '%{speed_download} %{time_total}' \
    'https://speed.cloudflare.com/__down?bytes=104857600') ||
    die 'Download probe failed; check outbound HTTPS access.'
  speed=${result%% *}
  elapsed=${result##* }
  awk -v s="$speed" -v t="$elapsed" \
    'BEGIN { printf "  Download    %.1f MB/s (%.0f Mbit/s) in %.1f s\n", s / 1048576, s * 8 / 1000000, t }'
  local payload
  payload=$(mktemp "$TMP_ROOT/matjary-upload.XXXXXX")
  if dd if=/dev/zero of="$payload" bs=1M count=20 status=none 2>/dev/null; then
    printf '  Probing upload (20 MB)...\n'
    if result=$(curl -fsS --max-time 120 -o /dev/null -w '%{speed_upload} %{time_total}' \
      --data-binary "@$payload" 'https://speed.cloudflare.com/__up'); then
      speed=${result%% *}
      elapsed=${result##* }
      awk -v s="$speed" -v t="$elapsed" \
        'BEGIN { printf "  Upload      %.1f MB/s (%.0f Mbit/s) in %.1f s\n", s / 1048576, s * 8 / 1000000, t }'
    else
      printf '  Upload      probe unavailable\n'
    fi
  fi
  rm -f -- "$payload"
  if [[ -d "$CACHE_DIR" ]]; then
    printf '  Media cache %s\n' "$(du -sh "$CACHE_DIR" 2>/dev/null | awk '{ print $1 }')"
  fi
  if command -v ss >/dev/null 2>&1; then
    printf '  Sockets     %s\n' "$(ss -s 2>/dev/null | awk '/^TCP:/ { print $0 }')"
  fi
}

self_test() {
  command -v python3 >/dev/null 2>&1 || die 'python3 is required for --self-test.'
  TMP_DIR=$(mktemp -d "$TMP_ROOT/matjary-tuning.XXXXXX")
  local fixture=$TMP_DIR/nginx.conf
  CONGESTION=bbr
  QDISC=fq
  MEM_GIB=8
  MEDIA_CACHE_SIZE=4g
  MEDIA_CACHE_ZONE=0
  CACHE_DIR=/var/cache/nginx/matjary-media

  cat > "$fixture" <<'EOF'
user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
	worker_connections 768;
	# multi_accept on;
}

http {
	sendfile on;
	include /etc/nginx/conf.d/*.conf;
	include /etc/nginx/sites-enabled/*;
}
EOF

  render_http_tuning > "$TMP_DIR/http.conf"
  render_nginx_conf "$fixture" "$TMP_DIR/out1.conf" "$TMP_DIR/http.conf" \
    "$WORKER_CONNECTIONS" "$WORKER_RLIMIT" >/dev/null
  grep -q "worker_connections $WORKER_CONNECTIONS;" "$TMP_DIR/out1.conf" ||
    die 'Events block was not tuned.'
  grep -q 'multi_accept on;' "$TMP_DIR/out1.conf" || die 'multi_accept missing.'
  grep -q 'use epoll;' "$TMP_DIR/out1.conf" || die 'epoll missing.'
  grep -q "worker_rlimit_nofile $WORKER_RLIMIT;" "$TMP_DIR/out1.conf" ||
    die 'worker_rlimit_nofile missing.'
  grep -q 'keys_zone=matjary_media:64m' "$TMP_DIR/out1.conf" ||
    die 'Media cache zone missing.'
  [[ $(grep -c 'BEGIN matjary-tuning' "$TMP_DIR/out1.conf" || true) == 1 ]] ||
    die 'Marked block must appear exactly once.'

  render_nginx_conf "$TMP_DIR/out1.conf" "$TMP_DIR/out2.conf" "$TMP_DIR/http.conf" \
    "$WORKER_CONNECTIONS" "$WORKER_RLIMIT" >/dev/null
  cmp -s "$TMP_DIR/out1.conf" "$TMP_DIR/out2.conf" ||
    die 'Tuning is not idempotent.'

  sed -e 's/worker_connections 16384;/worker_connections 512;/' \
    -e 's/worker_rlimit_nofile 65535;/worker_rlimit_nofile 1024;/' \
    "$TMP_DIR/out1.conf" > "$TMP_DIR/out3.conf"
  render_nginx_conf "$TMP_DIR/out3.conf" "$TMP_DIR/out4.conf" "$TMP_DIR/http.conf" \
    "$WORKER_CONNECTIONS" "$WORKER_RLIMIT" >/dev/null
  grep -q "worker_connections $WORKER_CONNECTIONS;" "$TMP_DIR/out4.conf" ||
    die 'Re-tuning did not restore worker_connections.'
  grep -q "worker_rlimit_nofile $WORKER_RLIMIT;" "$TMP_DIR/out4.conf" ||
    die 'Re-tuning did not restore worker_rlimit_nofile.'
  [[ $(grep -c 'BEGIN matjary-tuning' "$TMP_DIR/out4.conf" || true) == 1 ]] ||
    die 'Re-tuning duplicated the marked block.'

  printf 'user www-data;\nevents { worker_connections 64; }\n' > "$TMP_DIR/nohttp.conf"
  if render_nginx_conf "$TMP_DIR/nohttp.conf" "$TMP_DIR/nohttp.out" \
    "$TMP_DIR/http.conf" "$WORKER_CONNECTIONS" "$WORKER_RLIMIT" >/dev/null 2>&1; then
    die 'A config without an http block must be rejected.'
  fi

  printf 'keys_zone=matjary_media:64m;\n' > "$TMP_DIR/zone.conf"
  zone_exists "$TMP_DIR/zone.conf" || die 'Existing media zone not detected.'
  printf 'proxy_cache off;\n' > "$TMP_DIR/nozone.conf"
  if zone_exists "$TMP_DIR/nozone.conf"; then
    die 'Missing media zone reported as present.'
  fi
  cp "$TMP_DIR/out1.conf" "$TMP_DIR/marked-zone.conf"
  if zone_exists "$TMP_DIR/marked-zone.conf"; then
    die 'Our own marked block must not count as an existing zone.'
  fi

  render_sysctl > "$TMP_DIR/sysctl.conf"
  grep -qx 'net.ipv4.tcp_congestion_control = bbr' "$TMP_DIR/sysctl.conf" ||
    die 'BBR line missing.'
  grep -qx 'net.core.somaxconn = 8192' "$TMP_DIR/sysctl.conf" ||
    die 'Backlog line missing.'
  if grep -q 'tcp_notsent_lowat' "$TMP_DIR/sysctl.conf"; then
    die 'tcp_notsent_lowat must stay unset; it caps throughput on high-RTT links.'
  fi

  managed_path "$SYSCTL_FILE" || die 'Managed path rejected.'
  managed_path "$NGINX_CONF" || die 'Managed path rejected.'
  if managed_path /etc/passwd; then
    die 'Refusing to treat /etc/passwd as a managed file.'
  fi

  printf 'Renderer and safety self-tests passed. No system file was changed.\n'
}

MODE=apply
DRY_RUN=0
while (( $# )); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --self-test) self_test; exit 0 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --revert) MODE=revert; shift ;;
    --speed-test) MODE=speed; shift ;;
    *) die "Unknown option: $1 (use --help)" ;;
  esac
done

[[ $(uname -s) == Linux ]] || die 'Run this on the Linux VPS, not Windows.'
command -v python3 >/dev/null 2>&1 ||
  die 'python3 is required; CloudPanel and Ubuntu install it by default.'

case "$MODE" in
  speed)
    TMP_DIR=$(mktemp -d "$TMP_ROOT/matjary-tuning.XXXXXX")
    speed_test
    ;;
  revert)
    (( EUID == 0 )) || die 'Run with sudo bash optimize-vps.sh --revert.'
    [[ -t 0 ]] || die 'An interactive terminal is required for --revert.'
    revert
    ;;
  *)
    if (( DRY_RUN )); then
      apply
    else
      (( EUID == 0 )) || die 'Run with sudo bash optimize-vps.sh.'
      [[ -t 0 ]] || die 'An interactive terminal is required for setup confirmations.'
      apply
    fi
    ;;
esac
