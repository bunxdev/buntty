#!/bin/bash
# Lanza Claude Code en el workspace del agente indicado
# Uso: ./agents/launch.sh <agent-dir>

# Agent names only: "../x" would start claude (and load its CLAUDE.md/hooks) in any directory.
[[ "${1:-}" =~ ^[a-z0-9-]+$ ]] || { echo "Uso: $0 <agent-dir>"; exit 1; }
AGENT_DIR="/scripts/agents/$1/workspace"

if [ ! -d "$AGENT_DIR" ]; then
  echo "Error: no existe $AGENT_DIR"
  exit 1
fi

export PATH="/root/.bun/bin:$PATH"
cd "$AGENT_DIR"
exec claude
