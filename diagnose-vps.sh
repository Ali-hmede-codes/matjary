#!/usr/bin/env bash
# Read-only resource forensics for the Matjary VPS.
#
#   sudo bash diagnose-vps.sh                                  sample 15 min, then report
#   sudo bash diagnose-vps.sh --duration 3600 --interval 10    a longer, cheaper window
#   sudo bash diagnose-vps.sh --snapshot                       one pass of the whole state
#   bash   diagnose-vps.sh --report /var/tmp/matjary-diag.XXX  re-summarize a capture
#   bash   diagnose-vps.sh --self-test                         validate the parser, change nothing
#
# Answers "why does usage climb to ~50% and then fall back to 15%": it records per-core CPU,
# iowait and steal, memory/swap, per-disk utilisation, pressure stall information, per-process
# CPU, the four containers, and the media queue/outbox counters on one timeline, then reports
# which of them tracks the host peaks, whether the spikes repeat on a fixed cadence, and which
# setting in this repository is responsible.
#
# It never writes to the application, containers, kernel, Nginx, or the database. Sampling is
# cumulative /proc reads plus a small number of nice'd subprocesses, so the tool does not
# manufacture the spike it is measuring. Database and Redis counters are read inside their own
# containers, where the credentials already live: no password crosses the host command line and
# nothing printed here is a secret. The capture holds only counters, process names, container
# names, and queue lengths, so it is safe to keep; delete it when done:
#   rm -rf /var/tmp/matjary-diag.*
set +x
set -Eeuo pipefail
umask 077

usage() {
  cat <<'HELP'
Matjary VPS resource forensics (Ubuntu 24.04 + CloudPanel Nginx + Docker)

  sudo bash diagnose-vps.sh                 sample the default window, print a report
  sudo bash diagnose-vps.sh --snapshot      single full-state pass, no loop
  sudo bash diagnose-vps.sh --report DIR    re-render a saved capture (no root needed)
  sudo bash diagnose-vps.sh --self-test     validate the parser on synthetic data
  bash diagnose-vps.sh --help               this text

Sampling options (combine freely)
  --duration SECONDS   how long to keep sampling          (default 900, max 21600)
  --interval SECONDS   gap between ticks                  (default 5, min 2)
  --docker-every N     capture docker stats every N ticks (default 2)
  --db-every N         capture queue/database counters
                       every N ticks                      (default 12)
  --no-db              skip database and Redis reads entirely
  --dir PATH           capture directory
                       (default /var/tmp/matjary-diag.<UTC stamp>)

Why the numbers differ per run
  --duration 900 --interval 5 spans three 5-minute sweeps and seven share-shell passes, which
  is enough for the periodicity check. Use --duration 3600 to also cover the hourly share-shell
  reconciliation. Ctrl-C stops early and still prints the report for what was collected.
HELP
}

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

MODE=sample
DURATION=900
INTERVAL=5
DOCKER_EVERY=2
DB_EVERY=12
READ_DB=1
DIR=''
SELFTEST_TMP=''
STOP=0
MYSQL_C=''
REDIS_C=''
DB_NAME=''

cleanup() {
  [[ -n "$SELFTEST_TMP" && -d "$SELFTEST_TMP" ]] || return 0
  case "$SELFTEST_TMP" in
    /tmp/matjary-diag-selftest.* | "${TMPDIR:-/tmp}"/matjary-diag-selftest.*)
      rm -rf -- "$SELFTEST_TMP" ;;
  esac
}
trap cleanup EXIT

# ---------------------------------------------------------------- host facts

nproc_or_default() { local n; n=$(nproc 2>/dev/null || true); printf '%s' "${n:-1}"; }

# Find the database and Redis containers by role, so their own environments can
# answer for the queue counters. Names are matched on the suffix compose
# generates (matjary-mysql-1), so a renamed compose project is still found.
detect_containers() {
  command -v docker >/dev/null 2>&1 || return 0
  docker info >/dev/null 2>&1 || return 0
  local id name
  while read -r id name; do
    [[ -n "$id" && -n "$name" ]] || continue
    case "${name,,}" in
      *mysql* | *mariadb*) [[ -z "$MYSQL_C" ]] && MYSQL_C=$name ;;
      *redis*) [[ -z "$REDIS_C" ]] && REDIS_C=$name ;;
    esac
  done < <(nice -n 19 docker ps --format '{{.ID}} {{.Names}}' 2>/dev/null || true)
  # The schema name comes from the container's own env, never from the host, so
  # a non-default MYSQL_DATABASE is queried correctly and nothing is printed.
  if [[ -n "$MYSQL_C" ]]; then
    DB_NAME=$(nice -n 19 docker exec "$MYSQL_C" printenv MYSQL_DATABASE 2>/dev/null || true)
    [[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || DB_NAME=''
  fi
}

write_facts() {
  local out=$1
  {
    printf 'captured_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'kernel=%s\n' "$(uname -r)"
    printf 'arch=%s\n' "$(uname -m)"
    printf 'vcpu=%s\n' "$(nproc_or_default)"
    printf 'model=%s\n' "$(awk -F': ' '/model name/ { print $2; exit }' /proc/cpuinfo 2>/dev/null || true)"
    printf 'jiffies_per_second=%s\n' "$(getconf CLK_TCK 2>/dev/null || printf '100')"
    printf 'swap_total_kb=%s\n' "$(awk '/SwapTotal/ { print $2 }' /proc/meminfo)"
    printf 'docker=%s\n' "$(docker --version 2>/dev/null || printf 'absent')"
    printf 'nginx_service=%s\n' "$(systemctl is-active nginx 2>/dev/null || printf 'unknown')"
    printf 'page_size=%s\n' "$(getconf PAGESIZE 2>/dev/null || printf '4096')"
  } > "$out/host.txt" 2>/dev/null || true

  # Container limits, field-whitelisted: Env is never read because it holds
  # database credentials. RestartCount reveals a restart inside the window.
  {
    local id name values
    while read -r id name; do
      [[ -n "$id" && -n "$name" ]] || continue
      values=$(nice -n 19 docker inspect -f \
        '{{.HostConfig.NanoCpus}} {{.Config.Memory}} {{.RestartCount}}' \
        "$id" 2>/dev/null || printf '0 0 0')
      printf '%s\t%s\n' "$name" "$values"
    done < <(nice -n 19 docker ps --format '{{.ID}} {{.Names}}' 2>/dev/null || true)
  } > "$out/limits.txt" 2>/dev/null || true

  # Container id to name, so a process can be labelled with the service it ran
  # in. Only the id prefix and the name are kept; no environment is read.
  {
    local id name
    while read -r id name; do
      [[ -n "$id" && -n "$name" ]] || continue
      printf '%s\t%s\n' "${id:0:12}" "$name"
    done < <(nice -n 19 docker ps --format '{{.ID}} {{.Names}}' 2>/dev/null || true)
  } > "$out/containers.txt" 2>/dev/null || true

  # Filesystem layout for the live and archive media volumes, without touching
  # either: used only to pick which block devices matter.
  {
    nice -n 19 df -hP / /var/lib/matjary/media /var/lib/matjary/media-archive /var/lib/mysql 2>/dev/null ||
      nice -n 19 df -hP /
  } > "$out/disk.txt" 2>/dev/null || true
}

# ------------------------------------------------------------------ sampling

# Every reader below is a shell builtin: /proc is copied field by field instead
# of spawning cat/grep per tick, so the sampler costs a fraction of one core.
cpu_tick() {
  local line
  if read -r line < /proc/stat; then printf '%s\n' "$line"; fi
}

mem_tick() {
  local key value unit
  while read -r key value unit; do
    case "$key" in
      MemTotal: | MemAvailable: | Buffers: | Cached: | SReclaimable: | Shmem: | \
        SwapTotal: | SwapFree: | Dirty: | Writeback: | InodePages: | Committed_AS:)
          printf '%s %s\n' "$key" "$value" ;;
    esac
  done < /proc/meminfo
}

