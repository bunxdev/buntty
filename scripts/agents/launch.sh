#!/bin/bash
# Lanza Claude Code en el workspace del agente indicado
# Uso: ./agents/launch.sh <agent-dir>

AGENT_DIR="/scripts/agents/$1/workspace"

if [ ! -d "$AGENT_DIR" ]; then
  echo "Error: no existe $AGENT_DIR"
  exit 1
fi

export PATH="/root/.bun/bin:$PATH"
cd "$AGENT_DIR"
exec claude
