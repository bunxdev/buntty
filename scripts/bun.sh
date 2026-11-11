#!/bin/bash

set -euo pipefail

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl unzip

# Pinned so a restart never pulls an unreviewed Bun release (override with BUN_VERSION).
BUN_VERSION="${BUN_VERSION:-1.4.4}"
if [ ! -x /root/.bun/bin/bun ]; then
  curl -fsSL --proto '=https' --tlsv1.2 https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
fi

/root/.bun/bin/bun --version