vm_tick() {
  local key value
  while read -r key value; do
    case "$key" in
      pswpin | pswpout | pgpgin | pgpgout | pgmajfault | compact_stall | oom_kill)
        printf '%s %s\n' "$key" "$value" ;;
    esac
  done < /proc/vmstat
}

load_tick() {
  local line
  if read -r line < /proc/loadavg; then printf '%s\n' "$line"; fi
  if read -r line < /proc/uptime; then printf 'uptime %s\n' "$line"; fi
}

disk_tick() {
  # Whole lines are kept; partitions duplicate their parent's counters, so the
  # report chooses which devices to sum.
  cat /proc/diskstats
}

pressure_tick() {
  local file
  for file in /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io; do
    [[ -r $file ]] || continue
    printf '# %s\n' "${file##*/}"
    cat "$file"
  done
}

# pid, command name, cumulative utime/stime, cgroup container id, process start
# time. The start time is what makes a reused pid impossible to confuse.
# The id prefix lets the report label a process with the container it belongs
# to. Both cgroup layouts are handled: docker-<id>.scope (v2) and /docker/<id>.
procs_tick() {
  local file line pid rest tail comm utime stime starttime cgroup cid t
  for file in /proc/[0-9]*/stat; do
    [[ -r $file ]] || continue
    read -r line < "$file" || continue
    pid=${line%% *}
    rest=${line#"$pid "}
    # Everything after the last ") " survives a command name containing spaces
    # or parentheses, which is common for shell and container children.
    tail=${rest##*\) }
    comm=${rest%"$tail"}
    comm=${comm#\(}
    comm=${comm%\) }
    read -ra t <<< "$tail"
    utime=${t[11]:-}
    stime=${t[12]:-}
    starttime=${t[19]:-}
    [[ -n $utime && -n $stime && -n $starttime ]] || continue
    cid=''
    if [[ -r ${file%stat}cgroup ]] && read -r cgroup < "${file%stat}cgroup"; then
      if [[ $cgroup =~ docker[-/]([0-9a-f]{12,64}) ]]; then
        cid=${BASH_REMATCH[1]:0:12}
      fi
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "${comm:0:32}" "$utime" "$stime" \
      "$starttime" "$cid"
  done
}

docker_tick() {
  command -v docker >/dev/null 2>&1 || return 0
  nice -n 19 docker stats --no-stream --format \
    '{{.Name}}\t{{.CPUPerc}}\t{{.MemPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlkIO}}' 2>/dev/null || true
}

# Read-only queue and database counters. The query text comes from a file the
# sampler wrote once, so no quoting gymnastics and no secret ever appears on a
# host command line: the credential is read from the container's own env.
db_tick() {
  [[ $READ_DB == 1 ]] || return 0
  if [[ -n "$MYSQL_C" && -n "$DB_NAME" && -r $DIR/query.sql ]]; then
    nice -n 19 timeout 10 docker exec -i "$MYSQL_C" sh -c \
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -N -B -u root "$MYSQL_DATABASE"' \
      < "$DIR/query.sql" 2>/dev/null || true
  fi
  if [[ -n "$REDIS_C" ]]; then
    nice -n 19 timeout 10 docker exec "$REDIS_C" sh -c '
      export REDISCLI_AUTH="$REDIS_PASSWORD"
      for key in bull:media-processing:wait bull:media-processing:active \
                 bull:media-processing:delayed bull:media-processing:failed \
                 bull:engagement:wait bull:engagement:active; do
        printf "bullmq %s %s\n" "$key" "$(redis-cli --no-auth-warning -N llen "$key" 2>/dev/null || printf NA)"
      done
      redis-cli --no-auth-warning info memory 2>/dev/null | tr -d "\r"
      redis-cli --no-auth-warning info persistence 2>/dev/null | tr -d "\r" | grep -E "^(aof_enabled|latest_fsync_usec):"
      redis-cli --no-auth-warning info stats 2>/dev/null | tr -d "\r" | grep -E "^(instantaneous_output_kbps|total_commands_processed):"' 2>/dev/null || true
  fi
}

tick() {
  local n=$1 dir out
  dir=$DIR/ticks/$(printf '%06d' "$n")
  mkdir -p "$dir"
  date -u +%s.%N > "$dir/ts.txt"
  cpu_tick > "$dir/cpu.txt"
  load_tick > "$dir/loadavg.txt"
  mem_tick > "$dir/meminfo.txt"
  vm_tick > "$dir/vmstat.txt"
  disk_tick > "$dir/diskstats.txt"
  pressure_tick > "$dir/pressure.txt"
  procs_tick > "$dir/procs.txt"
  if (( n % DOCKER_EVERY == 1 )); then
    out=$dir/docker.txt
    docker_tick > "$out" || true
  fi
  if (( n % DB_EVERY == 1 )); then
    out=$dir/db.txt
    db_tick > "$out" || true
  fi
}

run_window() {
  local start end now n=0 target
  start=$(date -u +%s)
  end=$((start + DURATION))
  printf '\nSampling %ss at %ss intervals into %s\n' "$DURATION" "$INTERVAL" "$DIR"
  printf 'Press Ctrl-C to stop early and report what was collected.\n'
  while true; do
    now=$(date -u +%s)
    (( now >= end )) && break
    (( STOP == 1 )) && break
    n=$((n + 1))
    tick "$n"
    # Sleep to the next boundary instead of drifting by the sampling cost.
    target=$((now + INTERVAL))
    now=$(date -u +%s)
    if (( target > now )); then
      sleep "$((target - now))" || true
    fi
  done
  printf 'Collected %s ticks.\n' "$n"
  (( n >= 2 )) || die 'Fewer than two ticks were collected; nothing to report.'
}

# The read-only query used by db_tick. Keeping it in a file avoids nested quoting
# and makes exactly one thing auditable: no statement here writes anything.
write_query() {
  cat > "$1/query.sql" <<'SQL'
SELECT 'media_status', status, COUNT(*) FROM media_assets GROUP BY status;
SELECT 'outbox', COUNT(*), COALESCE(TIMESTAMPDIFF(SECOND, MIN(created_at), NOW()), 0)
  FROM media_processing_outbox;
SELECT 'stories_active', COUNT(*), 0 FROM store_stories WHERE expires_at > NOW();
SHOW GLOBAL STATUS WHERE Variable_name IN
  ('Threads_connected','Threads_running','Com_select','Com_insert','Com_update',
   'Innodb_rows_read','Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads',
   'Innodb_data_written','Questions','Uptime');
SQL
  chmod 0600 "$1/query.sql" 2>/dev/null || true
}

# -------------------------------------------------------------------- report

report() {
  python3 - "$DIR" <<'PY'
"""Turn one capture directory into a resource diagnosis."""
import math
import os
import re
import sys


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""


def host_facts(capture):
    facts = {}
    for line in read(os.path.join(capture, "host.txt")).splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            facts[key] = value
    limits = {}
    for line in read(os.path.join(capture, "limits.txt")).splitlines():
        parts = line.split("\t")
        if len(parts) != 2:
            continue
        fields = parts[1].split() + ["0", "0", "0"]
        try:
            limits[parts[0]] = {
                "cpus": float(fields[0]) / 1e9,
                "mem_bytes": float(fields[1]),
                "restarts": int(float(fields[2])),
            }
        except ValueError:
            continue
    return facts, limits


def container_names(capture):
    """Container id prefix to name, used to label a process with its service."""
    out = {}
    for line in read(os.path.join(capture, "containers.txt")).splitlines():
        parts = line.split("\t")
        if len(parts) == 2:
            out[parts[0]] = parts[1]
    return out


def role(cid, names):
    name = names.get(cid)
    if not name:
        return "host"
    for part in name.split("-"):
        if part in ("api", "worker", "mysql", "redis", "phpmyadmin"):
            return part
    return name[:10]


def ticks(capture):
    root = os.path.join(capture, "ticks")
    if not os.path.isdir(root):
        return []
    out = []
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if not os.path.isdir(path):
            continue
        out.append((name, path))
    out.sort(key=lambda row: float(read(os.path.join(row[1], "ts.txt")).strip() or 0))
    return out


CPU_FIELDS = [
    "user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal",
]

# Cumulative MySQL and Redis counters: their window delta divided by the elapsed
# time is the real rate. Everything else sampled is a gauge and stays a maximum.
MYSQL_COUNTERS = {
    "Com_select", "Com_insert", "Com_update", "Questions", "Innodb_rows_read",
    "Innodb_buffer_pool_read_requests", "Innodb_buffer_pool_reads",
    "Innodb_data_written", "total_commands_processed",
}
BYTE_COUNTERS = {"Innodb_data_written"}

# Replaced by the host's real clock tick and core count before use.
CLK = 100.0
vcpu_total = 1.0


def parse_cpu(text):
    line = text.strip().splitlines()
    for row in line:
        if row.startswith("cpu "):
            values = row.split()[1:]
            return {
                name: float(value)
                for name, value in zip(CPU_FIELDS, values[: len(CPU_FIELDS)])
            }
    return {}


def parse_kv(text):
    out = {}
    for row in text.splitlines():
        parts = row.split()
        if len(parts) >= 2 and re.fullmatch(r"-?[\d.]+", parts[-1]):
            out[parts[0].rstrip(":")] = float(parts[-1])
    return out


def parse_procs(text):
    out = {}
    for row in text.splitlines():
        parts = row.split("\t")
        if len(parts) < 5:
            continue
        pid, comm, utime, stime = parts[0], parts[1], parts[2], parts[3]
        start = parts[4] if len(parts) > 4 else ""
        cid = parts[5] if len(parts) > 5 else ""
        try:
            out[(pid, start)] = {
                "comm": comm,
                "ticks": float(utime) + float(stime),
                "cid": cid,
            }
        except ValueError:
            continue
    return out


def parse_docker(text):
    out = {}
    units = {"B": 1, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4}

    def to_bytes(token):
        match = re.match(r"([\d.]+)\s*(\w+)", token.strip())
        if not match:
            return 0.0
        return float(match.group(1)) * units.get(match.group(2), 1)

    for row in text.splitlines():
        parts = row.split("\t")
        if len(parts) < 4:
            continue
        try:
            cpu = float(parts[1].rstrip("%"))
            used, _, quota = parts[3].partition("/")
            out[parts[0]] = {
                "cpu": cpu,
                "mem_used": to_bytes(used),
                "mem_quota": to_bytes(quota),
            }
        except ValueError:
            continue
    return out


def parse_db(text):
    """Media, outbox, MySQL status and Redis INFO lines from one dump.

    Anything that is not a number is dropped, so Redis *_human fields and
    section headers never reach the report.
    """
    state = {}

    def put(key, value):
        try:
            state[key] = float(value)
        except ValueError:
            return

    for row in text.splitlines():
        parts = row.split()
        if not parts or parts[0].startswith("#"):
            continue
        if parts[0] == "media_status" and len(parts) >= 3:
            put("media_" + parts[1], parts[2])
        elif parts[0] == "outbox" and len(parts) >= 3:
            put("outbox_rows", parts[1])
            put("outbox_oldest_seconds", parts[2])
        elif parts[0] == "stories_active" and len(parts) >= 2:
            put("stories_active", parts[1])
        elif parts[0] == "bullmq" and len(parts) >= 3:
            pieces = parts[1].split(":")
            put("queue_%s_%s" % (pieces[-2], pieces[-1]), parts[2])
        elif len(parts) == 1 and ":" in parts[0]:
            key, _, value = parts[0].partition(":")
            put(key, value)
        elif len(parts) == 2:
            put(parts[0], parts[1])
    return state


def percentile(values, fraction):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * fraction))))
    return ordered[index]


