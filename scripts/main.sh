#!/bin/bash

set -euo pipefail

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl unzip neofetch nano docker.io

neofetch

if [ ! -x /root/.bun/bin/bun ]; then
  curl -fsSL https://bun.sh/install | bash
fi

exec /root/.bun/bin/bun run server.js
