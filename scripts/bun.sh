#!/bin/bash

set -euo pipefail

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl unzip

if [ ! -x /root/.bun/bin/bun ]; then
  curl -fsSL https://bun.sh/install | bash
fi

/root/.bun/bin/bun --version