def pearson(a, b):
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < 4:
        return None
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    n = len(pairs)
    mx, my = sum(xs) / n, sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in pairs)
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 1e-9 or vy <= 1e-9:
        return None
    return cov / math.sqrt(vx * vy)


def autocorrelation(values, min_lag, max_lag):
    n = len(values)
    if n < max_lag * 2 or max_lag <= min_lag:
        return None, 0.0
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values)
    if var <= 1e-9:
        return None, 0.0
    best = (None, 0.0)
    for lag in range(min_lag, max_lag):
        num = sum((values[i] - mean) * (values[i + lag] - mean) for i in range(n - lag))
        den = sum((v - mean) ** 2 for v in values[: n - lag]) or 1e-9
        score = num / den
        if score > best[1]:
            best = (lag, score)
    return best


def series_from(capture_list):
    """Build every per-tick derived series by differencing cumulative counters."""
    rows = []
    previous = None
    for name, path in capture_list:
        stamp = float(read(os.path.join(path, "ts.txt")).strip() or 0)
        cpu = parse_cpu(read(os.path.join(path, "cpu.txt")))
        mem = parse_kv(read(os.path.join(path, "meminfo.txt")))
        vm = parse_kv(read(os.path.join(path, "vmstat.txt")))
        procs = parse_procs(read(os.path.join(path, "procs.txt")))
        docker = parse_docker(read(os.path.join(path, "docker.txt")))
        db = parse_db(read(os.path.join(path, "db.txt")))
        load = read(os.path.join(path, "loadavg.txt")).split()
        pressure = {}
        bucket = None
        for row in read(os.path.join(path, "pressure.txt")).splitlines():
            if row.startswith("# "):
                bucket = row[2:].strip()
            elif row and bucket and "=" in row:
                for part in row.split():
                    if part.startswith("avg10="):
                        pressure[f"{bucket}_avg10"] = float(part[6:])
        disk = {}
        for row in read(os.path.join(path, "diskstats.txt")).splitlines():
            parts = row.split()
            if len(parts) < 11:
                continue
            device = parts[2]
            if re.search(r"\d$", device) and not device.startswith("dm-"):
                continue
            if device.startswith(("loop", "ram", "zram", "fd")):
                continue
            disk[device] = {
                "read_sectors": float(parts[5]),
                "write_sectors": float(parts[9]),
                "io_ms": float(parts[12]),
            }
        rows.append(
            {
                "name": name,
                "ts": stamp,
                "cpu": cpu,
                "mem": mem,
                "vm": vm,
                "procs": procs,
                "docker": docker,
                "db": db,
                "pressure": pressure,
                "disk": disk,
                "load1": float(load[0]) if load else 0.0,
            }
        )
    ticks_out = []
    for index in range(1, len(rows)):
        before, now = rows[index - 1], rows[index]
        elapsed = now["ts"] - before["ts"]
        if elapsed <= 0:
            continue
        dcpu = {key: now["cpu"].get(key, 0.0) - before["cpu"].get(key, 0.0) for key in CPU_FIELDS}
        busy = dcpu["user"] + dcpu["nice"] + dcpu["system"] + dcpu["irq"] + dcpu["softirq"]
        total = busy + dcpu["idle"] + dcpu["iowait"]
        if total <= 0:
            continue
        entry = {
            "ts": now["ts"],
            "elapsed": elapsed,
            "cpu_total": 100 * busy / total,
            "cpu_user": 100 * dcpu["user"] / total,
            "cpu_system": 100 * dcpu["system"] / total,
            "cpu_iowait": 100 * dcpu["iowait"] / total,
            "cpu_steal": 100 * dcpu["steal"] / total,
            "load1": now["load1"],
            "mem_used_pct": (
                100 * (now["mem"]["MemTotal"] - now["mem"]["MemAvailable"]) / now["mem"]["MemTotal"]
                if now["mem"].get("MemTotal") and now["mem"].get("MemAvailable") is not None
                else None
            ),
            "swap_pages": (
                now["vm"].get("pswpin", 0) + now["vm"].get("pswpout", 0)
                - before["vm"].get("pswpin", 0)
                - before["vm"].get("pswpout", 0)
            ),
            "docker": now["docker"],
            "db": now["db"] if now["db"] else None,
            "pressure": now["pressure"],
            "disk": {},
            "procs": {},
            "proc_peak": {},
            "proc_seconds": {},
        }
        for device, values in now["disk"].items():
            old = before["disk"].get(device)
            if not old:
                continue
            entry["disk"][device] = {
                "util_pct": 100 * (values["io_ms"] - old["io_ms"]) / (elapsed * 1000),
                "mbytes_per_second": (
                    512 * ((values["read_sectors"] - old["read_sectors"]) +
                           (values["write_sectors"] - old["write_sectors"]))
                )
                / elapsed
                / 1024 / 1024,
            }
        for key, process in now["procs"].items():
            old = before["procs"].get(key)
            if not old:
                continue
            delta = process["ticks"] - old["ticks"]
            if delta < 0:
                continue
            cores = delta / CLK / elapsed
            entry["procs"][key] = {
                "comm": process["comm"],
                "cid": process["cid"],
                "cores": cores,
            }
            # Per-tick peak and total per command name, aligned with the host
            # series so a correlation compares the same ticks.
            share = 100 * cores / vcpu_total
            name = process["comm"]
            entry["proc_peak"][name] = max(entry["proc_peak"].get(name, 0.0), share)
            entry["proc_seconds"][name] = (
                entry["proc_seconds"].get(name, 0.0) + cores * elapsed
            )
        ticks_out.append(entry)
    return ticks_out


