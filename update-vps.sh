#!/usr/bin/env bash
# Pull and refresh an existing deployment using its saved domain settings.
# Usage on the VPS: sudo bash update-vps.sh --domain demo.example.com
set +x
set -Eeuo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
exec bash "$SCRIPT_DIR/setup-vps.sh" --update "$@"
