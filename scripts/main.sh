#!/bin/bash

set -euo pipefail
cd "$(dirname "$0")"

BUN=/root/.bun/bin/bun
export DEBIAN_FRONTEND=noninteractive

# Install system packages only when missing: a full update/upgrade on every
# container restart is slow and stops the server from starting when offline.
# Set BT_APT_UPGRADE=1 to force an upgrade on boot.
missing=()
for bin in curl unzip nano docker; do command -v "$bin" >/dev/null || missing+=("$bin"); done
if [ ${#missing[@]} -gt 0 ] || [ "${BT_APT_UPGRADE:-0}" = "1" ]; then
  apt-get update
  [ "${BT_APT_UPGRADE:-0}" = "1" ] && apt-get upgrade -y
  apt-get install -y ca-certificates curl unzip nano docker.io
fi

echo "  $(grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '"') | $(uname -m) | $(date)"

if [ ! -x "$BUN" ]; then
  curl -fsSL https://bun.sh/install | bash
fi

# server.js imports pug; install it from the lockfile instead of relying on auto-install.
"$BUN" install --frozen-lockfile --production

exec "$BUN" run server.js