def summarize(samples, vcpu, names):
    """Rank what tracks the host peaks, then map it to a repository setting."""
    where = {}
    for row in samples:
        for process in row["procs"].values():
            where.setdefault(process["comm"], set()).add(process["cid"])
    totals = [row["cpu_total"] for row in samples]
    # The elapsed sum is the true covered window even when only two raw ticks
    # produced a single derived sample.
    span = sum(row["elapsed"] for row in samples)
    print("Host, measured over %s of sampling on %.0f vCPU" % (fmt_duration(span), vcpu))
    print("  CPU used    avg %5.1f%%   p50 %5.1f%%   p95 %5.1f%%   peak %5.1f%%" % (
        mean(totals), percentile(totals, 0.5), percentile(totals, 0.95), max(totals)))
    print("  iowait      avg %5.1f%%   peak %5.1f%%" % (
        mean([row["cpu_iowait"] for row in samples]), max(row["cpu_iowait"] for row in samples)))
    print("  steal       avg %5.1f%%   peak %5.1f%%   (hypervisor taking CPU away)" % (
        mean([row["cpu_steal"] for row in samples]), max(row["cpu_steal"] for row in samples)))
    memory = [row["mem_used_pct"] for row in samples if row["mem_used_pct"] is not None]
    if memory:
        print("  RAM used    avg %5.1f%%   peak %5.1f%%   swap pages moved %s" % (
            mean(memory), max(memory), int(sum(row["swap_pages"] for row in samples))))
    print("  load avg 1m peak %5.2f   %s" % (max(row["load1"] for row in samples),
                                             "saturated" if max(row["load1"] for row in samples) > vcpu else "headroom"))
    stalls = {}
    for row in samples:
        for key, value in row["pressure"].items():
            stalls[key] = max(stalls.get(key, 0.0), value)
    if stalls:
        print("  worst stall avg10: " + ", ".join(
            "%s %.1f%%" % (key.replace("_avg10", ""), value)
            for key, value in sorted(stalls.items())))

    above = sum(1 for value in totals if value >= 40)
    print("  ticks at or above 40%% CPU: %s of %s" % (above, len(totals)))

    contributors = {}
    seen_names = set()
    for row in samples:
        seen_names.update(row["proc_peak"])
    for name in seen_names:
        contributors[name] = {
            "series": [row["proc_peak"].get(name, 0.0) for row in samples],
            "seconds": sum(row["proc_seconds"].get(name, 0.0) for row in samples),
            "peak": max([row["proc_peak"].get(name, 0.0) for row in samples] or [0.0]),
        }
    scored = []
    for name, entry in contributors.items():
        if entry["seconds"] <= 0.5:
            continue
        scored.append((pearson(totals, entry["series"]) or 0.0, name, entry))
    scored.sort(key=lambda row: (-row[2]["seconds"]))
    print("\nTop processes (%% of all %.0f vCPU, cpu-seconds spent)" % vcpu)
    print("  %-18s %10s %10s %8s %8s  %s" % ("command", "cpu-sec", "peak%", "avg%", "corr", "where"))
    for score, name, entry in scored[:12]:
        seen = ",".join(sorted(role(cid, names) for cid in where.get(name, set()))) or "host"
        print("  %-18s %10.1f %10.1f %8.1f %8s  %s" % (
            name[:18], entry["seconds"], entry["peak"], mean(entry["series"]),
            ("%.2f" % score) if score else "-", seen[:24]))

    containers = {}
    for row in samples:
        for name, values in row["docker"].items():
            entry = containers.setdefault(name, {"cpu": [], "mem": [], "quota": []})
            entry["cpu"].append(values["cpu"])
            entry["mem"].append(100 * values["mem_used"] / values["mem_quota"] if values["mem_quota"] else None)
            entry["quota"].append(values["mem_quota"])
    if containers:
        print("\nContainers")
        print("  %-22s %9s %9s %9s %8s" % ("name", "peakCPU%", "p95CPU%", "peakMem%", "corr"))
        for name, entry in sorted(containers.items()):
            cpus = [value for value in entry["cpu"]]
            mems = [value for value in entry["mem"] if value is not None]
            print("  %-22s %9.1f %9.1f %9s %8s" % (
                name[:22], max(cpus), percentile(cpus, 0.95),
                ("%.1f" % max(mems)) if mems else "-",
                ("%.2f" % pearson(totals, cpus)) if pearson(totals, cpus) is not None else "-"))

    devices = {}
    for row in samples:
        for device, values in row["disk"].items():
            entry = devices.setdefault(device, {"util": [], "mb": []})
            entry["util"].append(values["util_pct"])
            entry["mb"].append(values["mbytes_per_second"])
    busy = [
        (max(values["util"]), name, max(values["mb"]))
        for name, values in devices.items()
        if values["util"]
    ]
    busy.sort(reverse=True)
    if busy:
        print("\nBlock devices")
        for util, name, rate in busy[:4]:
            print("  %-12s peak %5.1f%% busy, %.1f MB/s" % (name, util, rate))

    gauges = {}
    counter_first = {}
    counter_last = {}
    counter_first_ts = {}
    counter_last_ts = {}
    for row in samples:
        if not row["db"]:
            continue
        for key, value in row["db"].items():
            if key in MYSQL_COUNTERS:
                counter_first.setdefault(key, value)
                counter_first_ts.setdefault(key, row["ts"])
                counter_last[key] = value
                counter_last_ts[key] = row["ts"]
            else:
                gauges[key] = max(gauges.get(key, 0.0), value)
    if gauges:
        print("\nWork that was in flight (highest value seen in the window)")
        for key in sorted(gauges):
            print("  %-38s %s" % (key, int(gauges[key])))
    # Cumulative counters are divided by the time between the first and last
    # sample that carried them, not by the whole capture: the first tick has no
    # difference, so its counters would over-report the rate.
    counter_span = max(
        [counter_last_ts[key] - counter_first_ts[key] for key in counter_first] or [0])
    if counter_first and counter_span > 0:
        print("\nDatabase and Redis work per second over the window")
        for key in sorted(counter_first):
            delta = counter_last[key] - counter_first[key]
            if delta < 0:
                print("  %-38s server restarted during the capture" % key)
                continue
            if key in BYTE_COUNTERS:
                print("  %-38s %.2f MB/s" % (key, delta / 1048576.0 / counter_span))
            else:
                print("  %-38s %.1f/s" % (key, delta / counter_span))
        read_delta = counter_last.get("Innodb_buffer_pool_reads", 0) - \
            counter_first.get("Innodb_buffer_pool_reads", 0)
        request_delta = counter_last.get("Innodb_buffer_pool_read_requests", 0) - \
            counter_first.get("Innodb_buffer_pool_read_requests", 0)
        if request_delta > 0:
            print("  %-38s %.1f%%" % (
                "InnoDB buffer pool hit ratio", 100 * (1 - read_delta / request_delta)))

    gap = mean_gap(samples)
    lag, strength = None, 0.0
    if len(samples) >= 24 and gap > 0:
        min_lag = max(2, int(60 / gap))
        max_lag = max(min_lag + 2, min(len(samples) // 2 - 1, int(1800 / gap)))
        lag, strength = autocorrelation(totals, min_lag, max_lag)
    if lag and strength > 0.25:
        print("\nPeriodicity: the CPU series repeats every ~%s (confidence %.2f)" % (
            fmt_duration(lag * gap), strength))
    elif len(samples) < 24:
        print("\nPeriodicity: window too short to judge; use --duration 900 or more")
    else:
        print("\nPeriodicity: no fixed cadence found; the spikes follow work, not timers")

    return verdict(samples, contributors, containers, gauges, totals, vcpu)


def mean_gap(samples):
    if len(samples) < 2:
        return 1.0
    return sum(row["elapsed"] for row in samples) / len(samples)


def mean(values):
    return sum(values) / len(values) if values else 0.0


def fmt_duration(seconds):
    seconds = int(round(seconds))
    if seconds < 60:
        return "%ds" % seconds
    if seconds < 3600:
        return "%dm%02ds" % (seconds // 60, seconds % 60)
    return "%dh%02dm" % (seconds // 3600, (seconds % 3600) // 60)


def verdict(samples, contributors, containers, gauges, totals, vcpu):
    """Name the cause and the exact file to change, based on what was measured."""
    lines = []
    peak = max(totals)
    base = percentile(totals, 0.5)
    if peak < 30:
        lines.append(
            "This window never spiked (peak %.0f%% used), so whatever the panel showed as high did "
            "not happen while sampling. Capture again while the panel is high, or raise --duration to "
            "cover at least an hour." % peak)
    steal = mean([row["cpu_steal"] for row in samples])
    if steal > 8:
        lines.append(
            "Steal time averages %.1f%%: the hypervisor is taking CPU back from this VPS. "
            "No application change fixes that; it is the plan or a noisy neighbour." % steal)
    encode = contributors.get("ffmpeg")
    encode_corr = (pearson(totals, encode["series"]) or 0.0) if encode else 0.0
    encode_peak = encode["peak"] if encode else 0.0
    worker_peak = max(
        [max(values["cpu"]) for name, values in containers.items() if "worker" in name] or [0])
    if worker_peak >= 180 or encode_corr > 0.5:
        lines.append(
            "The media worker is pegging its CPU quota while encoding: the worker container peaked "
            "at %.0f%% of one core and ffmpeg alone reached %.0f%% of the whole host "
            "(correlation with the host peaks %.2f). backend/infra/compose.yaml caps worker at "
            "cpus: 2, so on %.0f vCPU one encode is worth %.0f%% host usage. To flatten the sawtooth "
            "lower that to cpus: 1, or reduce the encoder's own appetite in "
            "backend/libs/media-processing/src/encode.ts (ffmpeg -threads 2 and up to 4 libvips "
            "threads). Encoding gets slower; usage stops arriving in bursts."
            % (worker_peak, encode_peak, encode_corr, vcpu, 100 * 2 / vcpu))
    spikes = [row for row in samples if row["cpu_total"] >= max(35, base + 12)]
    if len(spikes) >= 3:
        gaps = [b["ts"] - a["ts"] for a, b in zip(spikes, spikes[1:])]
        gaps = [value for value in gaps if 30 <= value <= 900]
        if gaps and (max(gaps) - min(gaps)) < 0.4 * mean(gaps):
            lines.append(
                "Spikes arrive about every %s. That matches the timed work rather than uploads: "
                "share-shell prerendering every SHARE_SHELL_REFRESH_SECONDS=120 "
                "(backend/apps/api/src/modules/seo/share-shell.service.ts), the story and shop "
                "archive sweeps every 5 minutes plus the share-card retry (backend/apps/worker/src/"
                "jobs/), the 10-second media recovery poll, and the 10-second healthchecks that boot "
                "a fresh node process in each container. Raise those intervals first; they are "
                "cheaper to change than the limits."
                % fmt_duration(mean(gaps)))
    iowait = mean([row["cpu_iowait"] for row in samples])
    if iowait > 12:
        lines.append(
            "Waiting on disk averages %.1f%%. Redis AOF fsync every second, MySQL flushing, and the "
            "archive copy/verify pass share one volume. Look at the busiest device listed above: if "
            "it is the media volume, put MEDIA_ARCHIVE_ROOT on a second disk."
            % iowait)
    api_peak = max(
        [max(values["cpu"]) for name, values in containers.items() if "api" in name] or [0])
    if api_peak > 150 and len(spikes) == 0:
        lines.append(
            "The API container is the busiest thing in the window (%.0f%% of one core) with no upload "
            "bursts, which usually means media bytes are streaming through Node instead of the Nginx "
            "proxy cache. Confirm the /api/v1/uploads/ location blocks exist in the site's HTTPS vhost "
            "(setup-vps.sh prints them) and keep MEDIA_PUBLIC_CACHE_SECONDS high."
            % api_peak)
    memory = [row["mem_used_pct"] for row in samples if row["mem_used_pct"] is not None]
    if memory and max(memory) > 92:
        lines.append(
            "RAM peaked at %.1f%%. The budgets in compose.yaml (api 768m, worker 2g, mysql 2g, redis "
            "512m) plus the operating system and proxy leave little headroom; the sawtooth you see "
            "may be reclaim and swap, not CPU."
            % max(memory))
    stalled = max(
        [value for row in samples for key, value in row["pressure"].items()
         if key.endswith("_avg10")] or [0])
    if stalled > 20:
        lines.append(
            "Pressure stall information peaked at %.1f%% (avg10), meaning tasks were actually waiting, "
            "not just busy. That is the number that predicts slow pages; a high CPU%% with low PSI is "
            "cosmetic." % stalled)
    outbox_age = gauges.get("outbox_oldest_seconds", 0.0)
    if outbox_age > 600:
        lines.append(
            "A processing request has been waiting %.0f minutes in media_processing_outbox while the "
            "worker stayed alive, which means the queue or the worker is stuck rather than busy. Check "
            "the queue lengths above and the worker heartbeat before changing any limit."
            % (outbox_age / 60))
    if not lines:
        lines.append(
            "No single explanation dominates. In the process table above, find the command whose corr "
            "is near 1.0 and whose peak% is large: that is the sawtooth's author, and its quota or "
            "interval is the setting to change.")
    print("\nWhat this means")
    for line in lines:
        print("  - " + line)


def main(capture):
    facts, limits = host_facts(capture)
    names = container_names(capture)
    global CLK, vcpu_total
    vcpu = float(facts.get("vcpu", 1) or 1)
    vcpu_total = vcpu if vcpu > 0 else 1.0
    CLK = float(facts.get("jiffies_per_second", 100) or 100)
    rows = series_from(ticks(capture))
    if not rows:
        sys.exit('capture has no usable tick pair: %s' % capture)
    if limits:
        print("Declared container limits (from docker inspect, Env never read)")
        for name, values in sorted(limits.items()):
            print("  %-22s cpus %-5s mem %-8s restarts %s" % (
                name[:22],
                ("%.2f" % values["cpus"]) if values["cpus"] else "none",
                ("%dM" % (values["mem_bytes"] / 1024 / 1024)) if values["mem_bytes"] else "none",
                values["restarts"]))
        print()
    summarize(rows, vcpu, names)
    print("\nCapture kept at %s" % capture)
    print("Re-render without re-sampling: bash diagnose-vps.sh --report %s" % capture)
    print("It holds counters, process names and queue lengths only, never credentials.")


if __name__ == "__main__":
    main(sys.argv[1])
PY
}

# --------------------------------------------------------------------- setup

parse_args() {
  while (($#)); do
    case "$1" in
      --help | -h) usage; exit 0 ;;
      --self-test) MODE=selftest; shift ;;
      --report) [[ -n ${2:-} ]] || die '--report needs a capture directory'; MODE=report; DIR=$2; shift 2 ;;
      --snapshot) MODE=snapshot; shift ;;
      --duration) [[ -n ${2:-} ]] || die '--duration needs seconds'; DURATION=$2; shift 2 ;;
      --interval) [[ -n ${2:-} ]] || die '--interval needs seconds'; INTERVAL=$2; shift 2 ;;
      --docker-every) [[ -n ${2:-} ]] || die '--docker-every needs a count'; DOCKER_EVERY=$2; shift 2 ;;
      --db-every) [[ -n ${2:-} ]] || die '--db-every needs a count'; DB_EVERY=$2; shift 2 ;;
      --no-db) READ_DB=0; shift ;;
      --dir) [[ -n ${2:-} ]] || die '--dir needs a path'; DIR=$2; shift 2 ;;
      *) die "Unknown option: $1 (use --help)" ;;
    esac
  done
  for value in "$DURATION" "$INTERVAL" "$DOCKER_EVERY" "$DB_EVERY"; do
    [[ "$value" =~ ^[1-9][0-9]*$ ]] || die "numeric values are required for duration/interval/every"
  done
  (( INTERVAL >= 2 )) || die '--interval must be at least 2 seconds'
  (( DURATION <= 21600 )) || die '--duration is capped at 6 hours so the capture stays small'
  (( DURATION >= INTERVAL * 4 )) || die '--duration must cover at least four ticks'
}

main() {
  parse_args "$@"
  # The self-test only exercises the parser on synthetic files, so it runs on
  # any host; everything else needs the real /proc of the Linux VPS.
  if [[ $MODE == selftest ]]; then
    command -v python3 >/dev/null 2>&1 || die 'python3 is required for --self-test.'
    self_test
    exit 0
  fi
  [[ $MODE == report ]] ||
    [[ $(uname -s) == Linux ]] || die 'Run this on the Linux VPS, not Windows.'
  command -v python3 >/dev/null 2>&1 || die 'python3 is required; Ubuntu and CloudPanel provide it.'

  case $MODE in
    selftest) self_test; exit 0 ;;
  esac

  if [[ -z "$DIR" ]]; then
    DIR=/var/tmp/matjary-diag.$(date -u +%Y%m%dT%H%M%SZ)
  fi
  case $MODE in
    report)
      [[ -d $DIR ]] || die "no capture at $DIR"
      ;;
    *)
      mkdir -p "$DIR/ticks" || die 'cannot create the capture directory'
      write_facts "$DIR"
      detect_containers
      write_query "$DIR"
      if ! command -v docker >/dev/null 2>&1; then
        printf '\nNote: docker is absent, so container and queue readings will be missing.\n' >&2
      elif ! docker info >/dev/null 2>&1; then
        printf '\nNote: docker is not readable by this user; run with sudo for container detail.\n' >&2
      fi
      ;;
  esac

  case $MODE in
    report) report ;;
    snapshot)
      # Three separated ticks: two differences are the minimum for any rate.
      tick 1
      sleep "$INTERVAL"
      tick 2
      sleep "$INTERVAL"
      tick 3
      report
      ;;
    *)
      trap 'STOP=1' INT TERM
      run_window
      report
      ;;
  esac
}

# ----------------------------------------------------------------- self test

# Validates the parser and the arithmetic on a capture with known answers, so a
# bad report is caught here rather than on the VPS during a spike.
self_test() {
  local dir first second third
  SELFTEST_TMP=$(mktemp -d "${TMPDIR:-/tmp}/matjary-diag-selftest.XXXXXXXX")
  dir=$SELFTEST_TMP
  mkdir -p "$dir/ticks/000001" "$dir/ticks/000002" "$dir/ticks/000003"
  printf 'vcpu=4\njiffies_per_second=100\ncaptured_at=selftest\n' > "$dir/host.txt"
  printf 'matjary-worker-1\t2000000000 2147483648 0\n' > "$dir/limits.txt"
  printf 'abcdef123456\tmatjary-worker-1\n' > "$dir/containers.txt"

  # Synthetic cumulative counters on 4 cores with 100 ticks per second per core.
  # Each 5-second step: 610 busy jiffies out of 2060 total = 29.6% host CPU, 160
  # jiffies steal, ffmpeg 400 jiffies = 0.8 core = 20% of the whole host.
  printf 'cpu  1000 0 500 17000 200 0 50 100\n' > "$dir/ticks/000001/cpu.txt"
  printf 'cpu  1400 0 700 18400 250 0 60 260\n' > "$dir/ticks/000002/cpu.txt"
  printf 'cpu  1800 0 900 19800 300 0 70 420\n' > "$dir/ticks/000003/cpu.txt"
  printf '100.0\n' > "$dir/ticks/000001/ts.txt"
  printf '105.0\n' > "$dir/ticks/000002/ts.txt"
  printf '110.0\n' > "$dir/ticks/000003/ts.txt"
  first=$dir/ticks/000001
  second=$dir/ticks/000002
  third=$dir/ticks/000003
  for d in "$first" "$second" "$third"; do
    printf '2.0 2.0 1.0 2/100 1\n' > "$d/loadavg.txt"
    printf 'MemTotal: 8388608\nMemAvailable: 4194304\nSwapTotal: 0\nSwapFree: 0\n' > "$d/meminfo.txt"
    printf 'pswpin 0\npswpout 0\npgpgin 10\npgpgout 20\npgmajfault 0\n' > "$d/vmstat.txt"
    printf '# cpu\nsome avg10=1.00 avg60=0.50 total=1\n' > "$d/pressure.txt"
    printf 'matjary-worker-1\t195.00%%\t40.00%%\t800MiB / 2GiB\t0B / 0B\t0B / 0B\n' > "$d/docker.txt"
  done
  printf '253 0 vda 100 0 1000 20 50 0 2000 30 0 100 130\n' > "$first/diskstats.txt"
  printf '253 0 vda 120 0 1600 25 60 0 3000 35 0 300 160\n' > "$second/diskstats.txt"
  printf '253 0 vda 140 0 2200 30 70 0 4000 40 0 500 190\n' > "$third/diskstats.txt"
  printf '42\tffmpeg\t100\t50\t7000\tabcdef123456\n43\tnode\t200\t80\t8000\tabcdef123456\n' \
    > "$first/procs.txt"
  printf '42\tffmpeg\t400\t150\t7000\tabcdef123456\n43\tnode\t210\t90\t8000\tabcdef123456\n' \
    > "$second/procs.txt"
  printf '42\tffmpeg\t700\t250\t7000\tabcdef123456\n43\tnode\t220\t100\t8000\tabcdef123456\n' \
    > "$third/procs.txt"
  printf 'media_status processing 1\nmedia_status ready 9\noutbox 1 5\nCom_select 1000\nInnodb_buffer_pool_reads 10\nInnodb_buffer_pool_read_requests 10000\n' \
    > "$first/db.txt"
  printf 'media_status processing 1\nmedia_status ready 9\noutbox 1 5\nCom_select 1500\nInnodb_buffer_pool_reads 20\nInnodb_buffer_pool_read_requests 11000\n' \
    > "$second/db.txt"
  printf 'media_status processing 1\nmedia_status ready 9\noutbox 1 5\nCom_select 2000\nInnodb_buffer_pool_reads 30\nInnodb_buffer_pool_read_requests 12000\n' \
    > "$third/db.txt"

  local file=$dir/report.txt
  DIR=$dir report > "$file" || die 'the report crashed on synthetic data'
  grep -q 'Host, measured over 10s of sampling on 4 vCPU' "$file" ||
    die 'window length or core count wrong'
  grep -q '29.6' "$file" || die 'CPU percentage was not differenced correctly'
  grep -q 'RAM used    avg  50.0' "$file" || die 'memory percentage wrong'
  grep -E '^  ffmpeg +8\.0 +20\.0' "$file" > /dev/null ||
    die 'ffmpeg not attributed as 0.8 core across two steps'
  grep -E '^  ffmpeg .* worker$' "$file" > /dev/null ||
    die 'process was not labelled with its container'
  grep -q 'matjary-worker-1' "$file" || die 'container series missing'
  grep -q 'peak   4.0% busy, 0.2 MB/s' "$file" || die 'device utilisation wrong'
  grep -E 'Com_select +100\.0/s' "$file" > /dev/null ||
    die 'database counter rate wrong'
  grep -E 'hit ratio +99\.0' "$file" > /dev/null || die 'buffer pool ratio wrong'
  grep -q 'The media worker is pegging' "$file" || die 'verdict did not name the worker'
  grep -q 'window too short' "$file" || die 'short window should not claim cadence'
  printf 'Self-test passed on a synthetic capture. Nothing outside %s was touched.\n' "$dir"
}

main "$@"
